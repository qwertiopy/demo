// Procedural corridor traversal and structure generation.

import { Config } from "../config.js";
import { GameState } from "../state.js";
import { seededRandom } from "../utils.js";
import { getProceduralWindow } from "./procgen-window.js";
import {
	canPlaceStructure,
	getStructureTemplateSize,
	placeStructureTemplate,
	spawnWall,
} from "./structures.js";

// Generates the corridor, walls, and structures around the player's X position
// and records generated columns so they are not regenerated repeatedly.
export function updateProceduralGeneration(playerX) {
	const { generationStartX: startX, generationEndX: endX } =
		getProceduralWindow(playerX);

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
		};

		if (!canPlaceStructure(placedStructure)) continue;
		placeStructureTemplate(template, placedStructure);
	}
}
