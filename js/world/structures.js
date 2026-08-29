// Procedural structure templates, placement rules, and owned component creation.

import { Config } from "../config.js";
import { GameState, markEnvironmentChanged } from "../state.js";
import { markWallIndexDirty } from "../spatial/wall-index.js";
import { seededRandom } from "../utils.js";

// Maps structure-grid spawn flags to explicit enemy types; flag 2 remains a random enemy spawn.
export const STRUCTURE_ENEMY_FLAGS = Object.freeze({
	2: null,
	3: "g-bot",
	4: "j-bot",
	5: "h-bot",
});

export const PROCEDURAL_PLAYER_SPAWN_RIGHT_BOUNDARY_X = 2;

// Adds a rectangular wall to the active wall list. Structure-owned walls carry
// the origin that controls their cleanup lifecycle.
export function spawnWall(
	x,
	y,
	widthBlocks,
	heightBlocks,
	color = "slategray",
	structureOriginX = null,
) {
	const wall = {
		x,
		y,
		width: widthBlocks,
		height: heightBlocks,
		color,
	};
	if (Number.isFinite(structureOriginX)) {
		wall.structureOriginX = structureOriginX;
	}
	GameState.walls.push(wall);
	markWallIndexDirty();
	markEnvironmentChanged();
}

// Uses the seeded RNG to select one of the three enemy types.
export function chooseEnemyType() {
	const enemyTypeRoll = seededRandom();
	return enemyTypeRoll > 0.7
		? "h-bot"
		: enemyTypeRoll > 0.3
			? "j-bot"
			: "g-bot";
}

// Converts a structure cell flag into an enemy type, or returns undefined for cells that do not spawn enemies.
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
	structureOriginX = null,
) {
	const resolvedType = Config.ENEMY_TYPES[type] ? type : "g-bot";
	const stats = Config.ENEMY_TYPES[resolvedType];
	const size = stats.sizeBlocks;
	const spawn = {
		x: cellX + (1 - size) / 2,
		y: cellY + (1 - size) / 2,
		type: resolvedType,
		size,
	};
	if (Number.isFinite(structureOriginX)) {
		spawn.structureOriginX = structureOriginX;
	}

	GameState.enemySpawns.push(spawn);
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

// Commits a structure template at an already-approved origin. The caller owns
// template selection and placement eligibility so RNG sequencing remains explicit.
export function placeStructureTemplate(template, placedStructure) {
	const blockX = placedStructure.origin.x;
	const structY = placedStructure.origin.y;
	GameState.placedStructures.push(placedStructure);

	for (let r = 0; r < template.grid.length; r++) {
		for (let c = 0; c < template.grid[r].length; c++) {
			const cell = template.grid[r][c];
			const worldX = blockX + c;
			const worldY = structY + r;

			if (cell === 1) {
				spawnWall(worldX, worldY, 1, 1, template.color, blockX);
				continue;
			}

			const enemyType = enemyTypeFromStructureFlag(cell);
			if (enemyType !== undefined) {
				spawnEnemyPointFromCell(worldX, worldY, enemyType, blockX);
			}
		}
	}

	return placedStructure;
}
