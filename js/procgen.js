// Procedural structure generation and cleanup.

import { Config } from "./config.js";
import { GameState } from "./state.js";
import { seededRandom } from "./utils.js";

// Maps structure-grid spawn flags to explicit enemy types; flag 2 remains a random enemy spawn.
export const STRUCTURE_ENEMY_FLAGS = Object.freeze({
	2: null,
	3: "g-bot",
	4: "j-bot",
	5: "h-bot",
});

// Adds a rectangular wall to the active wall list
/*  i feel like storing walls in an array can be inefficient because we're checking collisions many times per frame, which means we're also iterating over every wall
    several times; I would use a hash table based on coordinates, then we'd have O(1) average lookup and we'd only be checking relevant walls
    i havent noticed this being a performance issue though, so maybe it's irrelevant - cyn   
*/
export function spawnWall(
	x,
	y,
	widthBlocks,
	heightBlocks,
	color = "slategray",
) {
	GameState.walls.push({
		x,
		y,
		width: widthBlocks,
		height: heightBlocks,
		color,
	});
}

// Uses the seeded RNG to select one of the three enemy types
// this can be made more modular for more enemy types - cyn
export function chooseEnemyType() {
	const enemyTypeRoll = seededRandom();
	return enemyTypeRoll > 0.7
		? "h-bot"
		: enemyTypeRoll > 0.3
			? "j-bot"
			: "g-bot";
}

// Converts a structure cell flag into an enemy type, or returns undefined for cells that do not spawn enemies
export function enemyTypeFromStructureFlag(flag) {
	if (!Object.prototype.hasOwnProperty.call(STRUCTURE_ENEMY_FLAGS, flag)) {
		return undefined;
	}

	return STRUCTURE_ENEMY_FLAGS[flag] || chooseEnemyType();
}

// Creates an enemy spawn point centered inside a one-block structure cell.
export function spawnEnemyPointFromCell(cellX, cellY, type) {
	const resolvedType = Config.ENEMY_TYPES[type] ? type : "g-bot";
	const stats = Config.ENEMY_TYPES[resolvedType];
	const size = stats.sizeBlocks;

	GameState.enemySpawns.push({
		x: cellX + (1 - size) / 2,
		y: cellY + (1 - size) / 2,
		type: resolvedType,
		size,
	});
}

// Generates the corridor, walls, and structures around the player's X position and records generated columns so they are not regenerated repeatedly.
export function updateProceduralGeneration(playerX) {
	const startX = Math.max(
		0,
		Math.floor(playerX) - Config.RENDERING.DISTANCE_BACK_BLOCKS,
	);
	const endX = Math.floor(playerX) + Config.RENDERING.DISTANCE_FRONT_BLOCKS;

	const ceilingY = 0;
	const corridorWidthBlocks = 10;
	const floorY = ceilingY + corridorWidthBlocks;

	if (!GameState.generatedColumns.has(0) && startX <= 0 && endX >= 0) {
		spawnWall(0, ceilingY, 1, corridorWidthBlocks + 1, "slategray");
	}

	for (let blockX = startX; blockX <= endX; blockX++) {
		if (GameState.generatedColumns.has(blockX)) continue;

		GameState.generatedColumns.add(blockX);

		spawnWall(blockX, ceilingY, 1, 1, "slategray");
		spawnWall(blockX, floorY, 1, 1, "slategray");

		if (blockX < 1) continue;

		GameState.currentSeed =
			((GameState.levelSeed ^ (blockX * 2654435761)) >>> 0) % 233280;

		if (seededRandom() <= 0.5) continue;

		const template =
			Config.STRUCTURE_LIBRARY[
				Math.floor(seededRandom() * Config.STRUCTURE_LIBRARY.length)
			];

		if (!template) continue;

		const minY = ceilingY + 1;
		const maxY = floorY - template.heightBlocks;
		const structY = Math.floor(seededRandom() * (maxY - minY + 1)) + minY;

		const canSpawn = !GameState.placedStructures.some(
			(s) =>
				Math.hypot(blockX - s.origin.x, structY - s.origin.y) <
				Config.STRUCTURE_DENSITY_BLOCKS,
		);

		if (!canSpawn) continue;

		GameState.placedStructures.push({
			origin: { x: blockX, y: structY },
			size: {
				width: template.widthBlocks,
				height: template.heightBlocks,
			},
			type: template.type,
		});

		for (let r = 0; r < template.grid.length; r++) {
			for (let c = 0; c < template.grid[r].length; c++) {
				const cell = template.grid[r][c];
				const worldX = blockX + c;
				const worldY = structY + r;

				if (cell === 1) {
					spawnWall(worldX, worldY, 1, 1, template.color);
					continue;
				}

				const enemyType = enemyTypeFromStructureFlag(cell);
				if (enemyType !== undefined) {
					spawnEnemyPointFromCell(worldX, worldY, enemyType);
				}
			}
		}
	}
}

// Removes walls, structures, entities, projectiles, spawn points, and generated-column markers that have moved outside the active render window.
export function cleanupProceduralGeneration(playerX) {
	const startX = Math.max(
		0,
		Math.floor(playerX) - Config.RENDERING.DISTANCE_BACK_BLOCKS,
	);
	const endX = Math.floor(playerX) + Config.RENDERING.DISTANCE_FRONT_BLOCKS;

	const cleanupBuffer = Math.max(
		0,
		Number(Config.RENDERING.CLEANUP_BUFFER_BLOCKS) || 0,
	);
	const safeStartX = startX - cleanupBuffer;
	const safeEndX = endX + cleanupBuffer;

	GameState.walls = GameState.walls.filter(
		(w) => w.x >= safeStartX && w.x <= safeEndX,
	);

	GameState.placedStructures = GameState.placedStructures.filter(
		(s) => s.origin.x >= safeStartX && s.origin.x <= safeEndX,
	);

	// Despawn enemies once their full hitbox is outside the active render window.
	// Using the enemy's right edge on the back boundary prevents a partially
	// visible enemy from disappearing as soon as its left edge leaves the window.
	GameState.enemies = GameState.enemies.filter(
		(e) => e.x + e.size >= safeStartX && e.x <= safeEndX,
	);

	// Remove projectiles only once their entire circular hitbox is outside the
	// active horizontal render window. Apply this to both player and enemy bullets.
	const bulletIsInsideRenderWindow = (b) => {
		const radius = Number(b.radius) || 0;
		return b.x + radius >= safeStartX && b.x - radius <= safeEndX;
	};

	GameState.bullets = GameState.bullets.filter(bulletIsInsideRenderWindow);
	GameState.enemyBullets = GameState.enemyBullets.filter(
		bulletIsInsideRenderWindow,
	);

	GameState.enemySpawns = GameState.enemySpawns.filter((s) => s.x >= startX);

	const unloadedColumns = Array.from(GameState.generatedColumns).filter(
		(col) => col < startX || col > endX,
	);

	unloadedColumns.forEach((col) => GameState.generatedColumns.delete(col));
}
