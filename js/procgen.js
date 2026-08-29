// Public procedural-world facade. Internal generation, cleanup, structure
// ownership, and window calculation live under js/world/.

export { updateProceduralGeneration } from "./world/generation.js";
export { cleanupProceduralGeneration } from "./world/cleanup.js";
export { getProceduralWindow } from "./world/procgen-window.js";
export {
	STRUCTURE_ENEMY_FLAGS,
	PROCEDURAL_PLAYER_SPAWN_RIGHT_BOUNDARY_X,
	spawnWall,
	chooseEnemyType,
	enemyTypeFromStructureFlag,
	spawnEnemyPointFromCell,
	getStructureTemplateSize,
	getMaximumStructureWidth,
	getMinimumStructureOriginXExclusive,
	getProceduralPlayerSpawn,
	structureBoundsOverlap,
	canPlaceStructure,
} from "./world/structures.js";
