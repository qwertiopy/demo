import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
	getSplitChildDefinition,
	mergeProjectileDefinition,
	resolveProjectileDefinition,
	validateBaseProjectile,
} from "../js/combat/projectile-schema.js";

const config = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const base = config.BASE_PROJECTILE;

test("factory base projectile satisfies the current required schema", () => {
	assert.equal(validateBaseProjectile(base), base);
});

test("projectile merge recursively overlays objects and replaces arrays", () => {
	const merged = mergeProjectileDefinition(
		{ root: 1, nested: { a: 1, b: 2 }, values: [1, 2] },
		{ nested: { b: 3 }, values: [4] },
	);
	assert.deepEqual(merged, {
		root: 1,
		nested: { a: 1, b: 3 },
		values: [4],
	});
});

test("disabled modifiers resolve to neutral flattened values", () => {
	const resolved = resolveProjectileDefinition(base, {
		volley: { enabled: false, count: 99, spread: 2 },
		laser: { enabled: false, warmupMs: 500 },
		split: { enabled: false, count: 9, timeMs: 10, spread: 3 },
	});
	assert.equal(resolved.bulletCount, 1);
	assert.equal(resolved.spread, 0);
	assert.equal(resolved.laser, false);
	assert.equal(resolved.laserWarmupMs, 0);
	assert.equal(resolved.splitEnabled, false);
	assert.equal(resolved.splitCount, 0);
	assert.equal(resolved.splitTimeMs, 0);
});

test("split child definitions inherit from the global base", () => {
	const child = getSplitChildDefinition(base, {
		weight: 1,
		projectile: { speed: 5, damage: 7 },
	});
	assert.equal(child.speed, 5);
	assert.equal(child.damage, 7);
	assert.equal(child.color, base.color);
	assert.equal(child.__resolvedProjectile, true);
});
