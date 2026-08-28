// Runtime simulation orchestration. Keep gameplay update ordering explicit here;
// subsystem implementations remain owned by their existing modules.

import { GameState, player, camera } from "../state.js";
import { handleWallCollisions } from "../utils.js";
import {
	updateProceduralGeneration,
	cleanupProceduralGeneration,
} from "../procgen.js";
import {
	updateEnemies,
	resolveEnemyVectorCollisions,
	processProjectiles,
	processExplosions,
	processLasers,
	resetLaserCalculationBudget,
	resolveProjectileVectorCollisions,
} from "../combat.js";
import {
	processAutofire,
	updateProgressiveEnemySpawnRate,
} from "../input.js";
import { isActionDown } from "../hotkeys.js";
import {
	beginProfileSection,
	endProfileSection,
} from "../performance/profiler.js";

// Runs one simulation step: procedural generation, player movement, enemy
// AI/movement, camera tracking, weapon firing, and combat resolution.
export function updateGame(currentTime, dt) {
	resetLaserCalculationBudget();
	GameState.projectileTrailEvents.length = 0;

	if (player.hp <= 0) {
		GameState.isPlayerDead = true;
		return;
		// then add functionality for other stuff like resetting here
	}

	const proceduralProfile = beginProfileSection();
	updateProceduralGeneration(player.x);
	cleanupProceduralGeneration(player.x);
	endProfileSection("procedural", proceduralProfile);

	let dx = 0;
	let dy = 0;

	// Any pending player laser warmup locks movement until that shot resolves.
	// This applies to both single-beam (sniper) lasers and cone lasers.
	const laserWarmupActive = GameState.laserWarmups.some(
		(shot) => shot.shooter === player,
	);

	if (!laserWarmupActive) {
		if (isActionDown("moveUp", GameState.pressedInputs)) {
			dy -= player.speed * dt;
		}

		if (isActionDown("moveDown", GameState.pressedInputs)) {
			dy += player.speed * dt;
		}

		if (isActionDown("moveLeft", GameState.pressedInputs)) {
			dx -= player.speed * dt;
		}

		if (isActionDown("moveRight", GameState.pressedInputs)) {
			dx += player.speed * dt;
		}
	}

	const playerStartX = player.x;
	const playerStartY = player.y;
	handleWallCollisions(player, dx, dy);

	// Enemy prediction uses actual resolved player velocity, not requested input.
	// This matters when a wall blocks one component of movement.
	if (dt > 0) {
		player.vx = (player.x - playerStartX) / dt;
		player.vy = (player.y - playerStartY) / dt;
	} else {
		player.vx = 0;
		player.vy = 0;
	}

	const enemyProfile = beginProfileSection();
	updateProgressiveEnemySpawnRate(player.x);
	updateEnemies(currentTime, dt);
	resolveEnemyVectorCollisions(dt);
	endProfileSection("enemies", enemyProfile);

	camera.x = player.x - camera.widthBlocks / 2 + player.size / 2;
	camera.y = player.y - camera.heightBlocks / 2 + player.size / 2;

	// Fire after movement/camera tracking so a held autofire binding recalculates
	// aim against the current frame's camera position.
	const autofireProfile = beginProfileSection();
	processAutofire(currentTime);
	endProfileSection("autofire", autofireProfile);

	const projectileProfile = beginProfileSection();
	processProjectiles(currentTime, dt);
	resolveProjectileVectorCollisions();
	endProfileSection("projectiles", projectileProfile);
	const laserProfile = beginProfileSection();
	processLasers(currentTime);
	endProfileSection("lasers", laserProfile);
	const explosionProfile = beginProfileSection();
	processExplosions(currentTime);
	endProfileSection("explosions", explosionProfile);

	if (player.x > GameState.MaxDistance) {
		GameState.MaxDistance = player.x;
	}
}
