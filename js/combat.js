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
) {
	const kinematics = getThrowableKinematics(
		distanceBlocks,
		decelerationBlocksPerSecondSq,
	);

	if (kinematics.distanceBlocks === 0) return 0;

	const rawElapsedSeconds = Math.max(
		(Number(elapsedMs) || 0) / 1000,
		0,
	);

	// Once the analytically derived flight time has elapsed, the projectile is
	// at the terminal point by definition. Return the exact configured distance
	// rather than relying on floating-point evaluation of s(t) to equal D.
	if (rawElapsedSeconds >= kinematics.durationSeconds) {
		return kinematics.distanceBlocks;
	}

	const travelled =
		kinematics.initialSpeed * rawElapsedSeconds -
		0.5 * kinematics.deceleration * rawElapsedSeconds * rawElapsedSeconds;

	return Math.min(
		kinematics.distanceBlocks,
		Math.max(0, travelled),
	);
}

// Creates a projectile aimed from a shooter's center toward a world-space target and stores velocity, damage, bounce, and lifetime data.
export function shoot(shooter, targetX, targetY, bulletArray, stats) {
	if (GameState.isPlayerDead) return;

	const centerX = shooter.x + shooter.size / 2;
	const centerY = shooter.y + shooter.size / 2;
	const targetDx = targetX - centerX;
	const targetDy = targetY - centerY;
	const spread = stats.spreadOffset || 0;
	const angle = Math.atan2(targetDy, targetDx) + spread;
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
		throwable,
		throwDirX: Math.cos(angle),
		throwDirY: Math.sin(angle),
		throwDistanceBlocks,
		throwDistanceMultiplier,
		throwTravelledBlocks: 0,
		throwDeceleration,
		throwInitialSpeed: throwKinematics?.initialSpeed ?? 0,
		throwFlightDurationMs: throwKinematics?.durationMs ?? 0,
		throwComplete: !throwable || throwDistanceBlocks === 0,

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
				const spreadOffset =
					(Math.random() - 0.5) * (e.typeStats.spread || 0);

				shoot(e, pCenterX, pCenterY, GameState.enemyBullets, {
					color: e.typeStats.bulletColor,
					speed: e.typeStats.bulletSpeed,
					radiusBlocks: e.typeStats.bulletRadiusBlocks,
					damage: e.typeStats.bulletDamage,
					maxBounces: 0,
					spreadOffset,
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
) {
	if (!isColliding(mover, wall)) return false;

	// A substep that began with penetration available is allowed to complete.
	// Charge its intended travel distance only once even if the bullet overlaps
	// multiple wall rectangles or is checked on both collision axes.
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
		}
		return false;
	}

	return true;
}

// Hardcoded laser presentation/range values. Weapon balance is controlled by
// the configurable warmup/cooldown/damage/penetration stats instead.
export const LASER_MAX_RANGE_BLOCKS = 60;
export const LASER_FLASH_DURATION_MS = 90;

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

	let tMin = -Infinity;
	let tMax = Infinity;

	for (const [origin, direction, min, max] of [
		[originX, dirX, minX, maxX],
		[originY, dirY, minY, maxY],
	]) {
		if (Math.abs(direction) < EPSILON) {
			if (origin < min || origin > max) return null;
			continue;
		}

		let t1 = (min - origin) / direction;
		let t2 = (max - origin) / direction;

		if (t1 > t2) [t1, t2] = [t2, t1];
		tMin = Math.max(tMin, t1);
		tMax = Math.min(tMax, t2);

		if (tMax < tMin) return null;
	}

	if (tMax < 0) return null;

	return {
		entryDistance: Math.max(0, tMin),
		exitDistance: tMax,
	};
}

// Hitscan lasers consume penetration continuously while the ray is travelling
// through wall material. Because a laser has no simulation ticks, we calculate
// each wall interval along the ray, merge overlapping intervals, then subtract
// their lengths from one local penetration budget in travel order. Targets do
// not consume this budget.
export function getLaserWallStopWithPenetrationBudget(
	originX,
	originY,
	dirX,
	dirY,
	radius,
	penetrationBlocks,
) {
	let remainingPenetrationBlocks = Math.max(
		0,
		Number(penetrationBlocks) || 0,
	);
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
		if (!hit || hit.entryDistance > LASER_MAX_RANGE_BLOCKS) continue;

		const entryDistance = Math.max(0, hit.entryDistance);
		const exitDistance = Math.min(
			LASER_MAX_RANGE_BLOCKS,
			hit.exitDistance,
		);
		if (exitDistance <= entryDistance) continue;

		wallIntervals.push({ entryDistance, exitDistance });
	}

	wallIntervals.sort((a, b) => a.entryDistance - b.entryDistance);

	// Merge overlapping wall intervals so overlapping wall rectangles do not
	// charge the same physical section of the beam more than once.
	const mergedIntervals = [];
	for (const interval of wallIntervals) {
		const previous = mergedIntervals[mergedIntervals.length - 1];
		if (previous && interval.entryDistance <= previous.exitDistance) {
			previous.exitDistance = Math.max(
				previous.exitDistance,
				interval.exitDistance,
			);
		} else {
			mergedIntervals.push({ ...interval });
		}
	}

	for (const interval of mergedIntervals) {
		const wallTravelBlocks =
			interval.exitDistance - interval.entryDistance;

		if (remainingPenetrationBlocks >= wallTravelBlocks) {
			remainingPenetrationBlocks -= wallTravelBlocks;
			continue;
		}

		// The laser can enter the wall only as far as its remaining penetration
		// budget allows, then its normal wall-impact action occurs there.
		const stopDistance =
			interval.entryDistance + remainingPenetrationBlocks;

		return {
			distance: Math.min(LASER_MAX_RANGE_BLOCKS, stopDistance),
			impactedWall: true,
			remainingPenetrationBlocks: 0,
		};
	}

	return {
		distance: LASER_MAX_RANGE_BLOCKS,
		impactedWall: false,
		remainingPenetrationBlocks,
	};
}

function resolveLaserShot(shot, currentTime) {
	const shooter = shot.shooter;
	const originX = shooter.x + shooter.size / 2;
	const originY = shooter.y + shooter.size / 2;
	const { dirX, dirY, stats } = shot;
	const radius = Math.max(0, Number(stats.radiusBlocks ?? 0.03) || 0);
	const penetrationBlocks = Math.max(
		0,
		Number(stats.penetrationBlocks ?? 0) || 0,
	);

	const wallStop = getLaserWallStopWithPenetrationBudget(
		originX,
		originY,
		dirX,
		dirY,
		radius,
		penetrationBlocks,
	);
	const beamDistance = wallStop.distance;
	const impactedWall = wallStop.impactedWall;

	// Penetration only governs walls. Targets take damage whenever the beam
	// actually intersects them before the beam's wall-limited endpoint.
	for (const target of GameState.enemies) {
		if (target.hp <= 0) continue;

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
		durationMs: LASER_FLASH_DURATION_MS,
	});

	if (impactedWall && stats.detonatesOnImpact) {
		detonateBullet(
			{
				x: endX,
				y: endY,
				color: stats.color ?? "white",
				explosionRadiusBlocks: stats.explosionRadiusBlocks ?? 0,
				explosionDurationMs: stats.explosionDurationMs ?? 0,
				explosionDamage: stats.explosionDamage ?? 0,
			},
			true,
			currentTime,
		);
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
		(stats.spreadOffset || 0);
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

// Substeps projectile movement, reflects bullets from walls, applies damage to valid targets, enforces bounce/lifetime limits, and removes expired bullets
export function processBullets(bulletArray, isPlayerBullets, currentTime, dt) {
	for (let i = bulletArray.length - 1; i >= 0; i--) {
		const b = bulletArray[i];
		const targets = isPlayerBullets ? GameState.enemies : [player];

		// A positive detonationTimeMs enables a timed fuse. 0 means no timed
		// detonation, allowing impact-only or completely non-explosive bullets.
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
			// Closed-form total distance from launch using constant deceleration. We do
			// not integrate acceleration or velocity each frame; the frame only moves
			// the exact remaining delta. The analytically derived terminal time is the
			// authoritative completion condition, avoiding fragile float equality checks.
			const throwElapsedMs = Math.max(0, currentTime - b.createdAt);
			throwReachedTerminalTime =
				b.throwDistanceBlocks <= 0 ||
				throwElapsedMs >= b.throwFlightDurationMs;

			desiredThrowTravel = throwReachedTerminalTime
				? b.throwDistanceBlocks
				: getThrowableTravelDistance(
					b.throwDistanceBlocks,
					throwElapsedMs,
					b.throwDeceleration,
				);

			frameDistance = Math.max(
				0,
				desiredThrowTravel - b.throwTravelledBlocks,
			);
		} else {
			frameDistance = Math.hypot(b.vx, b.vy) * dt;
		}

		const steps = Math.max(
			1,
			Math.ceil(frameDistance / BULLET_MAX_STEP_BLOCKS),
		);
		const stepDt = dt / steps;
		const throwableStepDistance = b.throwable ? frameDistance / steps : 0;

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

			const mockRect = {
				x: b.x - b.radius,
				y: b.y - b.radius,
				size: b.radius * 2,
			};

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
				),
			);

			if (hitWallX) {
				b.x -= moveX;

				if (b.throwable) {
					b.throwDirX *= -1;
				} else {
					b.vx *= -1;
				}

				b.bounces++;
				mockRect.x = b.x - b.radius;

				if (b.bounces > b.maxBounces) {
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
				),
			);

			if (hitWallY) {
				b.y -= moveY;

				if (b.throwable) {
					b.throwDirY *= -1;
				} else {
					b.vy *= -1;
				}

				b.bounces++;
				mockRect.y = b.y - b.radius;

				if (b.bounces > b.maxBounces) {
					removeBullet = true;
					detonateOnRemoval = b.detonatesOnImpact;
					break;
				}
			}

			// Wall penetration never suppresses target damage. If the projectile's
			// hitbox overlaps a target, damage is applied immediately regardless of
			// how much wall-penetration budget remains.
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
			// At terminal time, snap the path-distance state to D exactly. This avoids
			// a projectile getting permanently stuck at D - tiny floating-point error.
			b.throwTravelledBlocks = throwReachedTerminalTime
				? b.throwDistanceBlocks
				: desiredThrowTravel;
			b.throwComplete = throwReachedTerminalTime;

			// For throwables, terminal time corresponds exactly to v = 0, so it is
			// treated as an impact when detonatesOnImpact is enabled.
			if (b.throwComplete && b.detonatesOnImpact) {
				detonateBullet(b, isPlayerBullets, currentTime);
				bulletArray.splice(i, 1);
				continue;
			}
		}

		if (currentTime - b.createdAt > b.lifetimeMs) {
			bulletArray.splice(i, 1);
		}
	}
}
