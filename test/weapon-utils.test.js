import test from "node:test";
import assert from "node:assert/strict";

import { CombatDefaults } from "../js/combat/defaults.js";
import {
	getEffectiveVariationLuck,
	getProjectileVolleyAngles,
	getThrowableBoomerangTravelDistance,
	getThrowableKinematics,
	getThrowableTravelDistance,
	getVariedStat,
	normalizeSignedAngle,
	shortestAngleDelta,
} from "../js/combat/weapon-utils.js";

CombatDefaults.MIN_THROW_DECELERATION = 0.001;

const closeTo = (actual, expected, epsilon = 1e-10) => {
	assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

test("throwable closed-form kinematics reach the configured endpoint", () => {
	const result = getThrowableKinematics(10, 20);
	closeTo(result.initialSpeed, 20);
	closeTo(result.durationSeconds, 1);
	closeTo(getThrowableTravelDistance(10, 0, 20, 20, 1000), 0);
	closeTo(getThrowableTravelDistance(10, 500, 20, 20, 1000), 7.5);
	closeTo(getThrowableTravelDistance(10, 1000, 20, 20, 1000), 10);
});

test("boomerang distance preserves its two-leg curve", () => {
	closeTo(getThrowableBoomerangTravelDistance(10, 0, 20, 20, 1000), 0);
	closeTo(getThrowableBoomerangTravelDistance(10, 1000, 20, 20, 1000), 10);
	closeTo(getThrowableBoomerangTravelDistance(10, 1500, 20, 20, 1000), 17.5);
	closeTo(getThrowableBoomerangTravelDistance(10, 2000, 20, 20, 1000), 20);
});

test("variation luck keeps endpoints and applies the current power quantile", () => {
	assert.equal(getVariedStat(10, 2, 0, 0, () => 0), 8);
	assert.equal(getVariedStat(10, 2, 0, 0, () => 1), 12);
	closeTo(getVariedStat(10, 2, 0, 3, () => 0.0625), 10);
	assert.equal(
		getEffectiveVariationLuck(
			{ variationLuck: 3, variationMaximumLuck: 8 },
			10,
		),
		8,
	);
});

test("zero-spread volleys retain deterministic fallback offsets", () => {
	assert.deepEqual(getProjectileVolleyAngles(2, { bulletCount: 1, spread: 0 }), [2]);
	assert.deepEqual(getProjectileVolleyAngles(2, { bulletCount: 3, spread: 0 }), [1.9, 2, 2.1]);
});

test("signed angle helpers preserve the half-open [-PI, PI) range", () => {
	closeTo(normalizeSignedAngle(Math.PI), -Math.PI);
	closeTo(normalizeSignedAngle(-Math.PI), -Math.PI);
	closeTo(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2);
});
