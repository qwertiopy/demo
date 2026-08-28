// Shared exposed-corner index derived from the active wall union. Raw wall
// corners are cached once per geometry revision and can be reused by projectile
// navigation, enemy aiming, and laser visibility.

import { GameState } from "../state.js";
import { queryWallsInAabb } from "./wall-index.js";

const FEATURE_CELL_SIZE = 4;
const PROBE_EPSILON = 1e-6;

let indexedRevision = -1;
let features = [];
let cells = new Map();

function cellKey(x, y) {
	return `${Math.floor(x / FEATURE_CELL_SIZE)},${Math.floor(y / FEATURE_CELL_SIZE)}`;
}

function wallContainsPoint(wall, x, y) {
	return (
		x > wall.x &&
		x < wall.x + wall.width &&
		y > wall.y &&
		y < wall.y + wall.height
	);
}

function pointOccupied(x, y, nearbyWalls) {
	return nearbyWalls.some((wall) => wallContainsPoint(wall, x, y));
}

function rebuildFeatureIndex() {
	const uniquePoints = new Map();
	for (const wall of GameState.walls) {
		for (const [x, y] of [
			[wall.x, wall.y],
			[wall.x + wall.width, wall.y],
			[wall.x + wall.width, wall.y + wall.height],
			[wall.x, wall.y + wall.height],
		]) {
			uniquePoints.set(`${x},${y}`, { x, y });
		}
	}

	features = [];
	cells = new Map();
	for (const point of uniquePoints.values()) {
		const nearbyWalls = queryWallsInAabb(
			point.x - PROBE_EPSILON,
			point.y - PROBE_EPSILON,
			point.x + PROBE_EPSILON,
			point.y + PROBE_EPSILON,
		);
		const quadrants = [
			{ x: 1, y: 1 },
			{ x: -1, y: 1 },
			{ x: -1, y: -1 },
			{ x: 1, y: -1 },
		].map((direction) => ({
			...direction,
			occupied: pointOccupied(
				point.x + direction.x * PROBE_EPSILON,
				point.y + direction.y * PROBE_EPSILON,
				nearbyWalls,
			),
		}));
		const occupied = quadrants.filter((quadrant) => quadrant.occupied);
		const diagonalPair = occupied.length === 2 &&
			occupied[0].x !== occupied[1].x &&
			occupied[0].y !== occupied[1].y;
		if (![1, 3].includes(occupied.length) && !diagonalPair) continue;

		const feature = {
			x: point.x,
			y: point.y,
			freeQuadrants: quadrants
				.filter((quadrant) => !quadrant.occupied)
				.map(({ x, y }) => ({ x, y })),
			occupiedQuadrants: occupied.map(({ x, y }) => ({ x, y })),
		};
		features.push(feature);
		const key = cellKey(feature.x, feature.y);
		if (!cells.has(key)) cells.set(key, []);
		cells.get(key).push(feature);
	}
	indexedRevision = Number(GameState.geometryRevision) || 0;
}

function ensureCurrent() {
	if (indexedRevision !== (Number(GameState.geometryRevision) || 0)) {
		rebuildFeatureIndex();
	}
}

export function invalidateWallFeatureIndex() {
	indexedRevision = -1;
}

export function getAllExposedWallCorners() {
	ensureCurrent();
	return features.slice();
}

export function queryExposedWallCorners(minX, minY, maxX, maxY) {
	ensureCurrent();
	const left = Math.min(minX, maxX);
	const right = Math.max(minX, maxX);
	const top = Math.min(minY, maxY);
	const bottom = Math.max(minY, maxY);
	const startX = Math.floor(left / FEATURE_CELL_SIZE);
	const endX = Math.floor(right / FEATURE_CELL_SIZE);
	const startY = Math.floor(top / FEATURE_CELL_SIZE);
	const endY = Math.floor(bottom / FEATURE_CELL_SIZE);
	const result = [];
	for (let x = startX; x <= endX; x++) {
		for (let y = startY; y <= endY; y++) {
			for (const feature of cells.get(`${x},${y}`) || []) {
				if (
					feature.x >= left && feature.x <= right &&
					feature.y >= top && feature.y <= bottom
				) {
					result.push(feature);
				}
			}
		}
	}
	return result;
}
