import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { CombatDefaults } from "../js/combat/defaults.js";
import { resetProjectileCaps } from "../js/combat/projectile-cap.js";
import * as projectileFacade from "../js/combat/projectiles.js";
import { updateProjectileChainAim } from "../js/combat/projectiles/chain.js";
import { processProjectiles } from "../js/combat/projectiles/movement.js";
import { getPenetratedCollisionRect } from "../js/combat/projectiles/penetration.js";
import { resolveProjectileDefinition } from "../js/combat/projectile-schema.js";
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
import { Config } from "../js/config.js";
import { GameState, TEAM_PLAYER } from "../js/state.js";

const configFile = JSON.parse(
	fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"),
);
const baseProjectile = configFile.BASE_PROJECTILE;

function resetProjectileSpawnTestState() {
	resetProjectileCaps();
	GameState.projectiles = [];
	GameState.projectileTrailEvents = [];
	GameState.enemies = [];
	GameState.walls = [];
	GameState.isPlayerDead = false;
	markWallIndexDirty();
}

function loadProjectileCollisionDefaults() {
	Object.assign(CombatDefaults, {
		DEFAULT_MAXIMUM_PROJECTILE_COUNT: 50,
		MAXIMUM_PROJECTILE_COUNT_SAFEGUARD: 1000,
		PROJECTILE_MAX_STEP_BLOCKS: 10,
		MAX_WALL_IMPACTS_PER_SUBSTEP: 8,
		WALL_TOI_EPSILON: 1e-9,
		WALL_APPROACH_EPSILON: 1e-10,
		WALL_CONTACT_NUDGE: 1e-8,
	});
}

function makeChainMovementProjectile(overrides = {}) {
	return {
		x: 0,
		y: 0,
		radius: 0.25,
		vx: 4,
		vy: 0,
		color: "test",
		damage: 1,
		bounces: 0,
		maxBounces: 0,
		throwBounces: 0,
		hitTargets: new Set(),
		chain: 2,
		chainMaximumRangeBlocks: 0,
		chainsRemaining: 1,
		chainReferenceAngle: 0,
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
		...overrides,
	};
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
	assert.equal(GameState.projectileTrailEvents[0].checkpoint, undefined);
	assert.equal(GameState.projectileTrailEvents[1].checkpoint, true);
});


test("shoot records the exact projectile launch position as a checkpoint", () => {
	loadProjectileCollisionDefaults();
	resetProjectileSpawnTestState();

	const shooter = {
		id: 101,
		team: TEAM_PLAYER,
		x: 4,
		y: 5,
		size: 0.5,
		maximumProjectileCount: 10,
		upgrades: { variationLuck: 0 },
	};
	const stats = resolveProjectileDefinition(baseProjectile, {
		speed: 4,
		radiusBlocks: 0.25,
		lifetimeMs: 5000,
	});

	shoot(shooter, 10, 5.25, stats);

	assert.equal(GameState.projectiles.length, 1);
	const [projectile] = GameState.projectiles;
	const launchX = shooter.x + shooter.size / 2;
	const launchY = shooter.y + shooter.size / 2;
	assert.deepEqual(
		GameState.projectileTrailEvents.map((event) => ({
			projectile: event.projectile,
			x: event.x,
			y: event.y,
			checkpoint: event.checkpoint,
		})),
		[{ projectile, x: launchX, y: launchY, checkpoint: true }],
	);

	processProjectiles(projectile.createdAt + 100, 0.25);
	assert.ok(projectile.x > launchX);
	assert.equal(GameState.projectileTrailEvents.length, 1);
});

test("physical split children record their split origin as a launch checkpoint", () => {
	loadProjectileCollisionDefaults();
	resetProjectileSpawnTestState();
	const previousBaseProjectile = Config.BASE_PROJECTILE;
	Config.BASE_PROJECTILE = baseProjectile;

	try {
		const parent = {
			x: 7.5,
			y: 3.25,
			splitEnabled: true,
			splitCount: 1,
			splitSpread: 0,
			splitChildren: [],
			ownerId: 102,
			team: TEAM_PLAYER,
			variationLuckUpgrade: 0,
		};

		assert.equal(fireSplitChildren(parent, 0, 0), true);
		assert.equal(GameState.projectiles.length, 1);
		const [child] = GameState.projectiles;
		assert.deepEqual(
			GameState.projectileTrailEvents.map((event) => ({
				projectile: event.projectile,
				x: event.x,
				y: event.y,
				checkpoint: event.checkpoint,
			})),
			[{ projectile: child, x: parent.x, y: parent.y, checkpoint: true }],
		);
	} finally {
		Config.BASE_PROJECTILE = previousBaseProjectile;
		resetProjectileCaps();
	}
});


test("first chain target acquisition records an exact projectile trail checkpoint", () => {
	loadProjectileCollisionDefaults();
	resetProjectileSpawnTestState();

	const target = { x: 3.75, y: 2.75, size: 0.5, hp: 10 };
	GameState.enemies = [target];
	const projectile = makeChainMovementProjectile();
	GameState.projectiles = [projectile];

	processProjectiles(100, 0.1);

	assert.equal(projectile.chainTarget, target);
	assert.ok(projectile.vy > 0);
	assert.deepEqual(
		GameState.projectileTrailEvents.map((event) => ({
			x: event.x,
			y: event.y,
			checkpoint: event.checkpoint,
		})),
		[
			{ x: 0, y: 0, checkpoint: undefined },
			{ x: 0, y: 0, checkpoint: true },
		],
	);
});

test("switching to a new chain target records an exact projectile trail checkpoint", () => {
	loadProjectileCollisionDefaults();
	resetProjectileSpawnTestState();

	const staleTarget = { x: 3.75, y: 0, size: 0.5, hp: 0 };
	const replacementTarget = { x: 3.75, y: 2.75, size: 0.5, hp: 10 };
	GameState.enemies = [replacementTarget];
	const projectile = makeChainMovementProjectile({ chainTarget: staleTarget });
	GameState.projectiles = [projectile];

	processProjectiles(100, 0.1);

	assert.equal(projectile.chainTarget, replacementTarget);
	assert.deepEqual(
		GameState.projectileTrailEvents.map((event) => ({
			x: event.x,
			y: event.y,
			checkpoint: event.checkpoint,
		})),
		[
			{ x: 0, y: 0, checkpoint: undefined },
			{ x: 0, y: 0, checkpoint: true },
		],
	);
});


test("post-hit chain redirects record an exact projectile trail checkpoint", () => {
	loadProjectileCollisionDefaults();
	resetProjectileSpawnTestState();

	const hitTarget = { x: 0.75, y: -0.25, size: 0.5, hp: 10 };
	const nextTarget = { x: 0.75, y: 2.75, size: 0.5, hp: 10 };
	GameState.enemies = [hitTarget, nextTarget];

	const projectile = {
		x: 0,
		y: 0,
		radius: 0.25,
		vx: 4,
		vy: 0,
		color: "test",
		damage: 1,
		bounces: 0,
		maxBounces: 0,
		throwBounces: 0,
		hitTargets: new Set(),
		chain: 2,
		chainMaximumRangeBlocks: 0,
		chainsRemaining: 1,
		chainReferenceAngle: 0,
		chainVisitedTargets: new Set(),
		chainTarget: hitTarget,
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
	};
	GameState.projectiles = [projectile];

	processProjectiles(100, 0.25);

	assert.equal(projectile.chainTarget, nextTarget);
	assert.ok(Math.abs(projectile.vx) < 1e-10);
	assert.ok(projectile.vy > 3.99);
	assert.deepEqual(
		GameState.projectileTrailEvents.map((event) => ({
			x: event.x,
			y: event.y,
			checkpoint: event.checkpoint,
		})),
		[
			{ x: 0, y: 0, checkpoint: undefined },
			{ x: 1, y: 0, checkpoint: true },
		],
	);
});
