import test from "node:test";
import assert from "node:assert/strict";

import {
	calculateGapSafeWallAngle,
	calculateInterceptAim,
	calculateMaximumFleeInterceptDistance,
	calculateMaximumLeadHalfAngle,
	findChainTarget,
} from "../js/combat/targeting.js";
import { GameState } from "../js/state.js";

const closeTo = (actual, expected, epsilon = 1e-10) => {
	assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

test("maximum lead cone preserves current speed-ratio behavior", () => {
	closeTo(calculateMaximumLeadHalfAngle(1, 2), Math.asin(0.5));
	closeTo(calculateMaximumLeadHalfAngle(2, 2), Math.PI / 2);
	closeTo(calculateMaximumLeadHalfAngle(3, 2), Math.PI / 2);
	assert.equal(calculateMaximumLeadHalfAngle(1, 0), 0);
});

test("maximum flee distance remains infinite without a guaranteed intercept", () => {
	assert.equal(calculateMaximumFleeInterceptDistance(10, 2, 2), Infinity);
	assert.equal(calculateMaximumFleeInterceptDistance(10, 3, 2), Infinity);
	assert.equal(calculateMaximumFleeInterceptDistance(10, 1, 2), 20);
});

test("constant-velocity intercept selects the earliest positive solution", () => {
	const intercept = calculateInterceptAim(0, 0, 10, 0, 1, 0, 2);
	closeTo(intercept.time, 10);
	closeTo(intercept.x, 20);
	closeTo(intercept.y, 0);
	closeTo(intercept.angle, 0);
	assert.equal(calculateInterceptAim(0, 0, 10, 0, 2, 0, 1), null);
});

test("gap-safe angle remains bounded and collapses for impossible interception", () => {
	const angle = calculateGapSafeWallAngle(10, 1, 4, 0.1, 0.5, 0.9);
	assert.ok(angle > 0);
	assert.ok(angle < Math.PI);
	assert.equal(calculateGapSafeWallAngle(10, 4, 4, 0.1, 0.5, 0.9), 0);
	assert.equal(calculateGapSafeWallAngle(10, 1, 4, 0.1, 0, 0.9), 0);
});

test("chain target selection treats maximum range as an exclusive per-hop bound", () => {
	const atLimit = { x: 2, y: -0.5, size: 1, hp: 10 };
	const insideLimit = { x: 1.999, y: -0.5, size: 1, hp: 10 };
	GameState.enemies = [atLimit];
	assert.equal(
		findChainTarget(0, 0, 0, new Set(), "angle", () => true, 2.5),
		null,
	);

	GameState.enemies = [insideLimit];
	assert.equal(
		findChainTarget(0, 0, 0, new Set(), "angle", () => true, 2.5),
		insideLimit,
	);
});

