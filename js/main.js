// Entry point: update loop, initialization, and config export.

import { Config, loadLocalConfig } from "./config.js";
import { GameState, player, camera } from "./state.js";
import { handleWallCollisions } from "./utils.js";
import {
	updateProceduralGeneration,
	cleanupProceduralGeneration,
} from "./procgen.js";
import {
	updateEnemies,
	resolveEnemyVectorCollisions,
	processBullets,
} from "./combat.js";
import { initInput, loadLevel } from "./input.js";
import { draw } from "./render.js";

// Runs one simulation step: procedural generation, player movement, enemy AI/movement, camera tracking, and projectile processing.
export function update(currentTime, dt) {
	if (player.hp <= 0) return;

	updateProceduralGeneration(player.x);
	cleanupProceduralGeneration(player.x);

	let dx = 0;
	let dy = 0;

	// this can be stored in a keybinds.json similar to config, that way players can change keybinds
	// shouldnt be too hard to do, and then it will also be easier to add mobile functionality and weapons i think - cyn
	if (GameState.keys.w) {
		dy -= player.speed * dt;
	}

	if (GameState.keys.s) {
		dy += player.speed * dt;
	}

	if (GameState.keys.a) {
		dx -= player.speed * dt;
	}

	if (GameState.keys.d) {
		dx += player.speed * dt;
	}

	handleWallCollisions(player, dx, dy);

	updateEnemies(currentTime, dt);

	resolveEnemyVectorCollisions(dt);

	// enemies move in updateEnemies so it might be better to move everything into there to avoid looping over them twice
	GameState.enemies = GameState.enemies.filter((e) => {
		if (e.hp <= 0) return false;

		handleWallCollisions(e, e.moveX, e.moveY);

		return true;
	});

	camera.x = player.x - camera.widthBlocks / 2 + player.size / 2;

	camera.y = player.y - camera.heightBlocks / 2 + player.size / 2;

	processBullets(GameState.bullets, true, currentTime, dt);

	processBullets(GameState.enemyBullets, false, currentTime, dt);
}

let lastFrameTime = null;
// Caps the simulation timestep at 50 ms so stalls or tab switches cannot create a huge physics step
export const MAX_DT_SECONDS = 0.05;

// requestAnimationFrame loop that calculates frame delta time, updates the simulation, renders a frame, and schedules the next frame.
export function gameLoop(currentTime) {
	let dt = 0;

	if (lastFrameTime !== null) {
		dt = (currentTime - lastFrameTime) / 1000;

		dt = Math.min(Math.max(dt, 0), MAX_DT_SECONDS);
	}

	lastFrameTime = currentTime;

	if (dt > 0) {
		update(currentTime, dt);
	}

	draw();
	requestAnimationFrame(gameLoop);
}

// Serializes the current Config object into a downloadable custom_config.json browser download.
export function exportConfig() {
	const dataStr =
		"data:text/json;charset=utf-8," +
		encodeURIComponent(JSON.stringify(Config, null, 4));

	const a = document.createElement("a");

	a.href = dataStr;
	a.download = "custom_config.json";

	document.body.appendChild(a);
	a.click();
	a.remove();
}

// Fetches factory config.json, applies local overrides/migration, synchronizes player config, loads the level, and starts the animation loop.
export async function initGame() {
	try {
		const response = await fetch("config.json");

		if (!response.ok) {
			throw new Error("Network response was not ok");
		}

		const defaultConfig = await response.json();

		const loadedData = loadLocalConfig(defaultConfig);

		Object.assign(Config, loadedData);

		player.speed = Config.PLAYER_SPEED;
		player.size = Config.PLAYER_SIZE_BLOCKS;

		loadLevel();
		requestAnimationFrame(gameLoop);

		console.log("Config loaded successfully. Game starting...");
	} catch (error) {
		console.error("Failed to load config.json:", error);

		alert("Could not load game configuration! Check console for details.");
	}
}

initInput();
initGame();

// Preserve the original global API used by the config/editor UI.
window.Config = Config;
window.player = player;

if (window.syncConfigToUI) {
	window.syncConfigToUI();
}
