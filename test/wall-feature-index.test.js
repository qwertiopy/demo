import test from "node:test";
import assert from "node:assert/strict";

import { GameState, markGeometryChanged } from "../js/state.js";
import { markWallIndexDirty } from "../js/spatial/wall-index.js";
import {
	getAllExposedWallCorners,
	invalidateWallFeatureIndex,
} from "../js/spatial/wall-feature-index.js";

function setWalls(walls) {
	GameState.walls = walls;
	markWallIndexDirty();
	markGeometryChanged();
	invalidateWallFeatureIndex();
}

test("feature index removes straight internal corners from touching walls", () => {
	setWalls([
		{ x: 0, y: 0, width: 1, height: 1 },
		{ x: 1, y: 0, width: 1, height: 1 },
	]);
	const points = getAllExposedWallCorners().map(({ x, y }) => `${x},${y}`);
	assert.deepEqual(points.sort(), ["0,0", "0,1", "2,0", "2,1"].sort());
});

test("feature index preserves a diagonal shared-corner portal", () => {
	setWalls([
		{ x: 0, y: 0, width: 1, height: 1 },
		{ x: 1, y: 1, width: 1, height: 1 },
	]);
	const corner = getAllExposedWallCorners().find(({ x, y }) => x === 1 && y === 1);
	assert.ok(corner);
	assert.equal(corner.freeQuadrants.length, 2);
});
