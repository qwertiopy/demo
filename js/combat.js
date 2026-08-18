// Weapons, line-of-sight, enemy AI, entity collisions, and bullets.

import { Config } from "./config.js";
import { GameState, player } from "./state.js";
import { isColliding } from "./utils.js";
import { seededRandom } from "./utils.js";
import { handleWallCollisions } from "./utils.js";

// Throwable projectiles use constant physical deceleration in blocks/sec².
// Throw distance is chosen from the shooter-to-aim distance; initial speed and
// flight duration are derived so the projectile reaches that path distance at
// exactly zero speed:
//
//   D  = configured throw distance
//   a  = throwDeceleration
//   v0 = sqrt(2aD)
//   T  = v0 / a = sqrt(2D/a)
//   s(t) = v0*t - 0.5*a*t²
//
// Position is evaluated from this closed-form equation. Velocity is never
// integrated frame by frame.
export const MIN_THROW_DECELERATION = 0.001;

export function getThrowableKinematics(distanceBlocks, decelerationBlocksPerSecondSq) {
	const distance = Math.max(0, Number(distanceBlocks) || 0);
	const deceleration = Math.max(
		MIN_THROW_DECELERATION,
		Number(decelerationBlocksPerSecondSq ?? 20) || 0,
	);

	if (distance === 0) {
		return {
			distanceBlocks: 0,
			deceleration,
			initialSpeed: 0,
			durationSeconds: 0,
			durationMs: 0,
		};
	}

	const initialSpeed = Math.sqrt(2 * deceleration * distance);
	const durationSeconds = initialSpeed / deceleration;

	return {
		distanceBlocks: distance,
		deceleration,
		initialSpeed,
		durationSeconds,
		durationMs: durationSeconds * 1000,
	};
}

export function getThrowableTravelDistance(
	distanceBlocks,
	elapsedMs,
	decelerationBlocksPerSecondSq,
	precomputedInitialSpeed = null,
	precomputedDurationMs = null,
) {
	const distance = Math.max(0, Number(distanceBlocks) || 0);
	const deceleration = Math.max(
		MIN_THROW_DECELERATION,
		Number(decelerationBlocksPerSecondSq ?? 20) || 0,
	);

	if (distance === 0) return 0;

	// Throwable launch kinematics are normally calculated once in shoot() and
	// reused for every frame and every boomerang leg. The fallback calculations
	// keep compatibility with any older projectile object missing those fields.
	const initialSpeed = Number.isFinite(precomputedInitialSpeed)
		? Math.max(0, precomputedInitialSpeed)
		: Math.sqrt(2 * deceleration * distance);
	const durationSeconds = Number.isFinite(precomputedDurationMs)
		? Math.max(0, precomputedDurationMs) / 1000
		: initialSpeed / deceleration;
	const rawElapsedSeconds = Math.max((Number(elapsedMs) || 0) / 1000, 0);

	if (rawElapsedSeconds >= durationSeconds) {
		return distance;
	}

	const travelled =
		initialSpeed * rawElapsedSeconds -
		0.5 * deceleration * rawElapsedSeconds * rawElapsedSeconds;

	return Math.min(distance, Math.max(0, travelled));
}

// After the first outbound leg, each configured boomerang bounce travels 2D.
// It begins at rest, accelerates at +a for D blocks until it reaches the
// original launch speed at the midpoint, then decelerates at -a for another
// D blocks until it reaches rest at the opposite endpoint. The original
// launch kinematics are reused; no speed/duration values are recalculated.
export function getThrowableBoomerangTravelDistance(
	distanceBlocks,
	elapsedMs,
	decelerationBlocksPerSecondSq,
	precomputedInitialSpeed = null,
	precomputedDurationMs = null,
) {
	const distance = Math.max(0, Number(distanceBlocks) || 0);
	const deceleration = Math.max(
		MIN_THROW_DECELERATION,
		Number(decelerationBlocksPerSecondSq ?? 20) || 0,
	);

	if (distance === 0) return 0;

	const initialSpeed = Number.isFinite(precomputedInitialSpeed)
		? Math.max(0, precomputedInitialSpeed)
		: Math.sqrt(2 * deceleration * distance);
	const halfDurationSeconds = Number.isFinite(precomputedDurationMs)
		? Math.max(0, precomputedDurationMs) / 1000
		: initialSpeed / deceleration;
	const elapsedSeconds = Math.max((Number(elapsedMs) || 0) / 1000, 0);
	const fullDurationSeconds = halfDurationSeconds * 2;

	if (elapsedSeconds >= fullDurationSeconds) {
		return distance * 2;
	}

	if (elapsedSeconds <= halfDurationSeconds) {
		// Starts at v=0 and accelerates to the original launch speed.
		return Math.min(
			distance,
			0.5 * deceleration * elapsedSeconds * elapsedSeconds,
		);
	}

	// From the original launch point onward, decelerate from the original
	// launch speed back to v=0 at the opposite endpoint.
	const secondHalfTime = elapsedSeconds - halfDurationSeconds;
	const secondHalfDistance =
		initialSpeed * secondHalfTime -
		0.5 * deceleration * secondHalfTime * secondHalfTime;

	return Math.min(distance * 2, Math.max(distance, distance + secondHalfDistance));
}

export function getRandomSpreadOffset(spreadRadians = 0) {
	const spread = Math.max(0, Number(spreadRadians) || 0);
	return (Math.random() - 0.5) * spread;
}

// Creates a projectile aimed from a shooter's center toward a world-space target and stores velocity, damage, bounce, and lifetime data.
export function shoot(shooter, targetX, targetY, bulletArray, stats) {
	if (GameState.isPlayerDead) return;

	const centerX = shooter.x + shooter.size / 2;
	const centerY = shooter.y + shooter.size / 2;
	const targetDx = targetX - centerX;
	const targetDy = targetY - centerY;
	const spreadOffset = getRandomSpreadOffset(stats.spread ?? 0);
	const angle = Math.atan2(targetDy, targetDx) + spreadOffset;
	const throwable = stats.throwable === true;
	const speed = throwable ? 0 : (stats.speed ?? 12);
	const throwDistanceMultiplier = Math.max(
		0,
		Number(stats.throwDistanceMultiplier ?? 1) || 0,
	);
	const throwDistanceBlocks = throwable
		? Math.hypot(targetDx, targetDy) * throwDistanceMultiplier
		: 0;
	const throwDeceleration = throwable
		? Math.max(
			MIN_THROW_DECELERATION,
			Number(stats.throwDeceleration ?? 20) || 0,
		)
		: 0;
	const throwKinematics = throwable
		? getThrowableKinematics(throwDistanceBlocks, throwDeceleration)
		: null;
	const createdAt = performance.now();

	// clamps max number of bullets to 100 (?????)
	if (bulletArray === GameState.bullets && GameState.bullets.length >= 100) {
		GameState.bullets.shift();
	}

	// Throwable vx/vy are intentionally zero: their movement is driven by the
	// closed-form throw-distance equation in processBullets(). throwDirX/Y are
	// unit direction components and can still be reflected by wall bounces.
	bulletArray.push({
		x: centerX,
		y: centerY,
		radius: stats.radiusBlocks ?? 0.08,
		vx: Math.cos(angle) * speed,
		vy: Math.sin(angle) * speed,
		color: stats.color ?? "white",
		damage: stats.damage ?? 1,
		bounces: 0,
		maxBounces: stats.maxBounces ?? 0,
		throwBounces: 0,
		hitTargets: new Set(),
		createdAt,
		lifetimeMs: stats.lifetimeMs ?? 60000,
		explosionRadiusBlocks: stats.explosionRadiusBlocks ?? 0,
		detonationTimeMs: stats.detonationTimeMs ?? 0,
		explosionDurationMs: stats.explosionDurationMs ?? 0,
		explosionDamage: stats.explosionDamage ?? 0,
		detonatesOnImpact: stats.detonatesOnImpact ?? false,
		penetrationBlocks: Math.max(0, Number(stats.penetrationBlocks ?? 0) || 0),
		remainingPenetrationBlocks: Math.max(
			0,
			Number(stats.penetrationBlocks ?? 0) || 0,
		),
		finishPenetratedWall: false,
		throwable,
		throwDirX: Math.cos(angle),
		throwDirY: Math.sin(angle),
		throwDistanceBlocks,
		throwDistanceMultiplier,
		throwTravelledBlocks: 0,
		throwLegStartedAt: createdAt,
		throwDeceleration,
		throwInitialSpeed: throwKinematics?.initialSpeed ?? 0,
		throwFlightDurationMs: throwKinematics?.durationMs ?? 0,
		throwComplete: !throwable || throwDistanceBlocks === 0,
		dv: 0,
		bulletCollision: stats.bulletCollision === true,

		get width() {
			return this.radius * 2;
		},
		get height() {
			return this.radius * 2;
		},
		get size() {
			return this.radius * 2;
		},
	});
}

// Tests whether two line segments intersect; used to determine whether a wall edge blocks a shot or enemy vision
export function lineIntersects(a, b, c, d, p, q, r, s) {
	const det = (c - a) * (s - q) - (r - p) * (d - b);

	if (det === 0) return false;

	const lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det;

	const gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det;

	return 0 < lambda && lambda < 1 && 0 < gamma && gamma < 1;
}

// Returns false when any wall edge intersects the line between two world-space points
// this is done in an interesting way i just trust it works im not figuring this out - cyn
export function hasLineOfSight(x1, y1, x2, y2) {
	return !GameState.walls.some(
		(w) =>
			lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x + w.width, w.y) ||
			lineIntersects(
				x1,
				y1,
				x2,
				y2,
				w.x,
				w.y + w.height,
				w.x + w.width,
				w.y + w.height,
			) ||
			lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x, w.y + w.height) ||
			lineIntersects(
				x1,
				y1,
				x2,
				y2,
				w.x + w.width,
				w.y,
				w.x + w.width,
				w.y + w.height,
			),
	);
}

// Spawns eligible enemies, evaluates line of sight, handles enemy shooting, and calculates AI velocity toward the player or last seen position
// update this for enemy logic changes
export function updateEnemies(currentTime, dt) {
	//spawn enemies
	if (GameState.enemySpawnRate > 0 && GameState.enemySpawns.length > 0) {
		// enemyspawnrate = enemy spawns per second
		const spawnIntervalMs = 1000 / GameState.enemySpawnRate;

		if (currentTime - GameState.lastSpawnTime > spawnIntervalMs) {
			// player center
			// player position is stored in the bottom left corner???
			// might be worth changing in the player object instead of recomputing every frame hundreds of times
			const pCenterX = player.x + player.size / 2;
			const pCenterY = player.y + player.size / 2;

			// list of valid spawns based on distance of spawn to player
			const validSpawns = GameState.enemySpawns.filter((spawn) => {
				const dist = Math.hypot(spawn.x - pCenterX, spawn.y - pCenterY);

				return (
					dist >= Config.MIN_SPAWN_DISTANCE_BLOCKS &&
					dist <= Config.MAX_SPAWN_DISTANCE_BLOCKS
				);
			});

			if (validSpawns.length > 0) {
				const spawnPoint =
					validSpawns[
						Math.floor(seededRandom() * validSpawns.length)
					];

				const typeName = spawnPoint.type || "g-bot";
				const stats =
					Config.ENEMY_TYPES[typeName] || Config.ENEMY_TYPES["g-bot"];

				GameState.enemies.push({
					x: spawnPoint.x,
					y: spawnPoint.y,
					size: stats.sizeBlocks,
					speed: stats.speed,
					hp: stats.hp,
					maxHp: stats.hp,
					color: stats.color,
					lastShot: 0,
					shootCooldown: stats.shootCooldown,
					typeStats: stats,
					ai: stats.ai,
					lastSeenX: null,
					lastSeenY: null,
					vx: 0,
					vy: 0,
					moveX: 0,
					moveY: 0,
				});
			}

			GameState.lastSpawnTime = currentTime;
		}
	}

	// enemy processing loop
	GameState.enemies = GameState.enemies.filter((e) => {
		if (e.hp <= 0) return false;

		// enemy center
		const eCenterX = e.x + e.size / 2;
		const eCenterY = e.y + e.size / 2;

		// player center
		const pCenterX = player.x + player.size / 2;
		const pCenterY = player.y + player.size / 2;

		// line of sight
		const los = hasLineOfSight(eCenterX, eCenterY, pCenterX, pCenterY);

		// reset velocity before calculating
		e.vx = 0;
		e.vy = 0;

		// shoot if enemy can see player
		if (los) {
			e.lastSeenX = pCenterX;
			e.lastSeenY = pCenterY;

			if (currentTime - e.lastShot > e.shootCooldown) {
				shoot(e, pCenterX, pCenterY, GameState.enemyBullets, {
					color: e.typeStats.bulletColor,
					speed: e.typeStats.bulletSpeed,
					radiusBlocks: e.typeStats.bulletRadiusBlocks,
					damage: e.typeStats.bulletDamage,
					maxBounces: 0,
					spread: e.typeStats.spread ?? 0,
					explosionRadiusBlocks:
						e.typeStats.bulletExplosionRadiusBlocks ?? 0,
					detonationTimeMs: e.typeStats.bulletDetonationTimeMs ?? 0,
					explosionDurationMs:
						e.typeStats.bulletExplosionDurationMs ?? 0,
					explosionDamage: e.typeStats.bulletExplosionDamage ?? 0,
					detonatesOnImpact:
						e.typeStats.bulletDetonatesOnImpact ?? false,
					penetrationBlocks:
						e.typeStats.bulletPenetrationBlocks ?? 0,
					bulletCollision: e.typeStats.bulletCollision === true,
				});

				e.lastShot = currentTime;
			}
		}

		// only aggressive enemies chase the player??
		if (e.ai === "aggressive") {
			let targetX = los ? pCenterX : e.lastSeenX;
			let targetY = los ? pCenterY : e.lastSeenY;

			if (!los && targetX !== null) {
				if (
					Math.hypot(targetX - eCenterX, targetY - eCenterY) <
					e.speed * dt
				) {
					e.lastSeenX = null;
					e.lastSeenY = null;
					targetX = null;
				}
			}

			if (targetX !== null && targetY !== null) {
				const angle = Math.atan2(
					targetY - eCenterY,
					targetX - eCenterX,
				);

				e.vx = Math.cos(angle) * e.speed;
				e.vy = Math.sin(angle) * e.speed;
			}
		}

		handleWallCollisions(e, e.moveX, e.moveY);
		return true;
	});
}

// Converts enemy velocity into this-frame displacement and applies pairwise separation when enemies overlap
// not touching this either - cyn
export function resolveEnemyVectorCollisions(dt) {
	GameState.enemies.forEach((e) => {
		e.moveX = e.vx * dt;
		e.moveY = e.vy * dt;
	});

	for (let i = 0; i < GameState.enemies.length; i++) {
		for (let j = i + 1; j < GameState.enemies.length; j++) {
			const e1 = GameState.enemies[i];
			const e2 = GameState.enemies[j];

			if (e1.hp <= 0 || e2.hp <= 0) continue;

			const r1 = e1.size / 2;
			const r2 = e2.size / 2;

			const dx = e2.x + r2 + e2.moveX - (e1.x + r1 + e1.moveX);
			const dy = e2.y + r2 + e2.moveY - (e1.y + r1 + e1.moveY);

			const distance = Math.hypot(dx, dy);
			const minDist = r1 + r2;

			if (distance < minDist) {
				const nx =
					distance === 0
						? Math.cos(Math.random() * Math.PI * 2)
						: dx / distance;

				const ny =
					distance === 0
						? Math.sin(Math.random() * Math.PI * 2)
						: dy / distance;

				const overlap = minDist - (distance === 0 ? 0.001 : distance);

				const weight1 = e2.size / (e1.size + e2.size);
				const weight2 = e1.size / (e1.size + e2.size);

				e1.moveX -= nx * overlap * weight1 * 0.5;
				e1.moveY -= ny * overlap * weight1 * 0.5;
				e2.moveX += nx * overlap * weight2 * 0.5;
				e2.moveY += ny * overlap * weight2 * 0.5;
			}
		}
	}
}

// Resolves circular projectile/projectile overlaps for any pair where at least
// one projectile opts in with bulletCollision=true. An opted-in projectile
// therefore collides with every player/enemy projectile, even when both are
// moving. dv is used only to keep a truly stationary projectile fixed when it
// is hit by a moving one; otherwise the overlap is split by projectile radius.
export function resolveProjectileVectorCollisions() {
	const allProjectiles = [...GameState.bullets, ...GameState.enemyBullets];
	const stationaryEpsilon = 1e-12;

	for (let i = 0; i < allProjectiles.length; i++) {
		for (let j = i + 1; j < allProjectiles.length; j++) {
			const a = allProjectiles[i];
			const b = allProjectiles[j];

			if (a.bulletCollision !== true && b.bulletCollision !== true) {
				continue;
			}

			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const distance = Math.hypot(dx, dy);
			const minDistance = (a.radius ?? 0) + (b.radius ?? 0);

			if (distance >= minDistance) continue;

			const angle = distance === 0 ? Math.random() * Math.PI * 2 : 0;
			const nx = distance === 0 ? Math.cos(angle) : dx / distance;
			const ny = distance === 0 ? Math.sin(angle) : dy / distance;
			const overlap = minDistance - (distance === 0 ? 0.001 : distance);
			const aStationary = (Number(a.dv) || 0) <= stationaryEpsilon;
			const bStationary = (Number(b.dv) || 0) <= stationaryEpsilon;

			if (aStationary && !bStationary) {
				b.x += nx * overlap;
				b.y += ny * overlap;
			} else if (!aStationary && bStationary) {
				a.x -= nx * overlap;
				a.y -= ny * overlap;
			} else {
				const totalRadius = Math.max(
					1e-9,
					(a.radius ?? 0) + (b.radius ?? 0),
				);
				const weightA = (b.radius ?? 0) / totalRadius;
				const weightB = (a.radius ?? 0) / totalRadius;

				a.x -= nx * overlap * weightA;
				a.y -= ny * overlap * weightA;
				b.x += nx * overlap * weightB;
				b.y += ny * overlap * weightB;
			}
		}
	}
}

// Returns true when a circle overlaps an axis-aligned rectangle. Explosion
// hitboxes use this instead of the square projectile collision approximation.
export function circleIntersectsRect(circleX, circleY, radius, rect) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const closestX = Math.max(rect.x, Math.min(circleX, rect.x + width));
	const closestY = Math.max(rect.y, Math.min(circleY, rect.y + height));
	const dx = circleX - closestX;
	const dy = circleY - closestY;

	return dx * dx + dy * dy <= radius * radius;
}

// Creates a circular explosion at the projectile's current position. A radius
// of 0 means the projectile is non-explosive and no explosion object is made.
export function detonateBullet(bullet, isPlayerBullet, currentTime) {
	const radius = bullet.explosionRadiusBlocks ?? 0;

	if (radius <= 0) return false;

	GameState.explosions.push({
		x: bullet.x,
		y: bullet.y,
		radius,
		damage: bullet.explosionDamage ?? 0,
		color: bullet.color ?? "orange",
		createdAt: currentTime,
		durationMs: bullet.explosionDurationMs ?? 0,
		isPlayerExplosion: isPlayerBullet,
		hitTargets: new Set(),
	});

	return true;
}

// Applies circular explosion damage for the explosion's lifetime. Each target
// can only take damage once from a given explosion, even if it remains inside
// the circle or leaves and re-enters before the duration expires.
export function processExplosions(currentTime) {
	for (let i = GameState.explosions.length - 1; i >= 0; i--) {
		const explosion = GameState.explosions[i];
		const targets = explosion.isPlayerExplosion
			? GameState.enemies
			: [player];

		for (const target of targets) {
			if (target.hp <= 0 || explosion.hitTargets.has(target)) continue;

			if (
				circleIntersectsRect(
					explosion.x,
					explosion.y,
					explosion.radius,
					target,
				)
			) {
				if (explosion.isPlayerExplosion || !GameState.isInvincible) {
					target.hp -= explosion.damage;
				}

				explosion.hitTargets.add(target);
			}
		}

		if (currentTime - explosion.createdAt >= explosion.durationMs) {
			GameState.explosions.splice(i, 1);
		}
	}
}

// Returns a directionally inset collider that delays a collision by the
// requested penetration depth. Penetration is measured from the entry face
// along the active collision axis. If penetration is at least the collider's
// thickness on that axis, the collider is phased through completely.
export function getPenetratedCollisionRect(
	rect,
	penetrationBlocks = 0,
	axis = "x",
	direction = 1,
) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const penetration = Math.max(0, Number(penetrationBlocks) || 0);

	let x = rect.x;
	let y = rect.y;
	let adjustedWidth = width;
	let adjustedHeight = height;

	if (axis === "x") {
		if (adjustedWidth <= 0 || penetration >= adjustedWidth) return null;

		if (direction >= 0) {
			x += penetration;
		}
		adjustedWidth -= penetration;
	} else {
		if (adjustedHeight <= 0 || penetration >= adjustedHeight) return null;

		if (direction >= 0) {
			y += penetration;
		}
		adjustedHeight -= penetration;
	}

	return {
		x,
		y,
		width: adjustedWidth,
		height: adjustedHeight,
	};
}

// Moving projectiles have one total wall-penetration budget measured in
// blocks of travel while overlapping wall material. Each simulation substep
// starts by deciding whether penetration is still available. If it is, every
// wall collision in that substep is phased through and the intended path
// distance for that substep is deducted once from the remaining budget. This
// avoids double-charging at tile seams/corners while making continuous travel
// inside walls consume penetration continuously. Once a substep begins with no
// penetration remaining, the normal wall collision action is triggered.
function collidesWithWallUsingPenetrationBudget(
	bullet,
	mover,
	wall,
	penetrationStepState,
	isBouncy,
) {
	if (!isColliding(mover, wall)) return false;

	// A bouncy projectile that spent its final penetration while already inside
	// wall material is allowed to finish exiting that material. Once completely
	// clear, the next wall contact executes the normal bounce action.
	if (bullet.finishPenetratedWall && isBouncy) return false;

	if (penetrationStepState.phaseThisStep) {
		if (!penetrationStepState.consumed) {
			const remaining = Math.max(
				0,
				Number(
					bullet.remainingPenetrationBlocks ??
						bullet.penetrationBlocks ??
						0,
				) || 0,
			);
			bullet.remainingPenetrationBlocks = Math.max(
				0,
				remaining - penetrationStepState.travelDistanceBlocks,
			);
			penetrationStepState.consumed = true;

			if (bullet.remainingPenetrationBlocks <= 0 && isBouncy) {
				bullet.finishPenetratedWall = true;
			}
		}
		return false;
	}

	return true;
}

// Hardcoded laser presentation/range values. Weapon balance is controlled by
// the configurable warmup/cooldown/damage/penetration stats instead.
export const LASER_MAX_RANGE_BLOCKS = 60;

// Ray/AABB slab intersection. The optional radius expands the rectangle so a
// laser with a visible thickness also gets a matching collision thickness.
export function rayRectIntersection(
	originX,
	originY,
	dirX,
	dirY,
	rect,
	radius = 0,
) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const r = Math.max(0, Number(radius) || 0);
	const minX = rect.x - r;
	const maxX = rect.x + width + r;
	const minY = rect.y - r;
	const maxY = rect.y + height + r;
	const EPSILON = 1e-12;

	let xNear = -Infinity;
	let xFar = Infinity;
	let yNear = -Infinity;
	let yFar = Infinity;

	if (Math.abs(dirX) < EPSILON) {
		if (originX < minX || originX > maxX) return null;
	} else {
		const tx1 = (minX - originX) / dirX;
		const tx2 = (maxX - originX) / dirX;
		xNear = Math.min(tx1, tx2);
		xFar = Math.max(tx1, tx2);
	}

	if (Math.abs(dirY) < EPSILON) {
		if (originY < minY || originY > maxY) return null;
	} else {
		const ty1 = (minY - originY) / dirY;
		const ty2 = (maxY - originY) / dirY;
		yNear = Math.min(ty1, ty2);
		yFar = Math.max(ty1, ty2);
	}

	const tMin = Math.max(xNear, yNear);
	const tMax = Math.min(xFar, yFar);
	if (tMax < tMin || tMax < 0) return null;

	let normalX = 0;
	let normalY = 0;
	if (tMin >= 0) {
		if (Math.abs(xNear - yNear) <= EPSILON) {
			normalX = dirX >= 0 ? -1 : 1;
			normalY = dirY >= 0 ? -1 : 1;
			const magnitude = Math.hypot(normalX, normalY) || 1;
			normalX /= magnitude;
			normalY /= magnitude;
		} else if (xNear > yNear) {
			normalX = dirX >= 0 ? -1 : 1;
		} else {
			normalY = dirY >= 0 ? -1 : 1;
		}
	}

	return {
		entryDistance: Math.max(0, tMin),
		exitDistance: tMax,
		normalX,
		normalY,
	};
}

// Finds the next laser wall action along one ray segment while consuming one
// cumulative penetration budget. A bouncy laser that spends its last
// penetration inside a wall finishes that wall and only bounces on the next
// wall contact, matching the moving-projectile penetration rule.
export function getLaserWallStopWithPenetrationBudget(
	originX,
	originY,
	dirX,
	dirY,
	radius,
	penetrationBlocks,
	maxRangeBlocks = LASER_MAX_RANGE_BLOCKS,
	bouncy = false,
) {
	let remainingPenetrationBlocks = Math.max(
		0,
		Number(penetrationBlocks) || 0,
	);
	const maxRange = Math.max(0, Number(maxRangeBlocks) || 0);
	const wallIntervals = [];

	for (const wall of GameState.walls) {
		const hit = rayRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			wall,
			radius,
		);
		if (!hit || hit.entryDistance > maxRange) continue;

		const entryDistance = Math.max(0, hit.entryDistance);
		const exitDistance = Math.min(maxRange, hit.exitDistance);
		if (exitDistance <= entryDistance) continue;

		wallIntervals.push({
			entryDistance,
			exitDistance,
			normalX: hit.normalX,
			normalY: hit.normalY,
		});
	}

	wallIntervals.sort((a, b) => a.entryDistance - b.entryDistance);

	const mergedIntervals = [];
	for (const interval of wallIntervals) {
		const previous = mergedIntervals[mergedIntervals.length - 1];
		if (previous && interval.entryDistance <= previous.exitDistance + 1e-9) {
			previous.exitDistance = Math.max(
				previous.exitDistance,
				interval.exitDistance,
			);
		} else {
			mergedIntervals.push({ ...interval });
		}
	}

	for (const interval of mergedIntervals) {
		const wallTravelBlocks = interval.exitDistance - interval.entryDistance;

		if (remainingPenetrationBlocks >= wallTravelBlocks - 1e-12) {
			remainingPenetrationBlocks = Math.max(
				0,
				remainingPenetrationBlocks - wallTravelBlocks,
			);
			continue;
		}

		if (bouncy && remainingPenetrationBlocks > 0) {
			// Consume the rest of the budget, but finish this final wall before the
			// next collision is allowed to reflect the beam.
			remainingPenetrationBlocks = 0;
			continue;
		}

		const stopDistance = interval.entryDistance + remainingPenetrationBlocks;

		return {
			distance: Math.min(maxRange, stopDistance),
			impactedWall: true,
			remainingPenetrationBlocks: 0,
			normalX: interval.normalX,
			normalY: interval.normalY,
		};
	}

	return {
		distance: maxRange,
		impactedWall: false,
		remainingPenetrationBlocks,
		normalX: 0,
		normalY: 0,
	};
}

function createLaserExplosionAt(x, y, stats, currentTime) {
	return detonateBullet(
		{
			x,
			y,
			color: stats.color ?? "white",
			explosionRadiusBlocks: stats.explosionRadiusBlocks ?? 0,
			explosionDurationMs: stats.explosionDurationMs ?? 0,
			explosionDamage: stats.explosionDamage ?? 0,
		},
		true,
		currentTime,
	);
}

function resolveLaserShot(shot, currentTime) {
	const shooter = shot.shooter;
	let originX = shooter.x + shooter.size / 2;
	let originY = shooter.y + shooter.size / 2;
	let dirX = shot.dirX;
	let dirY = shot.dirY;
	const { stats } = shot;
	const radius = Math.max(0, Number(stats.radiusBlocks ?? 0.03) || 0);
	let remainingPenetrationBlocks = Math.max(
		0,
		Number(stats.penetrationBlocks ?? 0) || 0,
	);
	let remainingRange = LASER_MAX_RANGE_BLOCKS;
	const maxBounces = Math.max(0, Math.floor(Number(stats.maxBounces ?? 0) || 0));
	let bounces = 0;
	const hitTargets = new Set();
	const RAY_EPSILON = 1e-6;

	while (remainingRange > RAY_EPSILON) {
		const wallStop = getLaserWallStopWithPenetrationBudget(
			originX,
			originY,
			dirX,
			dirY,
			radius,
			remainingPenetrationBlocks,
			remainingRange,
			maxBounces > 0,
		);
		const beamDistance = wallStop.distance;
		remainingPenetrationBlocks = wallStop.remainingPenetrationBlocks;

		for (const target of GameState.enemies) {
			if (target.hp <= 0 || hitTargets.has(target)) continue;

			const hit = rayRectIntersection(
				originX,
				originY,
				dirX,
				dirY,
				target,
				radius,
			);

			if (hit && hit.entryDistance <= beamDistance + 1e-9) {
				target.hp -= stats.damage ?? 1;
				hitTargets.add(target);
			}
		}

		const endX = originX + dirX * beamDistance;
		const endY = originY + dirY * beamDistance;

		GameState.laserBeams.push({
			x1: originX,
			y1: originY,
			x2: endX,
			y2: endY,
			color: stats.color ?? "white",
			radius,
			createdAt: currentTime,
			durationMs: Math.max(0, Number(Config.RENDERING.LASER_FLASH_DURATION_MS) || 0),
		});

		remainingRange = Math.max(0, remainingRange - beamDistance);
		if (!wallStop.impactedWall) break;

		if (bounces < maxBounces) {
			// Every successful bounce of an explosive weapon creates its explosion
			// without consuming/removing the laser shot.
			createLaserExplosionAt(endX, endY, stats, currentTime);

			const dot = dirX * wallStop.normalX + dirY * wallStop.normalY;
			dirX -= 2 * dot * wallStop.normalX;
			dirY -= 2 * dot * wallStop.normalY;
			const magnitude = Math.hypot(dirX, dirY) || 1;
			dirX /= magnitude;
			dirY /= magnitude;
			bounces++;

			originX = endX + dirX * RAY_EPSILON;
			originY = endY + dirY * RAY_EPSILON;
			remainingRange = Math.max(0, remainingRange - RAY_EPSILON);
			continue;
		}

		if (stats.detonatesOnImpact) {
			createLaserExplosionAt(endX, endY, stats, currentTime);
		}
		break;
	}
}

// Starts a player laser shot. Aim direction is locked at trigger time. Warmup
// is a delayed state transition, while the beam itself is resolved as hitscan.
// Cooldown begins at the exact scheduled end of warmup (shot.fireAt), so the
// short rendered firing flash overlaps cooldown instead of extending it.
export function requestLaserShot(
	shooter,
	targetX,
	targetY,
	stats,
	weaponIndex,
	currentTime = performance.now(),
) {
	const index = Math.max(0, Number(weaponIndex) || 0);
	const cooldownUntil = GameState.weaponCooldownUntilByWeapon[index] || 0;

	if (currentTime < cooldownUntil) return false;
	if (GameState.laserWarmups.some((shot) => shot.weaponIndex === index)) {
		return false;
	}

	const centerX = shooter.x + shooter.size / 2;
	const centerY = shooter.y + shooter.size / 2;
	const angle = Math.atan2(targetY - centerY, targetX - centerX) +
		getRandomSpreadOffset(stats.spread ?? 0);
	const warmupMs = Math.max(0, Number(stats.laserWarmupMs ?? 0) || 0);
	const shot = {
		shooter,
		weaponIndex: index,
		dirX: Math.cos(angle),
		dirY: Math.sin(angle),
		stats: { ...stats },
		startedAt: currentTime,
		fireAt: currentTime + warmupMs,
	};

	if (warmupMs <= 0) {
		resolveLaserShot(shot, currentTime);
		GameState.weaponCooldownUntilByWeapon[index] =
			currentTime + Math.max(0, Number(stats.cooldownMs ?? 0) || 0);
		return true;
	}

	GameState.laserWarmups.push(shot);
	return true;
}

// Advances pending laser warmups and short-lived rendered beam flashes.
export function processLasers(currentTime) {
	for (let i = GameState.laserWarmups.length - 1; i >= 0; i--) {
		const shot = GameState.laserWarmups[i];

		if (currentTime < shot.fireAt) continue;

		resolveLaserShot(shot, currentTime);
		GameState.weaponCooldownUntilByWeapon[shot.weaponIndex] =
			shot.fireAt +
			Math.max(0, Number(shot.stats.cooldownMs ?? 0) || 0);
		GameState.laserWarmups.splice(i, 1);
	}

	GameState.laserBeams = GameState.laserBeams.filter(
		(beam) => currentTime - beam.createdAt < beam.durationMs,
	);
}

// Maximum projectile travel per collision substep; limiting this prevents fast bullets from tunneling through walls or targets
// this can also be done by using the line of sight function to see if the bullet intersected a wall at any point between 2 steps, and if it did, reversing its direction or deleting it
// i think doing it that way is more robust and allows for faster bullets and is also generally less buggy because it relies on continuous mathematical calculations - cyn
export const BULLET_MAX_STEP_BLOCKS = 0.2;

// Returns whether a projectile has bounce behaviour available. Throwables are
// always wall-bouncy; their configured maxBounces is reserved for boomerang
// endpoint reversals rather than wall impacts.
function isBouncyProjectile(bullet) {
	return bullet.throwable === true || Math.max(0, bullet.maxBounces ?? 0) > 0;
}

function triggerSuccessfulBounceExplosion(bullet, isPlayerBullets, currentTime) {
	if ((bullet.explosionRadiusBlocks ?? 0) > 0) {
		detonateBullet(bullet, isPlayerBullets, currentTime);
	}
}

function projectileRect(bullet) {
	return {
		x: bullet.x - bullet.radius,
		y: bullet.y - bullet.radius,
		size: bullet.radius * 2,
	};
}

// Substeps projectile movement, reflects bullets from walls, applies damage to
// valid targets, handles penetration/bounce synergies, advances closed-form
// throwable legs, tags zero-movement projectiles, and removes expired bullets.
export function processBullets(bulletArray, isPlayerBullets, currentTime, dt) {
	for (let i = bulletArray.length - 1; i >= 0; i--) {
		const b = bulletArray[i];
		const targets = isPlayerBullets ? GameState.enemies : [player];

		if (
			b.detonationTimeMs > 0 &&
			currentTime - b.createdAt >= b.detonationTimeMs
		) {
			detonateBullet(b, isPlayerBullets, currentTime);
			bulletArray.splice(i, 1);
			continue;
		}

		let frameDistance;
		let desiredThrowTravel = null;
		let throwReachedTerminalTime = false;

		if (b.throwable) {
			const legStartedAt = b.throwLegStartedAt ?? b.createdAt;
			const throwElapsedMs = Math.max(0, currentTime - legStartedAt);
			const isBoomerangLeg = (b.throwBounces ?? 0) > 0;
			const throwLegDistanceBlocks =
				b.throwDistanceBlocks * (isBoomerangLeg ? 2 : 1);
			const throwLegDurationMs =
				b.throwFlightDurationMs * (isBoomerangLeg ? 2 : 1);

			throwReachedTerminalTime =
				throwLegDistanceBlocks <= 0 ||
				throwElapsedMs >= throwLegDurationMs;

			if (throwReachedTerminalTime) {
				desiredThrowTravel = throwLegDistanceBlocks;
			} else if (isBoomerangLeg) {
				desiredThrowTravel = getThrowableBoomerangTravelDistance(
					b.throwDistanceBlocks,
					throwElapsedMs,
					b.throwDeceleration,
					b.throwInitialSpeed,
					b.throwFlightDurationMs,
				);
			} else {
				desiredThrowTravel = getThrowableTravelDistance(
					b.throwDistanceBlocks,
					throwElapsedMs,
					b.throwDeceleration,
					b.throwInitialSpeed,
					b.throwFlightDurationMs,
				);
			}

			frameDistance = Math.max(
				0,
				desiredThrowTravel - (b.throwTravelledBlocks ?? 0),
			);
		} else {
			frameDistance = Math.hypot(b.vx, b.vy) * dt;
		}

		// dv is the projectile's intended movement magnitude for this simulation
		// update. Projectile/projectile collision uses it to distinguish a fixed
		// stationary collider from a moving projectile.
		b.dv = frameDistance;

		const steps = Math.max(
			1,
			Math.ceil(frameDistance / BULLET_MAX_STEP_BLOCKS),
		);
		const stepDt = dt / steps;
		const throwableStepDistance = b.throwable ? frameDistance / steps : 0;
		const bouncy = isBouncyProjectile(b);

		let removeBullet = false;
		let detonateOnRemoval = false;

		for (let step = 0; step < steps; step++) {
			const intendedStepDistance = b.throwable
				? throwableStepDistance
				: Math.hypot(b.vx * stepDt, b.vy * stepDt);
			const penetrationStepState = {
				phaseThisStep:
					Math.max(
						0,
						Number(
							b.remainingPenetrationBlocks ??
								b.penetrationBlocks ??
								0,
						) || 0,
					) > 0,
				travelDistanceBlocks: intendedStepDistance,
				consumed: false,
			};

			const mockRect = projectileRect(b);
			const moveX = b.throwable
				? b.throwDirX * throwableStepDistance
				: b.vx * stepDt;

			b.x += moveX;
			mockRect.x = b.x - b.radius;
			mockRect.y = b.y - b.radius;

			const hitWallX = moveX === 0 ? null : GameState.walls.find((w) =>
				collidesWithWallUsingPenetrationBudget(
					b,
					mockRect,
					w,
					penetrationStepState,
					bouncy,
				),
			);

			if (hitWallX) {
				b.x -= moveX;
				mockRect.x = b.x - b.radius;

				if (b.throwable) {
					// Wall bounces are unlimited for throwables. maxBounces instead
					// controls boomerang reversals at throw-leg endpoints.
					b.throwDirX *= -1;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else if (b.bounces < b.maxBounces) {
					b.vx *= -1;
					b.bounces++;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else {
					removeBullet = true;
					detonateOnRemoval = b.detonatesOnImpact;
					break;
				}
			}

			const moveY = b.throwable
				? b.throwDirY * throwableStepDistance
				: b.vy * stepDt;

			b.y += moveY;
			mockRect.x = b.x - b.radius;
			mockRect.y = b.y - b.radius;

			const hitWallY = moveY === 0 ? null : GameState.walls.find((w) =>
				collidesWithWallUsingPenetrationBudget(
					b,
					mockRect,
					w,
					penetrationStepState,
					bouncy,
				),
			);

			if (hitWallY) {
				b.y -= moveY;
				mockRect.y = b.y - b.radius;

				if (b.throwable) {
					b.throwDirY *= -1;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else if (b.bounces < b.maxBounces) {
					b.vy *= -1;
					b.bounces++;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else {
					removeBullet = true;
					detonateOnRemoval = b.detonatesOnImpact;
					break;
				}
			}

			// Once a bouncy projectile has spent its last penetration inside wall
			// material, keep phasing until its entire hitbox is clear. Only then is
			// the next wall contact allowed to execute a bounce/collision action.
			if (b.finishPenetratedWall && bouncy) {
				mockRect.x = b.x - b.radius;
				mockRect.y = b.y - b.radius;
				if (!GameState.walls.some((w) => isColliding(mockRect, w))) {
					b.finishPenetratedWall = false;
				}
			}

			// Target damage is independent of wall penetration. Any actual overlap
			// damages immediately and target contact never consumes penetration.
			targets.forEach((t) => {
				const isTargetCollision = isColliding(mockRect, t);

				if (isTargetCollision) {
					if (!b.hitTargets.has(t)) {
						if (isPlayerBullets || !GameState.isInvincible) {
							t.hp -= b.damage ?? 1;
						}
						b.hitTargets.add(t);
					}
				} else {
					b.hitTargets.delete(t);
				}
			});
		}

		if (removeBullet) {
			if (detonateOnRemoval) {
				detonateBullet(b, isPlayerBullets, currentTime);
			}
			bulletArray.splice(i, 1);
			continue;
		}

		if (b.throwable && desiredThrowTravel !== null) {
			const isBoomerangLeg = (b.throwBounces ?? 0) > 0;
			const throwLegDistanceBlocks =
				b.throwDistanceBlocks * (isBoomerangLeg ? 2 : 1);

			b.throwTravelledBlocks = throwReachedTerminalTime
				? throwLegDistanceBlocks
				: desiredThrowTravel;

			if (throwReachedTerminalTime) {
				const configuredBoomerangBounces = Math.max(
					0,
					Math.floor(Number(b.maxBounces ?? 0) || 0),
				);

				if ((b.throwBounces ?? 0) < configuredBoomerangBounces) {
					// A throwable bounce reverses direction by 180 degrees. The first
					// outbound leg is D and ends at v=0. Each bounce leg is 2D: it
					// accelerates from 0 to the original launch speed over the first D,
					// then decelerates back to 0 over the second D. One full 2D leg
					// consumes exactly one configured boomerang bounce.
					b.throwDirX *= -1;
					b.throwDirY *= -1;
					b.throwBounces = (b.throwBounces ?? 0) + 1;
					b.throwLegStartedAt = currentTime;
					b.throwTravelledBlocks = 0;
					b.throwComplete = false;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else {
					b.throwComplete = true;

					if (b.detonatesOnImpact) {
						detonateBullet(b, isPlayerBullets, currentTime);
						bulletArray.splice(i, 1);
						continue;
					}
				}
			} else {
				b.throwComplete = false;
			}
		}

		if (currentTime - b.createdAt > b.lifetimeMs) {
			bulletArray.splice(i, 1);
			continue;
		}

	}
}
