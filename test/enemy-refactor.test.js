import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
	resolveEnemyVectorCollisions as facadeResolveEnemyVectorCollisions,
	updateEnemies as facadeUpdateEnemies,
} from "../js/combat/enemies.js";
import {
	resolveEnemyVectorCollisions as moduleResolveEnemyVectorCollisions,
	updateEnemies as moduleUpdateEnemies,
} from "../js/combat/enemies/index.js";
import { processEnemySpawning } from "../js/combat/enemies/spawn.js";
import { updateAggressiveEnemyMovement } from "../js/combat/enemies/movement.js";
import { Config } from "../js/config.js";
import { CombatDefaults } from "../js/combat/defaults.js";
import { GameState, player } from "../js/state.js";

const factoryConfig = JSON.parse(
	fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"),
);
const factoryCombatDefaults = JSON.parse(
	fs.readFileSync(new URL("../js/combat/defaults.json", import.meta.url), "utf8"),
);

function withEnemyState(run) {
	const previousState = {
		enemies: GameState.enemies,
		enemySpawns: GameState.enemySpawns,
		enemySpawnRate: GameState.enemySpawnRate,
		minimumEnemySpawnDistanceBlocks: GameState.minimumEnemySpawnDistanceBlocks,
		maximumEnemySpawnDistanceBlocks: GameState.maximumEnemySpawnDistanceBlocks,
		lastSpawnTime: GameState.lastSpawnTime,
		walls: GameState.walls,
		environmentRevision: GameState.environmentRevision,
		currentSeed: GameState.currentSeed,
	};
	const previousPlayer = {
		x: player.x,
		y: player.y,
		size: player.size,
	};
	const previousCombatDefaults = { ...CombatDefaults };
	const previousConfig = {
		BASE_PROJECTILE: Config.BASE_PROJECTILE,
		ENEMY_TYPES: Config.ENEMY_TYPES,
	};

	GameState.enemies = [];
	GameState.enemySpawns = [];
	GameState.walls = [];
	GameState.environmentRevision = 0;
	GameState.currentSeed = 12345;
	Config.BASE_PROJECTILE = factoryConfig.BASE_PROJECTILE;
	Config.ENEMY_TYPES = factoryConfig.ENEMY_TYPES;
	Object.assign(CombatDefaults, factoryCombatDefaults);

	try {
		run();
	} finally {
		Object.assign(GameState, previousState);
		Object.assign(player, previousPlayer);
		Object.assign(Config, previousConfig);
		for (const key of Object.keys(CombatDefaults)) delete CombatDefaults[key];
		Object.assign(CombatDefaults, previousCombatDefaults);
	}
}

test("enemy facade preserves the established public simulation exports", () => {
	assert.equal(facadeUpdateEnemies, moduleUpdateEnemies);
	assert.equal(
		facadeResolveEnemyVectorCollisions,
		moduleResolveEnemyVectorCollisions,
	);
});

test("extracted enemy spawning preserves inclusive min/max distance eligibility", () => {
	withEnemyState(() => {
		player.x = 0;
		player.y = 0;
		player.size = 0.5;
		GameState.enemySpawnRate = 1;
		GameState.minimumEnemySpawnDistanceBlocks = 25;
		GameState.maximumEnemySpawnDistanceBlocks = 35;
		GameState.lastSpawnTime = 0;

		const centerX = player.x + player.size / 2;
		const centerY = player.y + player.size / 2;
		GameState.enemySpawns = [
			{ x: centerX + 25, y: centerY, type: "g-bot" },
		];
		processEnemySpawning(1001);
		assert.equal(GameState.enemies.length, 1);

		GameState.enemies = [];
		GameState.lastSpawnTime = 0;
		GameState.enemySpawns = [
			{ x: centerX + 35, y: centerY, type: "g-bot" },
		];
		processEnemySpawning(1001);
		assert.equal(GameState.enemies.length, 1);

		GameState.enemies = [];
		GameState.lastSpawnTime = 0;
		GameState.enemySpawns = [
			{ x: centerX + 35.001, y: centerY, type: "g-bot" },
		];
		processEnemySpawning(1001);
		assert.equal(GameState.enemies.length, 0);
		assert.equal(GameState.lastSpawnTime, 1001);
	});
});

test("extracted aggressive movement preserves remembered-target clearing", () => {
	const enemy = {
		ai: "aggressive",
		x: 0,
		y: 0,
		size: 1,
		speed: 5,
		vx: 0,
		vy: 0,
		lastSeenX: 1,
		lastSeenY: 0.5,
		hasAimTarget: true,
		aimWallVisibilityScan: {},
		debugVisibleAimInterval: {},
		debugMaximumAimInterval: {},
		debugAimVisibilityProfile: {},
		debugAimWallScanTruncated: true,
		debugUsingCachedCorner: true,
	};

	updateAggressiveEnemyMovement(enemy, false, 10, 0.5, 0.5, 0.5, 1);
	assert.equal(enemy.lastSeenX, null);
	assert.equal(enemy.lastSeenY, null);
	assert.equal(enemy.hasAimTarget, false);
	assert.equal(enemy.vx, 0);
	assert.equal(enemy.vy, 0);
	assert.equal(enemy.aimWallVisibilityScan, null);
});

test("extracted separation preserves pairwise overlap displacement", () => {
	withEnemyState(() => {
		GameState.enemies = [
			{ x: 0, y: 0, size: 1, hp: 1, vx: 0, vy: 0, moveX: 0, moveY: 0 },
			{ x: 0.75, y: 0, size: 1, hp: 1, vx: 0, vy: 0, moveX: 0, moveY: 0 },
		];

		moduleResolveEnemyVectorCollisions(0);
		assert.equal(GameState.enemies[0].x, -0.0625);
		assert.equal(GameState.enemies[1].x, 0.8125);
		assert.equal(GameState.enemies[0].y, 0);
		assert.equal(GameState.enemies[1].y, 0);
	});
});
