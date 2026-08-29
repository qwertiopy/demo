// Current-frame dynamic snapshot rendering.

import { ctx } from "../dom.js";
import { drawActor, drawEnemyAimDebug } from "./actors.js";
import { drawExplosion, drawLaserBeam, drawLaserWarmup, drawProjectile } from "./effects.js";
import { normalizedDebugSettings } from "./settings.js";

// Draws only the dynamic part of a snapshot. Trail rendering passes
// includeUi=false so health bars and every other UI layer are rendered only for
// the current frame, never repeated into the trail history.
export function drawDynamicSnapshot(
	snapshot,
	rendering,
	alphaMultiplier = 1,
	{
		includeUi = true,
		debug = normalizedDebugSettings(snapshot),
	} = {},
) {
	const alpha = Math.min(1, Math.max(0, Number(alphaMultiplier) || 0));
	if (alpha <= 0) return;

	const blockSizePx = rendering.BLOCK_SIZE_PX;
	ctx.save();
	ctx.globalAlpha = alpha;

	if (includeUi && snapshot.showEditorHelpers) {
		for (const enemy of snapshot.enemies || []) {
			drawEnemyAimDebug(enemy, blockSizePx, debug);
		}
	}

	drawActor(snapshot.player, blockSizePx, "cyan", includeUi);

	for (const enemy of snapshot.enemies || []) {
		drawActor(enemy, blockSizePx, "red", includeUi);
	}

	for (const projectile of snapshot.projectiles || []) {
		drawProjectile(projectile, blockSizePx);
	}

	for (const warmup of snapshot.laserWarmups || []) {
		drawLaserWarmup(warmup, blockSizePx, alpha);
	}

	for (const beam of snapshot.laserBeams || []) {
		drawLaserBeam(beam, blockSizePx, alpha);
	}

	for (const explosion of snapshot.explosions || []) {
		drawExplosion(explosion, blockSizePx, alpha);
	}

	ctx.restore();
}
