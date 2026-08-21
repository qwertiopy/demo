// Enemy spawning, shooting, AI movement, and enemy/enemy separation.

import { Config } from "../config.js";
import { GameState, player } from "../state.js";
import { handleWallCollisions, seededRandom } from "../utils.js";
import { hasLineOfSight } from "./collision.js";
import { shoot } from "./projectiles.js";
import {
	calculateGapSafeWallAngle,
	calculateInterceptAim,
	calculateMaximumLeadHalfAngle,
} from "./targeting.js";
import { shortestAngleDelta } from "./weapon-utils.js";

const WALL_ANGLE_EPSILON = 1e-9;

function resetWallAttack(enemy, resetLeadHistory = false) {
	enemy.aimMode = "lead";
	enemy.wallStartSide = 0;
	enemy.wallSweepDirection = 0;
	enemy.wallFrontierAngle = null;
	enemy.wallMaxHalfAngle = 0;
	enemy.wallLastSafeStep = 0;
	enemy.wallDeadline = 0;

	if (resetLeadHistory) {
		enemy.lastLeadPlayerVx = null;
		enemy.lastLeadPlayerVy = null;
		enemy.lastPredictedShotAngle = null;
	}
}

function recordEnemyShot(enemy, playerCenterX, playerCenterY, currentTime) {
	// Every actual shot, including a wall shot, begins the next averaged-velocity
	// window. This keeps the next lead prediction tied to the most recent shot.
	enemy.playerXAtLastShot = playerCenterX;
	enemy.playerYAtLastShot = playerCenterY;
	enemy.lastShot = currentTime;
}

function fireEnemyProjectile(
	enemy,
	enemyCenterX,
	enemyCenterY,
	playerCenterX,
	playerCenterY,
	currentTime,
	firingAngle,
	spread,
) {
	const stats = enemy.typeStats;
	const baseBulletSpeed = Math.max(0, Number(stats.bulletSpeed) || 0);

	shoot(
		enemy,
		enemyCenterX + Math.cos(firingAngle),
		enemyCenterY + Math.sin(firingAngle),
		GameState.enemyBullets,
		{
			color: stats.bulletColor,
			speed: baseBulletSpeed,
			speedVariation: stats.bulletSpeedVariation ?? 0,
			radiusBlocks: stats.bulletRadiusBlocks,
			radiusVariation: stats.bulletRadiusVariation ?? 0,
			damage: stats.bulletDamage,
			damageVariation: stats.bulletDamageVariation ?? 0,
			maxBounces: 0,
			spread,
			bulletCount: stats.bulletCount ?? 1,
			explosionRadiusBlocks: stats.bulletExplosionRadiusBlocks ?? 0,
			detonationTimeMs: stats.bulletDetonationTimeMs ?? 0,
			explosionDurationMs: stats.bulletExplosionDurationMs ?? 0,
			explosionDamage: stats.bulletExplosionDamage ?? 0,
			detonatesOnImpact: stats.bulletDetonatesOnImpact ?? false,
			penetrationBlocks: stats.bulletPenetrationBlocks ?? 0,
			bulletCollision: stats.bulletCollision === true,
		},
	);

	recordEnemyShot(
		enemy,
		playerCenterX,
		playerCenterY,
		currentTime,
	);
}

function getVariedLeadFiringAngle(
	enemy,
	predictedAngle,
	directAngle,
	baseBulletSpeed,
	spread,
) {
	const predictionVariationThreshold = Math.max(
		0,
		Number(enemy.typeStats.predictionVariationThreshold ?? 0.1) || 0,
	);
	const predictionVariation = Math.max(
		0,
		Number(enemy.typeStats.predictionVariation ?? 0.04) || 0,
	);
	let firingAngle = predictedAngle;

	// Preserve the existing prediction-variation gate for ordinary lead shots.
	// Wall shots bypass this helper because random offsets would create gaps.
	if (
		spread <= predictionVariationThreshold &&
		Number.isFinite(enemy.lastPredictedShotAngle) &&
		Math.abs(
			shortestAngleDelta(
				enemy.lastPredictedShotAngle,
				predictedAngle,
			),
		) <= predictionVariationThreshold &&
		predictionVariation > 0
	) {
		firingAngle += (Math.random() - 0.5) * predictionVariation;
	}

	// Store the raw prediction so variation never feeds back into the comparison.
	enemy.lastPredictedShotAngle = predictedAngle;

	// Apply variation first, then keep the result inside the physically possible
	// lead cone around the current direct line-of-sight angle.
	const maxLeadHalfAngle = calculateMaximumLeadHalfAngle(
		player.speed,
		baseBulletSpeed,
	);
	const variedOffset = shortestAngleDelta(directAngle, firingAngle);
	const clampedOffset = Math.max(
		-maxLeadHalfAngle,
		Math.min(maxLeadHalfAngle, variedOffset),
	);

	return directAngle + clampedOffset;
}

function getWallShotGeometry(enemy, distance) {
	const stats = enemy.typeStats;
	const playerSpeed = Math.max(0, Number(player.speed) || 0);
	const baseBulletSpeed = Math.max(0, Number(stats.bulletSpeed) || 0);
	const speedVariation = Math.max(
		0,
		Number(stats.bulletSpeedVariation ?? 0) || 0,
	);
	const minimumBulletSpeed = Math.max(0, baseBulletSpeed - speedVariation);
	const baseBulletRadius = Math.max(
		0,
		Number(stats.bulletRadiusBlocks) || 0,
	);
	const radiusVariation = Math.max(
		0,
		Number(stats.bulletRadiusVariation ?? 0) || 0,
	);
	const minimumBulletRadius = Math.max(0, baseBulletRadius - radiusVariation);
	const combinedHitRadius = Math.max(0, Number(player.size) || 0) / 2 +
		minimumBulletRadius;
	const shotIntervalSeconds = Math.max(
		0,
		Number(enemy.shootCooldown) || 0,
	) / 1000;
	const safetyFactor = Math.max(
		0,
		Math.min(
			1,
			Number(stats.wallGapSafetyFactor ?? 0.9) || 0,
		),
	);
	const maxHalfAngle = calculateMaximumLeadHalfAngle(
		playerSpeed,
		minimumBulletSpeed,
	);
	const safeStep = calculateGapSafeWallAngle(
		distance,
		playerSpeed,
		minimumBulletSpeed,
		shotIntervalSeconds,
		combinedHitRadius,
		safetyFactor,
	);
	const spread = Math.max(0, Number(stats.spread ?? 0) || 0);
	const bulletCount = Math.max(
		1,
		Math.floor(Number(stats.bulletCount ?? 1) || 1),
	);

	return {
		canStart:
			minimumBulletSpeed > playerSpeed + WALL_ANGLE_EPSILON &&
			maxHalfAngle > WALL_ANGLE_EPSILON &&
			safeStep > WALL_ANGLE_EPSILON &&
			spread <= WALL_ANGLE_EPSILON &&
			bulletCount === 1,
		maxHalfAngle,
		safeStep,
	};
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
					lastPredictedShotAngle: null,
					playerXAtLastShot: null,
					playerYAtLastShot: null,
					lastLeadPlayerVx: null,
					lastLeadPlayerVy: null,
					currentPredictedShotAngle: null,
					aimMode: "lead",
					wallStartSide: 0,
					wallSweepDirection: 0,
					wallFrontierAngle: null,
					wallMaxHalfAngle: 0,
					wallLastSafeStep: 0,
					wallDeadline: 0,
					nextWallStartSide: 1,
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

		const shotIntervalSeconds = (currentTime - e.lastShot) / 1000;
		const hasPreviousShotSample =
			Number.isFinite(e.playerXAtLastShot) &&
			Number.isFinite(e.playerYAtLastShot) &&
			Number.isFinite(shotIntervalSeconds) &&
			shotIntervalSeconds > 0;
		const averagePlayerVx = hasPreviousShotSample
			? (pCenterX - e.playerXAtLastShot) / shotIntervalSeconds
			: player.vx;
		const averagePlayerVy = hasPreviousShotSample
			? (pCenterY - e.playerYAtLastShot) / shotIntervalSeconds
			: player.vy;
		const baseBulletSpeed = Math.max(
			0,
			Number(e.typeStats.bulletSpeed) || 0,
		);
		const directAngle = Math.atan2(
			pCenterY - eCenterY,
			pCenterX - eCenterX,
		);
		const intercept = calculateInterceptAim(
			eCenterX,
			eCenterY,
			pCenterX,
			pCenterY,
			averagePlayerVx,
			averagePlayerVy,
			baseBulletSpeed,
		);
		const predictedAngle = intercept?.angle ?? directAngle;
		const spread = Math.max(
			0,
			Number(e.typeStats.spread ?? 0) || 0,
		);
		const distanceToPlayer = Math.hypot(
			pCenterX - eCenterX,
			pCenterY - eCenterY,
		);

		// Prediction is deliberately refreshed every frame, not merely when the
		// cooldown expires. A committed wall tracks it but never reacts to it.
		e.currentPredictedShotAngle = predictedAngle;

		if (los) {
			e.lastSeenX = pCenterX;
			e.lastSeenY = pCenterY;
		}

		// Existing visibility rules still gate firing. Losing visibility pauses a
		// committed wall without cancelling it; only its opposite endpoint ends it.
		if (los && currentTime - e.lastShot > e.shootCooldown) {
			let firedThisFrame = false;

			if (e.aimMode === "wall") {
				const startSide = e.wallStartSide === -1 ? -1 : 1;
				const sweepDirection = -startSide;
				const frontierAngle = Number.isFinite(e.wallFrontierAngle)
					? e.wallFrontierAngle
					: directAngle + startSide * e.wallMaxHalfAngle;
				const opposingAngle =
					directAngle - startSide * e.wallMaxHalfAngle;
				const remainingAngle = sweepDirection * shortestAngleDelta(
					frontierAngle,
					opposingAngle,
				);

				if (remainingAngle <= WALL_ANGLE_EPSILON) {
					// The moving opposing boundary has already reached the frontier.
					// Reset and use this still-available firing opportunity for step 1.
					resetWallAttack(e, true);
				} else {
					const wallGeometry = getWallShotGeometry(e, distanceToPlayer);
					if (wallGeometry.safeStep > WALL_ANGLE_EPSILON) {
						e.wallLastSafeStep = wallGeometry.safeStep;
					}

					const wallMaxDurationMs = Math.max(
						1,
						Number(e.typeStats.wallMaxDurationMs ?? 1500) || 0,
					);
					if (!Number.isFinite(e.wallDeadline) || e.wallDeadline <= 0) {
						e.wallDeadline = currentTime + wallMaxDurationMs;
					}

					// Prefer gap-safe spacing, but impose a completion floor so a wall
					// reaches its opposite boundary by the deadline. Wider gaps are
					// intentional here: forcing a dodge is preferable to an unfinished wall.
					const cooldownMs = Math.max(
						1,
						Number(e.shootCooldown) || 0,
					);
					const remainingDurationMs = Math.max(
						0,
						e.wallDeadline - currentTime,
					);
					const remainingShots = Math.max(
						1,
						Math.ceil(remainingDurationMs / cooldownMs),
					);
					const completionStep = remainingAngle / remainingShots;
					const safeStep = Math.max(
						WALL_ANGLE_EPSILON,
						e.wallLastSafeStep,
					);
					const step = Math.min(
						remainingAngle,
						Math.max(safeStep, completionStep),
					);
					const firingAngle =
						frontierAngle + sweepDirection * step;

					fireEnemyProjectile(
						e,
						eCenterX,
						eCenterY,
						pCenterX,
						pCenterY,
						currentTime,
						firingAngle,
						0,
					);
					e.wallFrontierAngle = firingAngle;
					firedThisFrame = true;

					if (remainingAngle - step <= WALL_ANGLE_EPSILON) {
						resetWallAttack(e, true);
					}
				}
			}

			if (!firedThisFrame && e.aimMode !== "wall") {
				const velocityChangeThreshold = Math.max(
					0,
					Number(
						e.typeStats.wallVelocityChangeThreshold ?? 0.1,
					) || 0,
				);
				const hasPreviousLeadVector =
					Number.isFinite(e.lastLeadPlayerVx) &&
					Number.isFinite(e.lastLeadPlayerVy);
				const playerVectorChanged =
					!hasPreviousLeadVector ||
					Math.hypot(
						player.vx - e.lastLeadPlayerVx,
						player.vy - e.lastLeadPlayerVy,
					) > velocityChangeThreshold;

				if (!playerVectorChanged) {
					const wallGeometry = getWallShotGeometry(e, distanceToPlayer);

					if (wallGeometry.canStart) {
						const leadOffset = shortestAngleDelta(
							directAngle,
							predictedAngle,
						);
						const fallbackSide = e.nextWallStartSide === -1 ? -1 : 1;
						const startSide = Math.abs(leadOffset) > WALL_ANGLE_EPSILON
							? Math.sign(leadOffset)
							: fallbackSide;
						const firingAngle =
							directAngle + startSide * wallGeometry.maxHalfAngle;

						e.aimMode = "wall";
						e.wallStartSide = startSide;
						e.wallSweepDirection = -startSide;
						e.wallFrontierAngle = firingAngle;
						e.wallMaxHalfAngle = wallGeometry.maxHalfAngle;
						e.wallLastSafeStep = wallGeometry.safeStep;
						e.wallDeadline =
							currentTime + Math.max(
								1,
								Number(e.typeStats.wallMaxDurationMs ?? 1500) || 0,
							);
						e.nextWallStartSide = -startSide;

						fireEnemyProjectile(
							e,
							eCenterX,
							eCenterY,
							pCenterX,
							pCenterY,
							currentTime,
							firingAngle,
							0,
						);
						firedThisFrame = true;
					}
				}

				if (!firedThisFrame) {
					const firingAngle = getVariedLeadFiringAngle(
						e,
						predictedAngle,
						directAngle,
						baseBulletSpeed,
						spread,
					);

					fireEnemyProjectile(
						e,
						eCenterX,
						eCenterY,
						pCenterX,
						pCenterY,
						currentTime,
						firingAngle,
						spread,
					);
					e.lastLeadPlayerVx = player.vx;
					e.lastLeadPlayerVy = player.vy;
				}
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
				// Exact overlap has no geometric separation normal. Pick one angle
				// once so nx/ny still form a unit vector instead of sampling two
				// unrelated random directions.
				const overlapAngle = distance === 0
					? Math.random() * Math.PI * 2
					: 0;
				const nx = distance === 0
					? Math.cos(overlapAngle)
					: dx / distance;
				const ny = distance === 0
					? Math.sin(overlapAngle)
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

	// Apply the displacement calculated for this tick only after enemy/enemy
	// separation has adjusted it. Previously updateEnemies() moved with the
	// previous tick's moveX/moveY and this freshly resolved vector waited until
	// the next frame.
	GameState.enemies.forEach((e) => {
		handleWallCollisions(e, e.moveX, e.moveY);
	});
}
