// Shared singular-laser impact effects.

import { detonateBullet } from "../explosions.js";
import { fireSplitChildren } from "../projectiles.js";

export function createLaserExplosionAt(
	x,
	y,
	stats,
	ownerId,
	team,
	currentTime,
) {
	return detonateBullet(
		{
			x,
			y,
			ownerId,
			team,
			color: stats.color ?? "white",
			explosionRadiusBlocks: stats.explosionRadiusBlocks ?? 0,
			explosionDurationMs: stats.explosionDurationMs ?? 0,
			explosionDamage: stats.explosionDamage ?? 0,
		},
		currentTime,
	);
}

function createLaserSplitSource(shot, x, y) {
	return {
		...shot.stats,
		x,
		y,
		ownerId: shot.ownerId,
		team: shot.team,
		variationLuckUpgrade: shot.variationLuckUpgrade,
	};
}

export function splitLaserAt(shot, x, y, angle, currentTime) {
	return fireSplitChildren(
		createLaserSplitSource(shot, x, y),
		angle,
		currentTime,
	);
}

