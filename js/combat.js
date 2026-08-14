// Weapons, line-of-sight, enemy AI, entity collisions, and bullets.

import { Config } from "./config.js";
import { GameState, player } from "./state.js";
import { isColliding } from "./utils.js";
import { seededRandom } from "./utils.js";

// Creates a projectile aimed from a shooter's center toward a world-space target and stores velocity, damage, bounce, and lifetime data.
export function shoot(shooter, targetX, targetY, bulletArray, stats) {
	const centerX = shooter.x + shooter.size / 2;
	const centerY = shooter.y + shooter.size / 2;
	const spread = stats.spreadOffset || 0;
	const angle = Math.atan2(targetY - centerY, targetX - centerX) + spread;
	const speed = stats.speed ?? 12;

	// clamps max number of bullets to 100 (?????)
	if (bulletArray === GameState.bullets && GameState.bullets.length >= 100) {
		GameState.bullets.shift();
	}

	// create new bullet with data and push it to the bullet array
	// worth refactoring to instantiate then push a default bullet object instead of creating one inline here
	bulletArray.push({
		x: centerX,
		y: centerY,
		radius: stats.radiusBlocks || 0.08,
		vx: Math.cos(angle) * speed,
		vy: Math.sin(angle) * speed,
		color: stats.color || "white",
		damage: stats.damage || 1,
		bounces: 0,
		maxBounces: stats.maxBounces || 0,
		hitTargets: new Set(),
		createdAt: performance.now(),

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

		// if distance to the player is above a certain threshold, despawn the enemy
		let threshold = 100;
		let dx = pCenterX - eCenterX;
		let dy = pCenterY - eCenterY;
		let dist = Math.hypot(dx, dy);
		if (dist > threshold) {
			return false;
		}

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

// Maximum projectile travel per collision substep; limiting this prevents fast bullets from tunneling through walls or targets
// this can also be done by using the line of sight function to see if the bullet intersected a wall at any point between 2 steps, and if it did, reversing its direction or deleting it
// i think doing it that way is more robust and allows for faster bullets and is also generally less buggy because it relies on continuous mathematical calculations - cyn
export const BULLET_MAX_STEP_BLOCKS = 0.2;

// Substeps projectile movement, reflects bullets from walls, applies damage to valid targets, enforces bounce/lifetime limits, and removes expired bullets
export function processBullets(bulletArray, isPlayerBullets, currentTime, dt) {
	for (let i = bulletArray.length - 1; i >= 0; i--) {
		const b = bulletArray[i];
		const targets = isPlayerBullets ? GameState.enemies : [player];

		const frameDistance = Math.hypot(b.vx, b.vy) * dt;
		const steps = Math.max(
			1,
			Math.ceil(frameDistance / BULLET_MAX_STEP_BLOCKS),
		);
		const stepDt = dt / steps;

		let removeBullet = false;

		for (let step = 0; step < steps; step++) {
			const mockRect = {
				x: b.x - b.radius,
				y: b.y - b.radius,
				size: b.radius * 2,
			};

			const moveX = b.vx * stepDt;
			b.x += moveX;
			mockRect.x = b.x - b.radius;
			mockRect.y = b.y - b.radius;

			if (GameState.walls.some((w) => isColliding(mockRect, w))) {
				b.x -= moveX;
				b.vx *= -1;
				b.bounces++;
				mockRect.x = b.x - b.radius;
			}

			const moveY = b.vy * stepDt;
			b.y += moveY;
			mockRect.x = b.x - b.radius;
			mockRect.y = b.y - b.radius;

			if (GameState.walls.some((w) => isColliding(mockRect, w))) {
				b.y -= moveY;
				b.vy *= -1;
				b.bounces++;
				mockRect.y = b.y - b.radius;
			}

			targets.forEach((t) => {
				if (isColliding(mockRect, t)) {
					if (!b.hitTargets.has(t)) {
						if (isPlayerBullets || !GameState.isInvincible) {
							t.hp -= b.damage || 1;
						}

						b.hitTargets.add(t);
					}
				} else {
					b.hitTargets.delete(t);
				}
			});

			if (b.bounces > b.maxBounces) {
				removeBullet = true;
				break;
			}
		}

		if (removeBullet || currentTime - b.createdAt > 60000) {
			bulletArray.splice(i, 1);
		}
	}
}
