import { hasLineOfSight, shoot } from "./combat.js";
import { GameState } from "./state.js";

export function handleEnemyAI(e, currentTime, dt) {
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
				explosionDurationMs: e.typeStats.bulletExplosionDurationMs ?? 0,
				explosionDamage: e.typeStats.bulletExplosionDamage ?? 0,
				detonatesOnImpact: e.typeStats.bulletDetonatesOnImpact ?? false,
			});

			e.lastShot = currentTime;
		}
	}

	//TODO: implement pathfinding algorithm

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
			const angle = Math.atan2(targetY - eCenterY, targetX - eCenterX);

			e.vx = Math.cos(angle) * e.speed;
			e.vy = Math.sin(angle) * e.speed;
		}
	}
}
