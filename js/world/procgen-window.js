// Canonical horizontal procedural-generation and cleanup window calculation.

import { Config } from "../config.js";

export function getProceduralWindow(
	playerX,
	rendering = Config.RENDERING,
) {
	const playerColumn = Math.floor(playerX);
	const generationStartX = Math.max(
		0,
		playerColumn - rendering.DISTANCE_BACK_BLOCKS,
	);
	const generationEndX =
		playerColumn + rendering.DISTANCE_FRONT_BLOCKS;
	const cleanupBuffer = Math.max(
		0,
		Number(rendering.CLEANUP_BUFFER_BLOCKS) || 0,
	);

	return {
		playerColumn,
		generationStartX,
		generationEndX,
		cleanupStartX: generationStartX - cleanupBuffer,
		cleanupEndX: generationEndX + cleanupBuffer,
	};
}
