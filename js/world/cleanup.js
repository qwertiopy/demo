// Procedural world cleanup and structure-owned lifecycle handling.

import { GameState, markEnvironmentChanged } from "../state.js";
import { markWallIndexDirty } from "../spatial/wall-index.js";
import { releaseProjectile } from "../combat/projectile-cap.js";
import { getProceduralWindow } from "./procgen-window.js";

// Removes walls, structures, entities, projectiles, spawn points, and
// generated-column markers that have moved outside the active render window.
export function cleanupProceduralGeneration(playerX) {
	const {
		generationStartX: startX,
		generationEndX: endX,
		cleanupStartX: safeStartX,
		cleanupEndX: safeEndX,
	} = getProceduralWindow(playerX);

	const retainedStructures = GameState.placedStructures.filter(
		(s) => s.origin.x >= safeStartX && s.origin.x <= safeEndX,
	);
	const retainedStructureOrigins = new Set(
		retainedStructures.map((structure) => structure.origin.x),
	);

	const retainedWalls = GameState.walls.filter((wall) => {
		if (Number.isFinite(wall.structureOriginX)) {
			return retainedStructureOrigins.has(wall.structureOriginX);
		}
		return wall.x >= safeStartX && wall.x <= safeEndX;
	});
	if (retainedWalls.length !== GameState.walls.length) {
		GameState.walls = retainedWalls;
		markWallIndexDirty();
		markEnvironmentChanged();
	}

	GameState.placedStructures = retainedStructures;

	// Despawn enemies once their full hitbox is outside the active render window.
	// Using the enemy's right edge on the back boundary prevents a partially
	// visible enemy from disappearing as soon as its left edge leaves the window.
	GameState.enemies = GameState.enemies.filter(
		(e) => e.x + e.size >= safeStartX && e.x <= safeEndX,
	);

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
		if (Number.isFinite(spawn.structureOriginX)) {
			return retainedStructureOrigins.has(spawn.structureOriginX);
		}
		return spawn.x >= startX;
	});
	if (retainedEnemySpawns.length !== GameState.enemySpawns.length) {
		GameState.enemySpawns = retainedEnemySpawns;
		markEnvironmentChanged();
	}

	const unloadedColumns = Array.from(GameState.generatedColumns).filter(
		(col) => col < startX || col > endX,
	);

	unloadedColumns.forEach((col) => GameState.generatedColumns.delete(col));
}
