// Static world/environment rendering.

import { ctx } from "../dom.js";
import { consumeDebugDrawBudget, normalizedDebugSettings } from "./settings.js";

// Draws the checker/grid world background and optional enemy-spawn debug markers
// for a supplied snapshot.
export function drawProceduralEnvironment(
	snapshot,
	rendering,
	debug = normalizedDebugSettings(snapshot),
) {
	const blockSizePx = rendering.BLOCK_SIZE_PX;
	const snapshotCamera = snapshot.camera;
	const overscan = rendering.ENVIRONMENT_OVERSCAN_BLOCKS;
	const startX = Math.floor(snapshotCamera.x);
	const endX = startX + snapshotCamera.widthBlocks + overscan;
	const startY = Math.floor(snapshotCamera.y);
	const endY = startY + snapshotCamera.heightBlocks + overscan;

	ctx.lineWidth = 1;

	for (let x = startX; x < endX; x++) {
		for (let y = startY; y < endY; y++) {
			const px = x * blockSizePx;
			const py = y * blockSizePx;

			ctx.fillStyle = Math.abs(x + y) % 2 === 0 ? "#111111" : "#1a1a1a";
			ctx.fillRect(px, py, blockSizePx, blockSizePx);

			ctx.strokeStyle = "#222222";
			ctx.strokeRect(px, py, blockSizePx, blockSizePx);

			if (
				snapshot.showEditorHelpers &&
				debug.DRAW_GRID_COORDINATES &&
				consumeDebugDrawBudget()
			) {
				ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
				ctx.font = "10px monospace";
				ctx.fillText(`${x},${y}`, px + 4, py + 14);
			}
		}
	}

	if (!snapshot.showEditorHelpers || !debug.DRAW_ENEMY_SPAWNS) return;

	for (const spawn of snapshot.enemySpawns || []) {
		// One unit each for the outline, fill, and label. Skip the whole marker if the
		// shared budget cannot afford a complete representation.
		if (!consumeDebugDrawBudget(3)) break;
		const renderSizePx = (spawn.size || 0.5) * blockSizePx;
		const px = spawn.x * blockSizePx;
		const py = spawn.y * blockSizePx;

		ctx.strokeStyle = "cyan";
		ctx.lineWidth = 2;
		ctx.strokeRect(px, py, renderSizePx, renderSizePx);

		ctx.fillStyle = "rgba(0, 255, 255, 0.2)";
		ctx.fillRect(px, py, renderSizePx, renderSizePx);

		ctx.fillStyle = "cyan";
		ctx.font = "10px monospace";
		ctx.fillText(`SPAWN: ${spawn.type}`, px, py - 4);
	}
}

export function drawWalls(snapshot, rendering) {
	const blockSizePx = rendering.BLOCK_SIZE_PX;
	for (const wall of snapshot.walls || []) {
		ctx.fillStyle = wall.color;
		ctx.fillRect(
			wall.x * blockSizePx,
			wall.y * blockSizePx,
			wall.width * blockSizePx,
			wall.height * blockSizePx,
		);
	}
}
