import test from "node:test";
import assert from "node:assert/strict";

import { CombatDefaults } from "../js/combat/defaults.js";
import {
	registerProjectile,
	releaseLogicalProjectiles,
	releaseProjectileEntry,
	reserveLogicalProjectiles,
	resetProjectileCaps,
} from "../js/combat/projectile-cap.js";

CombatDefaults.DEFAULT_MAXIMUM_PROJECTILE_COUNT = 50;
CombatDefaults.MAXIMUM_PROJECTILE_COUNT_SAFEGUARD = 1000;

test.beforeEach(() => resetProjectileCaps());

test("projectile capacity evicts the oldest active entry per owner", () => {
	const firstProjectile = {};
	const secondProjectile = {};
	const thirdProjectile = {};
	const first = registerProjectile(2, firstProjectile, 2);
	const second = registerProjectile(2, secondProjectile, 2);
	const third = registerProjectile(2, thirdProjectile, 2);

	assert.equal(first.active, false);
	assert.equal(firstProjectile.removedByProjectileCap, true);
	assert.equal(second.active, true);
	assert.equal(third.active, true);
});

test("released interior entries never change later FIFO eviction order", () => {
	const first = registerProjectile(2, {}, 3);
	const second = registerProjectile(2, {}, 3);
	const third = registerProjectile(2, {}, 3);
	releaseProjectileEntry(second);
	const fourth = registerProjectile(2, {}, 3);
	const fifth = registerProjectile(2, {}, 3);

	assert.equal(first.active, false);
	assert.equal(second.active, false);
	assert.equal(third.active, true);
	assert.equal(fourth.active, true);
	assert.equal(fifth.active, true);
});

test("owners have independent FIFO capacity", () => {
	const ownerTwo = registerProjectile(2, {}, 1);
	const ownerThree = registerProjectile(3, {}, 1);
	registerProjectile(2, {}, 1);

	assert.equal(ownerTwo.active, false);
	assert.equal(ownerThree.active, true);
});

test("logical laser entries preserve capacity semantics", () => {
	const entries = reserveLogicalProjectiles(2, 3, 2);
	assert.deepEqual(entries.map((entry) => entry.active), [false, true, true]);
	releaseLogicalProjectiles(entries);
	assert.deepEqual(entries.map((entry) => entry.active), [false, false, false]);
});
