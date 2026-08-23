// Procedural structure generation and cleanup.

import { Config } from "./config.js";
import { GameState, markEnvironmentChanged } from "./state.js";
import { markWallIndexDirty } from "./spatial/wall-index.js";
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
	markWallIndexDirty();
	markEnvironmentChanged();
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
	markEnvironmentChanged();
}

// Uses whichever is larger: the declared template size or the actual grid.
// This keeps malformed, stale, or hand-edited dimensions from understating the
// rectangle that placement must reserve.
export function getStructureTemplateSize(template) {
	if (
		!Array.isArray(template?.grid) ||
		template.grid.length === 0 ||
		template.grid.some((row) => !Array.isArray(row))
	) {
		return null;
	}

	const gridWidth = template.grid.reduce(
		(maxWidth, row) => Math.max(maxWidth, row.length),
		0,
	);
	const declaredWidth = Math.max(
		0,
		Math.ceil(Number(template.widthBlocks) || 0),
	);
	const declaredHeight = Math.max(
		0,
		Math.ceil(Number(template.heightBlocks) || 0),
	);
	const width = Math.max(gridWidth, declaredWidth);
	const height = Math.max(template.grid.length, declaredHeight);

	return width > 0 && height > 0 ? { width, height } : null;
}

function getStructureBounds(structure) {
	const left = Number(structure?.origin?.x);
	const top = Number(structure?.origin?.y);
	const width = Number(structure?.size?.width);
	const height = Number(structure?.size?.height);

	if (
		!Number.isFinite(left) ||
		!Number.isFinite(top) ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		return null;
	}

	return {
		left,
		right: left + width,
		top,
		bottom: top + height,
	};
}

// Structure bounds are half-open, so adjacent structures may touch at an edge
// without being treated as overlapping.
export function structureBoundsOverlap(first, second) {
	const a = getStructureBounds(first);
	const b = getStructureBounds(second);
	if (!a || !b) return false;

	return (
		a.left < b.right &&
		a.right > b.left &&
		a.top < b.bottom &&
		a.bottom > b.top
	);
}

export function canPlaceStructure(
	candidate,
	placedStructures = GameState.placedStructures,
	minimumOriginDistance = GameState.structureDensityBlocks,
) {
	if (!getStructureBounds(candidate)) return false;

	const density = Math.max(0, Number(minimumOriginDistance) || 0);
	return placedStructures.every((placed) => {
		if (structureBoundsOverlap(candidate, placed)) return false;

		return (
			Math.hypot(
				candidate.origin.x - placed.origin.x,
				candidate.origin.y - placed.origin.y,
			) >= density
		);
	});
}

// Generates the corridor, walls, and structures around the player's X position and records generated columns so they are not regenerated repeatedly.
export function updateProceduralGeneration(playerX) {
	const startX = Math.max(
		0,
		Math.floor(playerX) - Config.RENDERING.DISTANCE_BACK_BLOCKS,
	);
	const endX = Math.floor(playerX) + Config.RENDERING.DISTANCE_FRONT_BLOCKS;

	const ceilingY = GameState.corridorCeilingYBlocks;
	const corridorWidthBlocks = GameState.corridorWidthBlocks;
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

		if (seededRandom() >= GameState.structureSpawnChance) continue;

		const template =
			Config.STRUCTURE_LIBRARY[
				Math.floor(seededRandom() * Config.STRUCTURE_LIBRARY.length)
			];

		if (!template) continue;
		const structureSize = getStructureTemplateSize(template);
		if (!structureSize) continue;

		const minY = ceilingY + 1;
		const maxY = floorY - structureSize.height;
		if (maxY < minY) continue;
		const structY = Math.floor(seededRandom() * (maxY - minY + 1)) + minY;

		const placedStructure = {
			origin: { x: blockX, y: structY },
			size: structureSize,
			type: template.type,
		};

		if (!canPlaceStructure(placedStructure)) continue;
		GameState.placedStructures.push(placedStructure);

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

	const retainedWalls = GameState.walls.filter(
		(w) => w.x >= safeStartX && w.x <= safeEndX,
	);
	if (retainedWalls.length !== GameState.walls.length) {
		GameState.walls = retainedWalls;
		markWallIndexDirty();
		markEnvironmentChanged();
	}

	GameState.placedStructures = GameState.placedStructures.filter(
		(s) =>
			s.origin.x + s.size.width > safeStartX &&
			s.origin.x <= safeEndX,
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

	const retainedEnemySpawns = GameState.enemySpawns.filter((s) => s.x >= startX);
	if (retainedEnemySpawns.length !== GameState.enemySpawns.length) {
		GameState.enemySpawns = retainedEnemySpawns;
		markEnvironmentChanged();
	}

	const unloadedColumns = Array.from(GameState.generatedColumns).filter(
		(col) => col < startX || col > endX,
	);

	unloadedColumns.forEach((col) => GameState.generatedColumns.delete(col));
}
