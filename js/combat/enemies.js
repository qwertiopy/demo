// Enemy spawning, shooting, AI movement, and enemy/enemy separation.

import { Config } from "../config.js";
import { GameState, player } from "../state.js";
import { handleWallCollisions, seededRandom } from "../utils.js";
import { hasLineOfSight } from "./collision.js";
import { shoot } from "./projectiles.js";

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
					bulletCount: e.typeStats.bulletCount ?? 1,
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
