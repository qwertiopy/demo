import assert from "node:assert/strict";
import test from "node:test";

import { CombatDefaults } from "../js/combat/defaults.js";
import * as projectileFacade from "../js/combat/projectiles.js";
import { updateProjectileChainAim } from "../js/combat/projectiles/chain.js";
import { processProjectiles } from "../js/combat/projectiles/movement.js";
import { getPenetratedCollisionRect } from "../js/combat/projectiles/penetration.js";
import { resolveProjectileVectorCollisions } from "../js/combat/projectiles/projectile-collision.js";
import { shoot } from "../js/combat/projectiles/spawn.js";
import {
	fireSplitChildren,
	registerSplitLaserFirer,
} from "../js/combat/projectiles/split.js";
import {
	findEarliestProjectileWallHit,
	getBulletMaxStepBlocks,
} from "../js/combat/projectiles/wall-collision.js";
import { markWallIndexDirty } from "../js/spatial/wall-index.js";
import { GameState, TEAM_PLAYER } from "../js/state.js";

function loadProjectileCollisionDefaults() {
	Object.assign(CombatDefaults, {
		PROJECTILE_MAX_STEP_BLOCKS: 10,
		MAX_WALL_IMPACTS_PER_SUBSTEP: 8,
		WALL_TOI_EPSILON: 1e-9,
		WALL_APPROACH_EPSILON: 1e-10,
		WALL_CONTACT_NUDGE: 1e-8,
	});
}

test("projectile facade preserves the established public function exports", () => {
	assert.equal(projectileFacade.shoot, shoot);
	assert.equal(projectileFacade.processProjectiles, processProjectiles);
	assert.equal(
		projectileFacade.resolveProjectileVectorCollisions,
		resolveProjectileVectorCollisions,
	);
	assert.equal(projectileFacade.getPenetratedCollisionRect, getPenetratedCollisionRect);
	assert.equal(projectileFacade.getBulletMaxStepBlocks, getBulletMaxStepBlocks);
	assert.equal(projectileFacade.updateProjectileChainAim, updateProjectileChainAim);
	assert.equal(projectileFacade.fireSplitChildren, fireSplitChildren);
	assert.equal(projectileFacade.registerSplitLaserFirer, registerSplitLaserFirer);
});

test("extracted wall collision preserves swept projectile-radius contact", () => {
	loadProjectileCollisionDefaults();
	GameState.walls = [{ x: 2, y: 0, width: 1, height: 2 }];
	markWallIndexDirty();

	const hit = findEarliestProjectileWallHit(
		{ x: 0, y: 1, radius: 0.25 },
		3,
		0,
	);

	assert.ok(hit);
	assert.ok(Math.abs(hit.time - 1.75 / 3) < 1e-10);
	assert.equal(hit.normalX, -1);
	assert.equal(hit.normalY, 0);
});

test("projectile movement still reflects the unused substep remainder after a wall hit", () => {
	loadProjectileCollisionDefaults();
	GameState.walls = [{ x: 2, y: 0, width: 1, height: 2 }];
	GameState.enemies = [];
	GameState.projectiles = [{
		x: 0,
		y: 1,
		radius: 0.25,
		vx: 4,
		vy: 0,
		color: "test",
		damage: 1,
		bounces: 0,
		maxBounces: 1,
		throwBounces: 0,
		hitTargets: new Set(),
		chain: 0,
		chainMaximumRangeBlocks: 0,
		chainsRemaining: 0,
		chainVisitedTargets: new Set(),
		chainTarget: null,
		createdAt: 0,
		lifetimeMs: 5000,
		explosionRadiusBlocks: 0,
		detonationTimeMs: 0,
		explosionDurationMs: 0,
		explosionDamage: 0,
		detonatesOnImpact: false,
		splitEnabled: false,
		splitCount: 0,
		splitTimeMs: 0,
		splitsOnImpact: false,
		splitSpread: 0,
		splitChildren: [],
		ownerId: 1,
		team: TEAM_PLAYER,
		variationLuckUpgrade: 0,
		penetrationBlocks: 0,
		remainingPenetrationBlocks: 0,
		finishPenetratedWall: false,
		throwable: false,
		throwDirX: 1,
		throwDirY: 0,
		throwDistanceBlocks: 0,
		throwDistanceMultiplier: 1,
		throwTravelledBlocks: 0,
		throwLegStartedAt: 0,
		throwDeceleration: 1,
		throwInitialSpeed: 0,
		throwFlightDurationMs: 0,
		throwComplete: true,
		dv: 0,
		bulletCollision: false,
	}];
	GameState.projectileTrailEvents = [];
	markWallIndexDirty();

	processProjectiles(500, 0.5);

	const [projectile] = GameState.projectiles;
	assert.ok(projectile);
	assert.equal(projectile.bounces, 1);
	assert.equal(projectile.vx, -4);
	assert.equal(projectile.vy, 0);
	assert.ok(Math.abs(projectile.x - 1.5) < 1e-6);
	assert.equal(GameState.projectileTrailEvents.length, 2);
});
