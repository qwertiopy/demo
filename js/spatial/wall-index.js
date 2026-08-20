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
let indexedBounds = null;

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
	indexedBounds = null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (let index = 0; index < GameState.walls.length; index++) {
		const wall = GameState.walls[index];
		const bounds = getWallBounds(wall);
		wallOrder.set(wall, index);

		if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) continue;

		minX = Math.min(minX, bounds.minX);
		minY = Math.min(minY, bounds.minY);
		maxX = Math.max(maxX, bounds.maxX);
		maxY = Math.max(maxY, bounds.maxY);

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

	if (Number.isFinite(minX) && Number.isFinite(maxX)) {
		indexedBounds = {
			x: minX,
			y: minY,
			width: maxX - minX,
			height: maxY - minY,
		};
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

export function getWallIndexBounds() {
	ensureWallIndexCurrent();
	return indexedBounds ? { ...indexedBounds } : null;
}

// Traverses the wall grid along a finite ray using Amanatides & Woo DDA and
// returns only walls occupying cells the ray (plus optional radius padding)
// can reach. Exact ray/rectangle intersection remains the caller's narrow phase.
//
// `visitCell` is optional and is called once for each centerline/touched grid
// cell. Returning false aborts traversal and marks the query truncated; lasers
// use this to enforce their shared per-frame calculation budget.
export function queryWallsAlongRayDda(
	originX,
	originY,
	dirX,
	dirY,
	maxDistance,
	padding = 0,
	visitCell = null,
) {
	ensureWallIndexCurrent();

	const ox = Number(originX);
	const oy = Number(originY);
	let dx = Number(dirX);
	let dy = Number(dirY);
	const distanceLimit = Math.max(0, Number(maxDistance) || 0);
	const safePadding = Math.max(0, Number(padding) || 0);

	if (![ox, oy, dx, dy].every(Number.isFinite)) {
		return {
			walls: GameState.walls.slice(),
			truncated: false,
			visitedCells: 0,
		};
	}

	const magnitude = Math.hypot(dx, dy);
	if (magnitude <= 1e-12 || distanceLimit <= 0) {
		return { walls: [], truncated: false, visitedCells: 0 };
	}
	dx /= magnitude;
	dy /= magnitude;

	const paddingCells = Math.ceil(
		safePadding / WALL_GRID_CELL_SIZE_BLOCKS,
	);
	const candidateWalls = new Set();
	const visitedGridCells = new Set();
	let visitedCells = 0;
	let truncated = false;

	function collectCell(cellX, cellY, entryDistance) {
		const key = `${cellX},${cellY}`;
		if (visitedGridCells.has(key)) return true;
		visitedGridCells.add(key);
		visitedCells++;

		if (
			typeof visitCell === "function" &&
			visitCell(cellX, cellY, entryDistance) === false
		) {
			truncated = true;
			return false;
		}

		for (
			let queryX = cellX - paddingCells;
			queryX <= cellX + paddingCells;
			queryX++
		) {
			const column = columns.get(queryX);
			if (!column) continue;

			for (
				let queryY = cellY - paddingCells;
				queryY <= cellY + paddingCells;
				queryY++
			) {
				const bucket = column.get(queryY);
				if (!bucket) continue;
				for (const wall of bucket) candidateWalls.add(wall);
			}
		}

		return true;
	}

	let cellX = getCellCoordinate(ox);
	let cellY = getCellCoordinate(oy);
	const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
	const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
	const tDeltaX = stepX === 0
		? Infinity
		: WALL_GRID_CELL_SIZE_BLOCKS / Math.abs(dx);
	const tDeltaY = stepY === 0
		? Infinity
		: WALL_GRID_CELL_SIZE_BLOCKS / Math.abs(dy);
	const nextBoundaryX = stepX > 0
		? (cellX + 1) * WALL_GRID_CELL_SIZE_BLOCKS
		: cellX * WALL_GRID_CELL_SIZE_BLOCKS;
	const nextBoundaryY = stepY > 0
		? (cellY + 1) * WALL_GRID_CELL_SIZE_BLOCKS
		: cellY * WALL_GRID_CELL_SIZE_BLOCKS;
	let tMaxX = stepX === 0 ? Infinity : (nextBoundaryX - ox) / dx;
	let tMaxY = stepY === 0 ? Infinity : (nextBoundaryY - oy) / dy;
	const EPSILON = 1e-10;

	if (!collectCell(cellX, cellY, 0)) {
		return { walls: [], truncated: true, visitedCells };
	}

	while (!truncated) {
		const nextDistance = Math.min(tMaxX, tMaxY);
		if (
			!Number.isFinite(nextDistance) ||
			nextDistance > distanceLimit + EPSILON
		) {
			break;
		}

		if (Math.abs(tMaxX - tMaxY) <= EPSILON) {
			// At an exact grid corner the ray touches both side-adjacent cells as
			// well as entering the diagonal cell. Visiting all three preserves
			// inclusive corner-hit behavior from the old all-wall ray scan.
			if (
				stepX !== 0 &&
				!collectCell(cellX + stepX, cellY, nextDistance)
			) break;
			if (
				stepY !== 0 &&
				!collectCell(cellX, cellY + stepY, nextDistance)
			) break;

			cellX += stepX;
			cellY += stepY;
			tMaxX += tDeltaX;
			tMaxY += tDeltaY;
			if (!collectCell(cellX, cellY, nextDistance)) break;
			continue;
		}

		if (tMaxX < tMaxY) {
			cellX += stepX;
			tMaxX += tDeltaX;
		} else {
			cellY += stepY;
			tMaxY += tDeltaY;
		}

		if (!collectCell(cellX, cellY, nextDistance)) break;
	}

	return {
		walls: Array.from(candidateWalls).sort(
			(a, b) => (wallOrder.get(a) ?? 0) - (wallOrder.get(b) ?? 0),
		),
		truncated,
		visitedCells,
	};
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
