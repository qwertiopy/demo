import assert from "node:assert/strict";
import test from "node:test";

import * as laserFacade from "../js/combat/lasers.js";
import * as laserIndex from "../js/combat/lasers/index.js";
import {
	consumeLaserCalculationBudget,
	getLaserCalculationBudgetRemaining,
	resetLaserCalculationBudget,
} from "../js/combat/lasers/budget.js";
import { getLaserWallStopWithPenetrationBudget } from "../js/combat/lasers/wall-interaction.js";
import { CombatDefaults } from "../js/combat/defaults.js";
import { resetProjectileCaps } from "../js/combat/projectile-cap.js";
import { markWallIndexDirty } from "../js/spatial/wall-index.js";
import { GameState, player } from "../js/state.js";

function installLaserDefaults({ budget = 10000 } = {}) {
	Object.assign(CombatDefaults, {
		DEFAULT_MAXIMUM_PROJECTILE_COUNT: 50,
		MAXIMUM_PROJECTILE_COUNT_SAFEGUARD: 1000,
		LASER_CALCULATION_BUDGET_PER_FRAME: budget,
		MAX_CHAINED_LASER_SEGMENTS: 10000,
	});
}

function resetLaserState() {
	GameState.walls = [];
	GameState.enemies = [];
	GameState.laserWarmups = [];
	GameState.laserBeams = [];
	GameState.weaponCooldownUntilByWeapon = [];
	GameState.isInvincible = false;
	player.x = 0;
	player.y = 0;
	player.size = 0.5;
	player.hp = 10;
	player.maximumProjectileCount = 50;
	resetProjectileCaps();
	markWallIndexDirty();
}

test("laser facade preserves the established public exports", () => {
	for (const name of [
		"getLaserCalculationBudgetPerFrame",
		"getLaserCalculationBudgetRemaining",
		"getLaserWallStopWithPenetrationBudget",
		"processLasers",
		"requestLaserShot",
		"resetLaserCalculationBudget",
	]) {
		assert.equal(laserFacade[name], laserIndex[name]);
	}
	assert.equal(typeof laserFacade.rayRectIntersection, "function");
});

test("extracted laser budget remains a hard non-overrunning limit", () => {
	installLaserDefaults({ budget: 3 });
	resetLaserCalculationBudget();

	assert.equal(getLaserCalculationBudgetRemaining(), 3);
	assert.equal(consumeLaserCalculationBudget(2), true);
	assert.equal(getLaserCalculationBudgetRemaining(), 1);
	assert.equal(consumeLaserCalculationBudget(2), false);
	assert.equal(getLaserCalculationBudgetRemaining(), 1);
	assert.equal(consumeLaserCalculationBudget(1), true);
	assert.equal(getLaserCalculationBudgetRemaining(), 0);
});

test("extracted wall traversal preserves cumulative penetration stop distance", () => {
	installLaserDefaults();
	resetLaserState();
	GameState.walls = [{ x: 2, y: -1, width: 1, height: 2 }];
	markWallIndexDirty();
	resetLaserCalculationBudget();

	const stop = getLaserWallStopWithPenetrationBudget(
		0,
		0,
		1,
		0,
		0,
		0.5,
		10,
		false,
	);

	assert.equal(stop.truncated, false);
	assert.equal(stop.impactedWall, true);
	assert.equal(stop.distance, 2.5);
	assert.equal(stop.remainingPenetrationBlocks, 0);
	assert.equal(stop.normalX, -1);
	assert.equal(stop.normalY, 0);
});

test("extracted warmup lifecycle preserves the exact fireAt cooldown boundary", () => {
	installLaserDefaults();
	resetLaserState();
	resetLaserCalculationBudget();

	const stats = {
		bulletCount: 1,
		radiusBlocks: 0.03,
		radiusVariation: 0,
		damage: 1,
		damageVariation: 0,
		spread: 0,
		chain: {
			enabled: false,
			maxTargets: 0,
			maximumRangeBlocks: 0,
		},
		laserWarmupMs: 10,
		cooldownMs: 50,
		penetrationBlocks: 0,
		maxBounces: 0,
		color: "white",
	};

	assert.equal(laserFacade.requestLaserShot(player, 10, 0.25, stats, 0, 0), true);
	assert.equal(GameState.laserWarmups.length, 1);
	assert.equal(GameState.laserWarmups[0].fireAt, 10);

	laserFacade.processLasers(9.999);
	assert.equal(GameState.laserWarmups.length, 1);
	assert.equal(GameState.laserBeams.length, 0);
	assert.equal(GameState.weaponCooldownUntilByWeapon[0] || 0, 0);

	laserFacade.processLasers(10);
	assert.equal(GameState.laserWarmups.length, 0);
	assert.equal(GameState.laserBeams.length, 1);
	assert.equal(GameState.weaponCooldownUntilByWeapon[0], 60);
});
