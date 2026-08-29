import test from "node:test";
import assert from "node:assert/strict";

import { GameState } from "../js/state.js";
import { markWallIndexDirty } from "../js/spatial/wall-index.js";
import * as visibility from "../js/combat/visibility.js";

const EXPECTED_EXPORTS = [
	"clampAngleToInterval",
	"getAimConeWallCandidates",
	"getAimConeWallScanCandidates",
	"getAimVisibilityProfile",
	"getAimWallCornerRecord",
	"getVisibleAimInterval",
	"getWallCornerCriticalAngles",
	"rayRectIntersection",
	"rayRoundedRectIntersection",
	"updateAimWallCornerAngles",
];

function setWalls(walls) {
	GameState.walls = walls;
	markWallIndexDirty();
}

function assertClose(actual, expected, epsilon = 1e-12) {
	assert.ok(
		Math.abs(actual - expected) <= epsilon,
		`expected ${actual} to be within ${epsilon} of ${expected}`,
	);
}

test("visibility facade preserves the established public exports", () => {
	assert.deepEqual(Object.keys(visibility).sort(), EXPECTED_EXPORTS);
});

test("extracted ray geometry preserves square and rounded wall contacts", () => {
	const wall = { x: 3, y: -1, width: 1, height: 2 };
	assert.deepEqual(
		visibility.rayRectIntersection(0, 0, 1, 0, wall, 0),
		{
			entryDistance: 3,
			exitDistance: 4,
			normalX: -1,
			normalY: 0,
		},
	);

	const rounded = visibility.rayRoundedRectIntersection(
		0,
		0,
		1,
		0.25,
		wall,
		0.4,
	);
	assertClose(rounded.entryDistance, 2.4);
	assertClose(rounded.normalX, -0.8320502943378436);
	assertClose(rounded.normalY, -0.554700196225229);
});

test("aim cone wall scan preserves nearest-first candidate ordering", () => {
	const walls = [
		{ x: 3, y: -1, width: 1, height: 2, id: "a" },
		{ x: 6, y: 1, width: 1, height: 3, id: "b" },
		{ x: 5, y: -4, width: 2, height: 1, id: "c" },
	];
	setWalls(walls);

	const candidates = visibility.getAimConeWallScanCandidates(
		0,
		0,
		0,
		0.8,
		10,
		0.25,
	);
	assert.deepEqual(candidates.map((wall) => wall.id), ["a", "c", "b"]);
});

test("visibility profile preserves critical-ray obstruction transitions", () => {
	const walls = [
		{ x: 3, y: -1, width: 1, height: 2 },
		{ x: 6, y: 1, width: 1, height: 3 },
		{ x: 5, y: -4, width: 2, height: 1 },
	];
	const profile = visibility.getAimVisibilityProfile(
		0,
		0,
		0,
		0.8,
		10,
		0.25,
		walls,
	);

	assert.equal(profile.rays.length, 147);
	assert.deepEqual(profile.rays[0], {
		angle: -0.8,
		localAngle: -0.8,
		distance: 10,
		blocked: false,
	});
	assert.equal(profile.rays[2].blocked, true);
	assertClose(profile.rays[2].distance, 6.398241946034863);
	assert.equal(profile.rays.at(-2).blocked, false);
	assertClose(profile.rays.at(-2).localAngle, 0.6226883144348061);
});

test("visible aim interval preserves wall-tangent inset and preferred-angle selection", () => {
	const walls = [
		{ x: 3, y: -1, width: 1, height: 2 },
		{ x: 6, y: 1, width: 1, height: 3 },
		{ x: 5, y: -4, width: 2, height: 1 },
	];
	const interval = visibility.getVisibleAimInterval(
		0,
		0,
		0,
		0.8,
		10,
		0.25,
		walls,
		0.2,
	);

	assert.ok(interval);
	assertClose(interval.minOffset, 0.6226883144348061);
	assert.equal(interval.maxOffset, 0.8);
	assertClose(interval.minBoundary.tangentAngle, 0.6226783144348061);
	assert.equal(interval.minBoundary.inwardSign, 1);
	assert.equal(interval.minBoundary.source.kind, "rounded-corner-tangent");
	assert.equal(interval.maxBoundary, null);
	assert.equal(visibility.clampAngleToInterval(0.7, interval), 0.7);
	assertClose(
		visibility.clampAngleToInterval(0.1, interval),
		interval.minAngle,
	);
});
