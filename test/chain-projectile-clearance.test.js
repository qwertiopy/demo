import test from "node:test";
import assert from "node:assert/strict";

import { hasLineOfSight } from "../js/combat/collision.js";
import { updateProjectileChainAim } from "../js/combat/projectiles.js";
import { GameState, TEAM_PLAYER } from "../js/state.js";
import { markWallIndexDirty } from "../js/spatial/wall-index.js";

function makeTarget(x = 9.5, y = -0.5) {
	return { x, y, size: 1, hp: 10 };
}

function makeChainProjectile(overrides = {}) {
	return {
		x: 0,
		y: 0,
		radius: 0.3,
		vx: 4,
		vy: 0,
		team: TEAM_PLAYER,
		chain: 1,
		chainsRemaining: 0,
		chainReferenceAngle: 0,
		chainVisitedTargets: new Set(),
		chainTarget: null,
		...overrides,
	};
}

test.beforeEach(() => {
	GameState.enemies = [];
	GameState.walls = [];
	markWallIndexDirty();
});

test("chain acquisition rejects centerline-clear paths that do not clear projectile radius", () => {
	const target = makeTarget();
	GameState.enemies = [target];
	GameState.walls = [{ x: 4, y: 0.2, width: 1, height: 1 }];
	markWallIndexDirty();

	assert.equal(hasLineOfSight(0, 0, 10, 0), true);

	const projectile = makeChainProjectile();
	assert.equal(updateProjectileChainAim(projectile), false);
	assert.equal(projectile.chainTarget, null);
	assert.equal(projectile.vx, 4);
	assert.equal(projectile.vy, 0);
});

test("chain acquisition accepts paths when the wall lies outside projectile radius", () => {
	const target = makeTarget();
	GameState.enemies = [target];
	GameState.walls = [{ x: 4, y: 0.301, width: 1, height: 1 }];
	markWallIndexDirty();

	const projectile = makeChainProjectile({ vx: 0, vy: 4 });
	assert.equal(updateProjectileChainAim(projectile), false);
	assert.equal(projectile.chainTarget, target);
	assert.ok(projectile.vx > 3.99);
	assert.ok(Math.abs(projectile.vy) < 1e-10);
});

test("active chain homing drops a target when its radius-clear path becomes blocked", () => {
	const target = makeTarget();
	GameState.enemies = [target];
	const projectile = makeChainProjectile({
		vx: 0,
		vy: 4,
		chainTarget: target,
	});

	GameState.walls = [{ x: 4, y: 0.2, width: 1, height: 1 }];
	markWallIndexDirty();

	assert.equal(updateProjectileChainAim(projectile), false);
	assert.equal(projectile.chainTarget, null);
	assert.equal(projectile.vx, 0);
	assert.equal(projectile.vy, 4);
});

test("chain acquisition skips a blocked preferred target for a radius-clear alternative", () => {
	const blockedTarget = makeTarget();
	const clearTarget = makeTarget(9.5, 4.5);
	GameState.enemies = [blockedTarget, clearTarget];
	GameState.walls = [{ x: 4, y: 0.2, width: 1, height: 1 }];
	markWallIndexDirty();

	const projectile = makeChainProjectile({ vx: 0, vy: 4 });
	assert.equal(updateProjectileChainAim(projectile), false);
	assert.equal(projectile.chainTarget, clearTarget);
	assert.ok(projectile.vx > 0);
	assert.ok(projectile.vy > 0);
});

test("chain maximum range excludes a target exactly at the configured range", () => {
	const target = makeTarget(2, -0.5); // center is exactly 2.5 blocks away
	GameState.enemies = [target];

	const projectile = makeChainProjectile({ chainMaximumRangeBlocks: 2.5 });
	assert.equal(updateProjectileChainAim(projectile), false);
	assert.equal(projectile.chainTarget, null);
});

test("chain maximum range accepts a target strictly inside the configured range", () => {
	const target = makeTarget(1.999, -0.5); // center is 2.499 blocks away
	GameState.enemies = [target];

	const projectile = makeChainProjectile({
		vx: 0,
		vy: 4,
		chainMaximumRangeBlocks: 2.5,
	});
	assert.equal(updateProjectileChainAim(projectile), false);
	assert.equal(projectile.chainTarget, target);
});

