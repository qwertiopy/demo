// Broad-phase spatial index for active axis-aligned walls.
//
// Walls remain stored in GameState.walls for rendering/replay compatibility.
// This index only answers "which walls could matter here?" so narrow-phase
// collision code can preserve its existing geometry and behavior.

import { GameState } from "../state.js";

const WALL_GRID_CELL_SIZE_BLOCKS = 1;

let dirty = true;
let indexedWallsRef = null;
let indexedWallCount = -1;
let columns = new Map();
let wallOrder = new Map();

function getWallBounds(wall) {
	const width = Number(wall?.width ?? wall?.size ?? 0) || 0;
	const height = Number(wall?.height ?? wall?.size ?? 0) || 0;
	const x1 = Number(wall?.x) || 0;
	const y1 = Number(wall?.y) || 0;
	const x2 = x1 + width;
	const y2 = y1 + height;

	return {
		minX: Math.min(x1, x2),
		minY: Math.min(y1, y2),
		maxX: Math.max(x1, x2),
		maxY: Math.max(y1, y2),
	};
}

function getCellCoordinate(value) {
	return Math.floor(value / WALL_GRID_CELL_SIZE_BLOCKS);
}

function getIndexedCellRange(minValue, maxValue) {
	const start = getCellCoordinate(minValue);
	// Wall rectangles are half-open for overlap tests. A wall ending exactly on
	// a cell boundary therefore belongs to the cell before that boundary.
	const end = Math.max(
		start,
		Math.ceil(maxValue / WALL_GRID_CELL_SIZE_BLOCKS) - 1,
	);
	return { start, end };
}

function rebuildWallIndex() {
	columns = new Map();
	wallOrder = new Map();

	for (let index = 0; index < GameState.walls.length; index++) {
		const wall = GameState.walls[index];
		const bounds = getWallBounds(wall);
		wallOrder.set(wall, index);

		if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) continue;

		const xCells = getIndexedCellRange(bounds.minX, bounds.maxX);
		const yCells = getIndexedCellRange(bounds.minY, bounds.maxY);

		for (let cellX = xCells.start; cellX <= xCells.end; cellX++) {
			let column = columns.get(cellX);
			if (!column) {
				column = new Map();
				columns.set(cellX, column);
			}

			for (let cellY = yCells.start; cellY <= yCells.end; cellY++) {
				let bucket = column.get(cellY);
				if (!bucket) {
					bucket = [];
					column.set(cellY, bucket);
				}
				bucket.push(wall);
			}
		}
	}

	indexedWallsRef = GameState.walls;
	indexedWallCount = GameState.walls.length;
	dirty = false;
}

function ensureWallIndexCurrent() {
	// The explicit dirty flag covers known mutations. The reference/length
	// checks are a safety net for future code that replaces or pushes to the wall
	// array without remembering to notify the index.
	if (
		dirty ||
		indexedWallsRef !== GameState.walls ||
		indexedWallCount !== GameState.walls.length
	) {
		rebuildWallIndex();
	}
}

export function markWallIndexDirty() {
	dirty = true;
}

// Returns active walls whose occupied grid cells overlap the supplied AABB.
// Results are restored to GameState.walls order so collision resolution keeps
// the same deterministic ordering it had when every wall was scanned.
export function queryWallsInAabb(minX, minY, maxX, maxY) {
	if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
		return GameState.walls.slice();
	}

	ensureWallIndexCurrent();

	const queryMinX = Math.min(minX, maxX);
	const queryMinY = Math.min(minY, maxY);
	const queryMaxX = Math.max(minX, maxX);
	const queryMaxY = Math.max(minY, maxY);
	const startCellX = getCellCoordinate(queryMinX);
	const endCellX = getCellCoordinate(queryMaxX);
	const startCellY = getCellCoordinate(queryMinY);
	const endCellY = getCellCoordinate(queryMaxY);
	const candidates = new Set();

	for (let cellX = startCellX; cellX <= endCellX; cellX++) {
		const column = columns.get(cellX);
		if (!column) continue;

		for (let cellY = startCellY; cellY <= endCellY; cellY++) {
			const bucket = column.get(cellY);
			if (!bucket) continue;
			for (const wall of bucket) candidates.add(wall);
		}
	}

	return Array.from(candidates).sort(
		(a, b) => (wallOrder.get(a) ?? 0) - (wallOrder.get(b) ?? 0),
	);
}

export function queryWallsAlongSegment(x1, y1, x2, y2, padding = 0) {
	const safePadding = Math.max(0, Number(padding) || 0);
	return queryWallsInAabb(
		Math.min(x1, x2) - safePadding,
		Math.min(y1, y2) - safePadding,
		Math.max(x1, x2) + safePadding,
		Math.max(y1, y2) + safePadding,
	);
}
