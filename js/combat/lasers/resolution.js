// Laser shot geometry dispatch and logical projectile-cap accounting.

import {
	releaseLogicalProjectiles,
	reserveLogicalProjectiles,
} from "../projectile-cap.js";
import {
	getBulletCount,
	getLaserConeHalfAngleFromCount,
} from "../weapon-utils.js";
import { resolveLaserBeamShot } from "./beam.js";
import { resolveChainedLaserBeamShot } from "./chain.js";
import { resolveLaserConeShot } from "./cone.js";

export function resolveLaserShotGeometry(shot, currentTime) {
	if ((shot.coneHalfAngle ?? 0) > 0) {
		resolveLaserConeShot(shot, currentTime);
		return;
	}

	if ((shot.chain ?? 0) > 0) {
		resolveChainedLaserBeamShot(shot, currentTime);
		return;
	}

	resolveLaserBeamShot(shot, currentTime);
}

export function resolveLaserShot(shot, currentTime) {
	const logicalEntries = reserveLogicalProjectiles(
		shot.ownerId,
		getBulletCount(shot.stats),
		shot.maximumProjectileCount,
	);
	try {
		const effectiveCount = logicalEntries.filter((entry) => entry.active).length;
		if (effectiveCount <= 0) return;
		const effectiveShot = {
			...shot,
			stats: { ...shot.stats, bulletCount: effectiveCount },
			coneHalfAngle: effectiveCount > 1
				? getLaserConeHalfAngleFromCount(effectiveCount)
				: 0,
			chain: effectiveCount === 1 ? shot.chain : 0,
		};
		resolveLaserShotGeometry(effectiveShot, currentTime);
	} finally {
		releaseLogicalProjectiles(logicalEntries);
	}
}

