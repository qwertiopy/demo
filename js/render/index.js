// Snapshot-driven rendering orchestration.

import { canvas, ctx } from "../dom.js";
import { drawProceduralEnvironment, drawWalls } from "./environment.js";
import { drawDynamicSnapshot } from "./dynamic.js";
import { drawGameOverOverlay, drawWeaponHud } from "./hud.js";
import {
	normalizedDebugSettings,
	normalizedRendering,
	resetDebugDrawBudget,
	syncCanvasToSnapshot,
} from "./settings.js";
import { drawTrailsHybrid } from "./trails.js";

export { drawProceduralEnvironment } from "./environment.js";
export { drawHealthBar } from "./actors.js";
export { drawDynamicSnapshot } from "./dynamic.js";
export { drawWeaponHud } from "./hud.js";

// Renders one visual snapshot. Historical trail snapshots are transformed by
// the current snapshot's camera, so trails stay anchored to world coordinates
// rather than sticking to screen pixels while the camera moves.
export function draw(snapshot, trailEntries = [], options = {}) {
	if (!snapshot) return;

	const rendering = normalizedRendering(snapshot);
	const debug = normalizedDebugSettings(snapshot);
	resetDebugDrawBudget(snapshot, debug);
	syncCanvasToSnapshot(rendering);
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	ctx.scale(rendering.ZOOM, rendering.ZOOM);
	ctx.translate(
		-Math.floor(snapshot.camera.x * rendering.BLOCK_SIZE_PX),
		-Math.floor(snapshot.camera.y * rendering.BLOCK_SIZE_PX),
	);

	drawProceduralEnvironment(snapshot, rendering, debug);
	drawWalls(snapshot, rendering);

	const playerTrailEntries = options.playerTrailEntries || trailEntries;
	if (
		trailEntries.length > 0 ||
		options.quadTrailEntries?.length > 0 ||
		playerTrailEntries.length > 0
	) {
		drawTrailsHybrid(
			trailEntries,
			options.quadTrailEntries || trailEntries,
			rendering,
			playerTrailEntries,
		);
	}

	// Current-frame UI is rendered exactly once. Historical/swept trail frames
	// intentionally omit health bars and all other UI elements.
	drawDynamicSnapshot(snapshot, rendering, 1, {
		includeUi: true,
		debug,
	});
	ctx.restore();

	drawWeaponHud(snapshot);
	drawGameOverOverlay(snapshot);
}
