// Rendering configuration normalization and shared debug-draw budget.

import { Config } from "../config.js";
import { canvas } from "../dom.js";

const DEFAULT_MAX_DEBUG_DRAWS_PER_FRAME = 1000;
let debugDrawBudgetRemaining = 0;

export function normalizedDebugSettings(snapshot) {
	const source = snapshot?.debug || Config.DEBUG || {};
	const configuredBudget = Number(source.MAX_DRAWS_PER_FRAME);

	return {
		MAX_DRAWS_PER_FRAME: Number.isFinite(configuredBudget)
			? Math.max(0, Math.floor(configuredBudget))
			: DEFAULT_MAX_DEBUG_DRAWS_PER_FRAME,
		SHOW_FPS: source.SHOW_FPS !== false,
		SHOW_TARGET_FPS: source.SHOW_TARGET_FPS !== false,
		SHOW_MS_PER_TICK: source.SHOW_MS_PER_TICK !== false,
		SHOW_ENTITY_COUNT: source.SHOW_ENTITY_COUNT !== false,
		SHOW_ENEMY_COUNT: source.SHOW_ENEMY_COUNT !== false,
		SHOW_BULLET_COUNT: source.SHOW_BULLET_COUNT !== false,
		DRAW_GRID_COORDINATES: source.DRAW_GRID_COORDINATES !== false,
		DRAW_ENEMY_SPAWNS: source.DRAW_ENEMY_SPAWNS !== false,
		DRAW_ENEMY_AIM_MAXIMUM_CONE:
			source.DRAW_ENEMY_AIM_MAXIMUM_CONE !== false,
		DRAW_ENEMY_AIM_VISIBILITY_REGION:
			source.DRAW_ENEMY_AIM_VISIBILITY_REGION !== false,
		DRAW_ENEMY_AIM_VISIBLE_INTERVAL:
			source.DRAW_ENEMY_AIM_VISIBLE_INTERVAL !== false,
		DRAW_ENEMY_AIM_BOUNDARY_POINTS:
			source.DRAW_ENEMY_AIM_BOUNDARY_POINTS !== false,
		DRAW_ENEMY_AIM_LEAD_ANGLE:
			source.DRAW_ENEMY_AIM_LEAD_ANGLE !== false,
		DRAW_ENEMY_AIM_CACHED_CORNER:
			source.DRAW_ENEMY_AIM_CACHED_CORNER !== false,
	};
}

export function resetDebugDrawBudget(snapshot, debug) {
	debugDrawBudgetRemaining = snapshot.showEditorHelpers
		? debug.MAX_DRAWS_PER_FRAME
		: 0;
}

export function consumeDebugDrawBudget(cost = 1) {
	const normalizedCost = Math.max(0, Math.floor(Number(cost) || 0));
	if (normalizedCost > debugDrawBudgetRemaining) return false;
	debugDrawBudgetRemaining -= normalizedCost;
	return true;
}

export function normalizedRendering(snapshot) {
	const source = snapshot?.rendering || Config.RENDERING || {};
	return {
		CANVAS_WIDTH_PX: Math.max(
			1,
			Math.round(Number(source.CANVAS_WIDTH_PX) || 1920),
		),
		CANVAS_HEIGHT_PX: Math.max(
			1,
			Math.round(Number(source.CANVAS_HEIGHT_PX) || 1080),
		),
		BLOCK_SIZE_PX: Math.max(1, Number(source.BLOCK_SIZE_PX) || 64),
		ZOOM: Math.max(0.01, Number(source.ZOOM) || 1),
		ENVIRONMENT_OVERSCAN_BLOCKS: Math.max(
			0,
			Number(source.ENVIRONMENT_OVERSCAN_BLOCKS) || 0,
		),
	};
}

export function syncCanvasToSnapshot(rendering) {
	if (canvas.width !== rendering.CANVAS_WIDTH_PX) {
		canvas.width = rendering.CANVAS_WIDTH_PX;
	}
	if (canvas.height !== rendering.CANVAS_HEIGHT_PX) {
		canvas.height = rendering.CANVAS_HEIGHT_PX;
	}
	canvas.style.aspectRatio = `${rendering.CANVAS_WIDTH_PX} / ${rendering.CANVAS_HEIGHT_PX}`;
}
