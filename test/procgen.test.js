import test from "node:test";
import assert from "node:assert/strict";

import {
	getMaximumStructureWidth,
	getMinimumStructureOriginXExclusive,
	getProceduralPlayerSpawn,
	getStructureTemplateSize,
	structureBoundsOverlap,
	updateProceduralGeneration,
	cleanupProceduralGeneration,
} from "../js/procgen.js";
import { GameState } from "../js/state.js";
import { Config } from "../js/config.js";

test("template size never understates either declared or grid dimensions", () => {
	assert.deepEqual(
		getStructureTemplateSize({ widthBlocks: 2, heightBlocks: 1, grid: [[1, 1, 1], [1]] }),
		{ width: 3, height: 2 },
	);
	assert.deepEqual(
		getStructureTemplateSize({ widthBlocks: 5, heightBlocks: 4, grid: [[1]] }),
		{ width: 5, height: 4 },
	);
});

test("structure overlap uses half-open bounds and permits edge contact", () => {
	const first = { origin: { x: 0, y: 0 }, size: { width: 2, height: 2 } };
	const touching = { origin: { x: 2, y: 0 }, size: { width: 1, height: 1 } };
	const overlapping = { origin: { x: 1.999, y: 0 }, size: { width: 1, height: 1 } };
	assert.equal(structureBoundsOverlap(first, touching), false);
	assert.equal(structureBoundsOverlap(first, overlapping), true);
});

test("spawn clearance derives from the widest configured structure", () => {
	const library = [
		{ widthBlocks: 2, heightBlocks: 1, grid: [[1, 1]] },
		{ widthBlocks: 1, heightBlocks: 1, grid: [[1, 1, 1, 1]] },
	];
	assert.equal(getMaximumStructureWidth(library), 4);
	assert.equal(getMinimumStructureOriginXExclusive(library), 6);
});

test("procedural player spawn preserves current random-region endpoints", () => {
	const settings = { corridorCeilingYBlocks: 0, corridorWidthBlocks: 10 };
	assert.deepEqual(getProceduralPlayerSpawn(settings, 0.5, () => 0), { x: 1, y: 1 });
	assert.deepEqual(getProceduralPlayerSpawn(settings, 0.5, () => 1), { x: 1.5, y: 9.5 });
});

test("explicit levels cannot generate or clean procedural content", () => {
	GameState.isProceduralLevel = false;
	GameState.walls = [{ x: 100, y: 100, width: 1, height: 1 }];
	GameState.generatedColumns = new Set();
	updateProceduralGeneration(0);
	cleanupProceduralGeneration(0);
	assert.equal(GameState.walls.length, 1);
	assert.equal(GameState.generatedColumns.size, 0);
});

test("structure-owned tails stay loaded while their origin is retained", () => {
	const previousProcedural = GameState.isProceduralLevel;
	const previousWalls = GameState.walls;
	const previousStructures = GameState.placedStructures;
	const previousSpawns = GameState.enemySpawns;
	const previousEnemies = GameState.enemies;
	const previousProjectiles = GameState.projectiles;
	const previousColumns = GameState.generatedColumns;
	const previousBack = Config.RENDERING.DISTANCE_BACK_BLOCKS;
	const previousFront = Config.RENDERING.DISTANCE_FRONT_BLOCKS;
	const previousBuffer = Config.RENDERING.CLEANUP_BUFFER_BLOCKS;

	try {
		GameState.isProceduralLevel = true;
		GameState.walls = [
			{
				x: 15,
				y: 1,
				width: 1,
				height: 1,
				ownerColumn: 10,
				structureOriginX: 10,
			},
			{
				x: 15,
				y: 0,
				width: 1,
				height: 1,
				ownerColumn: 15,
				structureOriginX: null,
			},
		];
		GameState.placedStructures = [{
			origin: { x: 10, y: 1 },
			size: { width: 6, height: 1 },
			ownerColumn: 10,
		}];
		GameState.enemySpawns = [{
			x: 15.25,
			y: 1.25,
			size: 0.5,
			type: "g-bot",
			ownerColumn: 10,
			structureOriginX: 10,
		}];
		GameState.enemies = [];
		GameState.projectiles = [];
		GameState.generatedColumns = new Set([10, 15]);
		Config.RENDERING.DISTANCE_BACK_BLOCKS = 1;
		Config.RENDERING.DISTANCE_FRONT_BLOCKS = 1;
		Config.RENDERING.CLEANUP_BUFFER_BLOCKS = 0;

		cleanupProceduralGeneration(10);

		assert.equal(GameState.placedStructures.length, 1);
		assert.equal(GameState.walls.length, 1);
		assert.equal(GameState.walls[0].structureOriginX, 10);
		assert.equal(GameState.enemySpawns.length, 1);
		assert.equal(GameState.generatedColumns.has(10), true);
		assert.equal(GameState.generatedColumns.has(15), false);
	} finally {
		Config.RENDERING.DISTANCE_BACK_BLOCKS = previousBack;
		Config.RENDERING.DISTANCE_FRONT_BLOCKS = previousFront;
		Config.RENDERING.CLEANUP_BUFFER_BLOCKS = previousBuffer;
		GameState.isProceduralLevel = previousProcedural;
		GameState.walls = previousWalls;
		GameState.placedStructures = previousStructures;
		GameState.enemySpawns = previousSpawns;
		GameState.enemies = previousEnemies;
		GameState.projectiles = previousProjectiles;
		GameState.generatedColumns = previousColumns;
	}
});

test("structure-owned content unloads together when its origin leaves the window", () => {
	const previousProcedural = GameState.isProceduralLevel;
	const previousWalls = GameState.walls;
	const previousStructures = GameState.placedStructures;
	const previousSpawns = GameState.enemySpawns;
	const previousEnemies = GameState.enemies;
	const previousProjectiles = GameState.projectiles;
	const previousColumns = GameState.generatedColumns;
	const previousBack = Config.RENDERING.DISTANCE_BACK_BLOCKS;
	const previousFront = Config.RENDERING.DISTANCE_FRONT_BLOCKS;
	const previousBuffer = Config.RENDERING.CLEANUP_BUFFER_BLOCKS;

	try {
		GameState.isProceduralLevel = true;
		GameState.walls = [{
			x: 10,
			y: 1,
			width: 1,
			height: 1,
			ownerColumn: 8,
			structureOriginX: 8,
		}];
		GameState.placedStructures = [{
			origin: { x: 8, y: 1 },
			size: { width: 6, height: 1 },
			ownerColumn: 8,
		}];
		GameState.enemySpawns = [{
			x: 10.25,
			y: 1.25,
			size: 0.5,
			type: "g-bot",
			ownerColumn: 8,
			structureOriginX: 8,
		}];
		GameState.enemies = [];
		GameState.projectiles = [];
		GameState.generatedColumns = new Set([8]);
		Config.RENDERING.DISTANCE_BACK_BLOCKS = 1;
		Config.RENDERING.DISTANCE_FRONT_BLOCKS = 1;
		Config.RENDERING.CLEANUP_BUFFER_BLOCKS = 0;

		cleanupProceduralGeneration(10);

		assert.equal(GameState.placedStructures.length, 0);
		assert.equal(GameState.walls.length, 0);
		assert.equal(GameState.enemySpawns.length, 0);
		assert.equal(GameState.generatedColumns.has(8), false);
	} finally {
		Config.RENDERING.DISTANCE_BACK_BLOCKS = previousBack;
		Config.RENDERING.DISTANCE_FRONT_BLOCKS = previousFront;
		Config.RENDERING.CLEANUP_BUFFER_BLOCKS = previousBuffer;
		GameState.isProceduralLevel = previousProcedural;
		GameState.walls = previousWalls;
		GameState.placedStructures = previousStructures;
		GameState.enemySpawns = previousSpawns;
		GameState.enemies = previousEnemies;
		GameState.projectiles = previousProjectiles;
		GameState.generatedColumns = previousColumns;
	}
});
