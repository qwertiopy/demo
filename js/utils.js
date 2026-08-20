// Shared simulation helpers.

import { GameState } from "./state.js";
import { queryWallsInAabb } from "./spatial/wall-index.js";

// Advances the deterministic level RNG stored in GameState and returns a value in [0, 1).
export function seededRandom() {
	GameState.currentSeed = (GameState.currentSeed * 9301 + 49297) % 233280;

	return GameState.currentSeed / 233280;
}

// Performs axis-aligned bounding-box collision detection for entities or rectangles using width/height or size.
export function isColliding(rect1, rect2) {
	return (
		rect1.x < rect2.x + (rect2.width || rect2.size) &&
		rect1.x + (rect1.width || rect1.size) > rect2.x &&
		rect1.y < rect2.y + (rect2.height || rect2.size) &&
		rect1.y + (rect1.height || rect1.size) > rect2.y
	);
}

// Moves an entity one axis at a time and resolves overlap against nearby walls,
// producing the same sliding-style collision as the old full-wall scan.
export function handleWallCollisions(entity, dx, dy) {
	const startX = entity.x;
	entity.x += dx;

	const xWalls = queryWallsInAabb(
		Math.min(startX, entity.x),
		entity.y,
		Math.max(startX, entity.x) + entity.size,
		entity.y + entity.size,
	);
	for (const w of xWalls) {
		if (isColliding(entity, w)) {
			if (dx > 0) entity.x = w.x - entity.size;
			if (dx < 0) entity.x = w.x + w.width;
		}
	}

	const startY = entity.y;
	entity.y += dy;

	const yWalls = queryWallsInAabb(
		entity.x,
		Math.min(startY, entity.y),
		entity.x + entity.size,
		Math.max(startY, entity.y) + entity.size,
	);
	for (const w of yWalls) {
		if (isColliding(entity, w)) {
			if (dy > 0) entity.y = w.y - entity.size;
			if (dy < 0) entity.y = w.y + w.height;
		}
	}
}

// returns true if every part of a given rectangle is offscreen (used for rendering)
export function isRectOffScreen(x, y, width, height, camera) {
	return (
		x + width <= camera.x ||
		x >= camera.x + camera.widthBlocks ||
		y + height <= camera.y ||
		y >= camera.y + camera.heightBlocks
	);
}
