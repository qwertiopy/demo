import test from "node:test";
import assert from "node:assert/strict";

import {
	cleanupProceduralGeneration,
	getMaximumStructureWidth,
	getMinimumStructureOriginXExclusive,
	getProceduralPlayerSpawn,
	getStructureTemplateSize,
	spawnEnemyPointFromCell,
	spawnWall,
	structureBoundsOverlap,
} from "../js/procgen.js";
import { Config } from "../js/config.js";
import { GameState } from "../js/state.js";

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

function withProcgenCleanupState(run) {
	const previous = {
		walls: GameState.walls,
		placedStructures: GameState.placedStructures,
		enemies: GameState.enemies,
		projectiles: GameState.projectiles,
		enemySpawns: GameState.enemySpawns,
		generatedColumns: GameState.generatedColumns,
		environmentRevision: GameState.environmentRevision,
	};

	GameState.walls = [];
	GameState.placedStructures = [];
	GameState.enemies = [];
	GameState.projectiles = [];
	GameState.enemySpawns = [];
	GameState.generatedColumns = new Set();

	try {
		run();
	} finally {
		Object.assign(GameState, previous);
	}
}

test("cleanup retains every structure-owned component while its origin is retained", () => {
	withProcgenCleanupState(() => {
		const playerX = 100;
		const safeEndX =
			Math.floor(playerX) +
			Config.RENDERING.DISTANCE_FRONT_BLOCKS +
			Config.RENDERING.CLEANUP_BUFFER_BLOCKS;
		const structureOriginX = safeEndX;

		GameState.placedStructures = [
			{
				origin: { x: structureOriginX, y: 2 },
				size: { width: 6, height: 2 },
				type: "test",
			},
		];
		GameState.walls = [
			{ x: structureOriginX + 5, y: 2, width: 1, height: 1, structureOriginX },
		];
		GameState.enemySpawns = [
			{ x: structureOriginX + 5.25, y: 2.25, size: 0.5, type: "g-bot", structureOriginX },
		];

		cleanupProceduralGeneration(playerX);

		assert.equal(GameState.placedStructures.length, 1);
		assert.equal(GameState.walls.length, 1);
		assert.equal(GameState.enemySpawns.length, 1);
	});
});

test("cleanup unloads every structure-owned component once its origin leaves the window", () => {
	withProcgenCleanupState(() => {
		const playerX = 100;
		const safeStartX =
			Math.max(
				0,
				Math.floor(playerX) - Config.RENDERING.DISTANCE_BACK_BLOCKS,
			) - Config.RENDERING.CLEANUP_BUFFER_BLOCKS;
		const structureOriginX = safeStartX - 1;

		GameState.placedStructures = [
			{
				origin: { x: structureOriginX, y: 2 },
				size: { width: 6, height: 2 },
				type: "test",
			},
		];
		GameState.walls = [
			{ x: safeStartX + 2, y: 2, width: 1, height: 1, structureOriginX },
		];
		GameState.enemySpawns = [
			{ x: safeStartX + 2.25, y: 2.25, size: 0.5, type: "g-bot", structureOriginX },
		];

		cleanupProceduralGeneration(playerX);

		assert.equal(GameState.placedStructures.length, 0);
		assert.equal(GameState.walls.length, 0);
		assert.equal(GameState.enemySpawns.length, 0);
	});
});

test("structure component creators record ownership without tagging corridor geometry", () => {
	withProcgenCleanupState(() => {
		const previousRevision = GameState.environmentRevision;
		const previousEnemyTypes = Config.ENEMY_TYPES;
		const structureOriginX = 42;
		Config.ENEMY_TYPES = { "g-bot": { sizeBlocks: 0.5 } };

		try {
			spawnWall(42, 3, 1, 1, "slategray", structureOriginX);
			spawnEnemyPointFromCell(43, 3, "g-bot", structureOriginX);
			spawnWall(44, 0, 1, 1, "slategray");

			assert.equal(GameState.walls[0].structureOriginX, structureOriginX);
			assert.equal(GameState.enemySpawns[0].structureOriginX, structureOriginX);
			assert.equal(Object.hasOwn(GameState.walls[1], "structureOriginX"), false);
			assert.ok(GameState.environmentRevision > previousRevision);
		} finally {
			Config.ENEMY_TYPES = previousEnemyTypes;
		}
	});
});
