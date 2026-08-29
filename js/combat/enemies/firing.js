// Enemy projectile firing primitives.

import { Config } from "../../config.js";
import { resolveProjectileDefinition } from "../projectile-schema.js";
import { shoot } from "../projectiles.js";
import { calculateMaximumLeadHalfAngle } from "../targeting.js";
import { clampAngleToInterval } from "../visibility.js";
import { shortestAngleDelta } from "../weapon-utils.js";
import { getMaximumPlayerMovementSpeed } from "./helpers.js";

function recordEnemyShot(enemy, playerCenterX, playerCenterY, currentTime) {
	// Every actual shot, including a wall shot, begins the next averaged-velocity
	// window. This keeps the next lead prediction tied to the most recent shot.
	enemy.playerXAtLastShot = playerCenterX;
	enemy.playerYAtLastShot = playerCenterY;
	enemy.lastShot = currentTime;
}

export function fireEnemyProjectile(
	enemy,
	enemyCenterX,
	enemyCenterY,
	playerCenterX,
	playerCenterY,
	currentTime,
	firingAngle,
	spread,
	aimAngleBounds = null,
) {
	const stats = enemy.typeStats;
	const weapon = resolveProjectileDefinition(Config.BASE_PROJECTILE, {
		...stats.weaponDefinition,
		volley: {
			...stats.weaponDefinition.volley,
			spread,
		},
	});

	shoot(
		enemy,
		enemyCenterX + Math.cos(firingAngle),
		enemyCenterY + Math.sin(firingAngle),
		{ ...weapon, aimAngleBounds },
	);

	recordEnemyShot(
		enemy,
		playerCenterX,
		playerCenterY,
		currentTime,
	);
}

export function getVariedLeadFiringAngle(
	enemy,
	predictedAngle,
	directAngle,
	baseBulletSpeed,
	spread,
	aimAngleBounds,
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
		getMaximumPlayerMovementSpeed(),
		baseBulletSpeed,
	);
	const variedOffset = shortestAngleDelta(directAngle, firingAngle);
	const clampedOffset = Math.max(
		-maxLeadHalfAngle,
		Math.min(maxLeadHalfAngle, variedOffset),
	);

	return clampAngleToInterval(
		directAngle + clampedOffset,
		aimAngleBounds,
	);
}
