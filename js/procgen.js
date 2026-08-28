// Procedural structure generation and cleanup.

import { Config } from "./config.js";
import {
	GameState,
	markEnvironmentChanged,
	markGeometryChanged,
	unregisterEntity,
} from "./state.js";
import { markWallIndexDirty } from "./spatial/wall-index.js";
import { seededRandom } from "./utils.js";
import { releaseProjectile } from "./combat/projectile-cap.js";

// Maps structure-grid spawn flags to explicit enemy types; flag 2 remains a random enemy spawn.
export const STRUCTURE_ENEMY_FLAGS = Object.freeze({
	2: null,
	3: "g-bot",
	4: "j-bot",
	5: "h-bot",
});

export const PROCEDURAL_PLAYER_SPAWN_RIGHT_BOUNDARY_X = 2;

let procgenBatchDepth = 0;
let batchedGeometryChanged = false;
let batchedEnvironmentChanged = false;

function beginProcgenBatch() {
	procgenBatchDepth++;
}

function noteGeometryChanged() {
	if (procgenBatchDepth > 0) {
		batchedGeometryChanged = true;
		return;
	}
	markWallIndexDirty();
	markGeometryChanged();
}

function noteEnvironmentChanged() {
	if (procgenBatchDepth > 0) {
		batchedEnvironmentChanged = true;
		return;
	}
	markEnvironmentChanged();
}

function endProcgenBatch() {
	procgenBatchDepth = Math.max(0, procgenBatchDepth - 1);
	if (procgenBatchDepth > 0) return;
	if (batchedGeometryChanged) {
		markWallIndexDirty();
		markGeometryChanged();
	} else if (batchedEnvironmentChanged) {
		markEnvironmentChanged();
	}
	batchedGeometryChanged = false;
	batchedEnvironmentChanged = false;
}

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
	ownerColumn = null,
	structureOriginX = null,
) {
	GameState.walls.push({
		x,
		y,
		width: widthBlocks,
		height: heightBlocks,
		color,
		ownerColumn,
		structureOriginX,
	});
	noteGeometryChanged();
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
export function spawnEnemyPointFromCell(
	cellX,
	cellY,
	type,
	ownerColumn = null,
	structureOriginX = null,
) {
	const resolvedType = Config.ENEMY_TYPES[type] ? type : "g-bot";
	const stats = Config.ENEMY_TYPES[resolvedType];
	const size = stats.sizeBlocks;

	GameState.enemySpawns.push({
		x: cellX + (1 - size) / 2,
		y: cellY + (1 - size) / 2,
		type: resolvedType,
		size,
		ownerColumn,
		structureOriginX,
	});
	noteEnvironmentChanged();
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

export function getMaximumStructureWidth(
	structureLibrary = Config.STRUCTURE_LIBRARY,
) {
	if (!Array.isArray(structureLibrary)) return 0;

	return structureLibrary.reduce((maximumWidth, template) => {
		const size = getStructureTemplateSize(template);
		return Math.max(maximumWidth, size?.width || 0);
	}, 0);
}

// Structure origins must be strictly beyond this boundary. Reserving the
// widest template as additional clearance keeps every generated structure away
// from the complete randomized player-spawn region.
export function getMinimumStructureOriginXExclusive(
	structureLibrary = Config.STRUCTURE_LIBRARY,
) {
	return (
		PROCEDURAL_PLAYER_SPAWN_RIGHT_BOUNDARY_X +
		getMaximumStructureWidth(structureLibrary)
	);
}

// Player coordinates are top-left hitbox coordinates. The one-block inset
// avoids the corridor boundary walls, while subtracting playerSize keeps the
// complete hitbox inside x < 2 and above the corridor floor.
export function getProceduralPlayerSpawn(
	runtimeSettings,
	playerSizeBlocks,
	random = seededRandom,
) {
	const playerSize = Math.max(0, Number(playerSizeBlocks) || 0);
	const minimumX = 1;
	const maximumX = PROCEDURAL_PLAYER_SPAWN_RIGHT_BOUNDARY_X - playerSize;
	const minimumY = runtimeSettings.corridorCeilingYBlocks + 1;
	const maximumY =
		runtimeSettings.corridorCeilingYBlocks +
		runtimeSettings.corridorWidthBlocks -
		playerSize;

	if (maximumX < minimumX || maximumY < minimumY) {
		throw new Error(
			"The player hitbox does not fit inside the procedural spawn region.",
		);
	}

	return {
		x: minimumX + random() * (maximumX - minimumX),
		y: minimumY + random() * (maximumY - minimumY),
	};
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
	if (!GameState.isProceduralLevel) return;
	beginProcgenBatch();
	try {
	const startX = Math.max(
		0,
		Math.floor(playerX) - Config.RENDERING.DISTANCE_BACK_BLOCKS,
	);
	const endX = Math.floor(playerX) + Config.RENDERING.DISTANCE_FRONT_BLOCKS;

	const ceilingY = GameState.corridorCeilingYBlocks;
	const corridorWidthBlocks = GameState.corridorWidthBlocks;
	const floorY = ceilingY + corridorWidthBlocks;

	if (!GameState.generatedColumns.has(0) && startX <= 0 && endX >= 0) {
		spawnWall(0, ceilingY, 1, corridorWidthBlocks + 1, "slategray", 0);
	}

	for (let blockX = startX; blockX <= endX; blockX++) {
		if (GameState.generatedColumns.has(blockX)) continue;

		GameState.generatedColumns.add(blockX);

		spawnWall(blockX, ceilingY, 1, 1, "slategray", blockX);
		spawnWall(blockX, floorY, 1, 1, "slategray", blockX);

		if (blockX <= GameState.minimumStructureOriginXExclusive) continue;

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
			ownerColumn: blockX,
		};

		if (!canPlaceStructure(placedStructure)) continue;
		GameState.placedStructures.push(placedStructure);

		for (let r = 0; r < template.grid.length; r++) {
			for (let c = 0; c < template.grid[r].length; c++) {
				const cell = template.grid[r][c];
				const worldX = blockX + c;
				const worldY = structY + r;

				if (cell === 1) {
					spawnWall(worldX, worldY, 1, 1, template.color, blockX, blockX);
					continue;
				}

				const enemyType = enemyTypeFromStructureFlag(cell);
				if (enemyType !== undefined) {
					spawnEnemyPointFromCell(
						worldX,
						worldY,
						enemyType,
						blockX,
						blockX,
					);
				}
			}
		}
	}
	} finally {
		endProcgenBatch();
	}
}

// Removes walls, structures, entities, projectiles, spawn points, and generated-column markers that have moved outside the active render window.
export function cleanupProceduralGeneration(playerX) {
	if (!GameState.isProceduralLevel) return;
	beginProcgenBatch();
	try {
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

	// Structure-owned content unloads as one unit. The structure origin is the
	// authoritative horizontal coordinate: as long as that origin remains in the
	// safe window, every wall/spawn belonging to the structure is retained even
	// when an individual cell extends beyond the cleanup boundary.
	//
	// ownerColumn historically equals the structure origin. Keep that fallback so
	// already-generated structures from an older runtime state also gain atomic
	// cleanup after this patch.
	const allStructureOrigins = new Set(
		GameState.placedStructures
			.map((structure) => Number(structure?.origin?.x))
			.filter(Number.isFinite),
	);
	const retainedStructureOrigins = new Set();
	GameState.placedStructures = GameState.placedStructures.filter((structure) => {
		const originX = Number(structure?.origin?.x);
		const retained =
			Number.isFinite(originX) && originX >= safeStartX && originX <= safeEndX;
		if (retained) retainedStructureOrigins.add(originX);
		return retained;
	});

	const getOwnedStructureOriginX = (item) => {
		const explicitOrigin = item?.structureOriginX;
		if (explicitOrigin !== null && explicitOrigin !== undefined) {
			const explicitOriginX = Number(explicitOrigin);
			if (Number.isFinite(explicitOriginX)) return explicitOriginX;
		}

		const legacyOwner = item?.ownerColumn;
		if (legacyOwner === null || legacyOwner === undefined) return null;
		const legacyOwnerColumn = Number(legacyOwner);
		return allStructureOrigins.has(legacyOwnerColumn) ? legacyOwnerColumn : null;
	};

	const retainedWalls = GameState.walls.filter((wall) => {
		const structureOriginX = getOwnedStructureOriginX(wall);
		if (structureOriginX !== null) {
			return retainedStructureOrigins.has(structureOriginX);
		}
		return wall.x + wall.width > safeStartX && wall.x <= safeEndX;
	});
	if (retainedWalls.length !== GameState.walls.length) {
		GameState.walls = retainedWalls;
		noteGeometryChanged();
	}

	// Despawn enemies once their full hitbox is outside the active render window.
	// Using the enemy's right edge on the back boundary prevents a partially
	// visible enemy from disappearing as soon as its left edge leaves the window.
	GameState.enemies = GameState.enemies.filter((e) => {
		const retained = e.x + e.size >= safeStartX && e.x <= safeEndX;
		if (!retained) unregisterEntity(e);
		return retained;
	});

	// Remove projectiles only once their entire circular hitbox is outside the
	// active horizontal render window. Compact the unified store in place so its
	// identity remains stable for every simulation subsystem.
	const bulletIsInsideRenderWindow = (b) => {
		const radius = Number(b.radius) || 0;
		return b.x + radius >= safeStartX && b.x - radius <= safeEndX;
	};

	for (let index = GameState.projectiles.length - 1; index >= 0; index--) {
		const projectile = GameState.projectiles[index];
		if (bulletIsInsideRenderWindow(projectile)) continue;
		releaseProjectile(projectile);
		GameState.projectiles.splice(index, 1);
	}

	const retainedEnemySpawns = GameState.enemySpawns.filter((spawn) => {
		const structureOriginX = getOwnedStructureOriginX(spawn);
		if (structureOriginX !== null) {
			return retainedStructureOrigins.has(structureOriginX);
		}
		return (
			spawn.x + (spawn.size || 0) >= safeStartX &&
			spawn.x <= safeEndX
		);
	});
	if (retainedEnemySpawns.length !== GameState.enemySpawns.length) {
		GameState.enemySpawns = retainedEnemySpawns;
		noteEnvironmentChanged();
	}

	// Keep generated columns for all retained content. Structure-owned walls and
	// spawns now disappear atomically with their origin, so an unloaded structure
	// cannot leave a tail behind that blocks or duplicates later regeneration.
	const retainedOwnerColumns = new Set();
	for (const wall of GameState.walls) {
		if (Number.isInteger(wall.ownerColumn)) retainedOwnerColumns.add(wall.ownerColumn);
	}
	for (const spawn of GameState.enemySpawns) {
		if (Number.isInteger(spawn.ownerColumn)) retainedOwnerColumns.add(spawn.ownerColumn);
	}
	for (const structure of GameState.placedStructures) {
		if (Number.isInteger(structure.ownerColumn)) {
			retainedOwnerColumns.add(structure.ownerColumn);
		}
	}
	const unloadedColumns = Array.from(GameState.generatedColumns).filter(
		(col) =>
			(col < safeStartX || col > safeEndX) &&
			!retainedOwnerColumns.has(col),
	);
	unloadedColumns.forEach((col) => GameState.generatedColumns.delete(col));
	} finally {
		endProcgenBatch();
	}
}
