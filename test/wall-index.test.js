import test from "node:test";
import assert from "node:assert/strict";

import { GameState } from "../js/state.js";
import {
	getWallIndexBounds,
	markWallIndexDirty,
	queryWallsAlongRayDda,
	queryWallsAlongSegment,
	queryWallsInAabb,
} from "../js/spatial/wall-index.js";

const walls = [
	{ id: "far", x: 8, y: 8, width: 1, height: 1 },
	{ id: "wide", x: 1, y: 1, width: 3, height: 1 },
	{ id: "near", x: 0, y: 0, width: 1, height: 1 },
];

test.beforeEach(() => {
	GameState.walls = walls.map((wall) => ({ ...wall }));
	markWallIndexDirty();
});

test("AABB queries preserve original wall-array order", () => {
	assert.deepEqual(
		queryWallsInAabb(-1, -1, 10, 10).map((wall) => wall.id),
		["far", "wide", "near"],
	);
	assert.deepEqual(
		queryWallsInAabb(-1, -1, 2, 2).map((wall) => wall.id),
		["wide", "near"],
	);
});

test("segment query retains its current swept-AABB broad phase", () => {
	GameState.walls.push({ id: "inside-box", x: 1, y: 8, width: 1, height: 1 });
	markWallIndexDirty();
	assert.deepEqual(
		queryWallsAlongSegment(0, 0, 10, 10).map((wall) => wall.id),
		["far", "wide", "near", "inside-box"],
	);
});

test("DDA ray query reports truncation without changing candidate order", () => {
	const result = queryWallsAlongRayDda(0.5, 0.5, 1, 1, 20, 0, (_x, _y, distance) => distance < 2);
	assert.equal(result.truncated, true);
	assert.ok(result.visitedCells > 0);
	assert.deepEqual(result.walls.map((wall) => wall.id), ["wide", "near"]);
});

test("wall index bounds cover the complete active wall set", () => {
	assert.deepEqual(getWallIndexBounds(), { x: 0, y: 0, width: 9, height: 9 });
});
