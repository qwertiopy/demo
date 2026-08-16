// Entry point: update loop, initialization, config/hotkey loading, and config export.

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
    processExplosions,
} from "./combat.js";
import { initInput, loadLevel } from "./input.js";
import { isActionDown, loadHotkeys } from "./hotkeys.js";
import { draw } from "./render.js";

// Runs one simulation step: procedural generation, player movement, enemy AI/movement, camera tracking, and projectile processing.
export function update(currentTime, dt) {
	if (player.hp <= 0) return;

	updateProceduralGeneration(player.x);
	cleanupProceduralGeneration(player.x);

	let dx = 0;
	let dy = 0;

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

	handleWallCollisions(player, dx, dy);

	updateEnemies(currentTime, dt);
	resolveEnemyVectorCollisions(dt);

	camera.x = player.x - camera.widthBlocks / 2 + player.size / 2;
	camera.y = player.y - camera.heightBlocks / 2 + player.size / 2;

	processBullets(GameState.bullets, true, currentTime, dt);
	processBullets(GameState.enemyBullets, false, currentTime, dt);

    camera.x = player.x - camera.widthBlocks / 2 + player.size / 2;
    camera.y = player.y - camera.heightBlocks / 2 + player.size / 2;

    processBullets(GameState.bullets, true, currentTime, dt);
    processBullets(GameState.enemyBullets, false, currentTime, dt);
    processExplosions(currentTime);

    if (player.x > GameState.MaxDistance) {
        GameState.MaxDistance = player.x;
    }
}

let lastFrameTime = null;

// Caps the simulation timestep at 50 ms so stalls or tab switches cannot create a huge physics step.
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

	const anchor = document.createElement("a");
	anchor.href = dataStr;
	anchor.download = "custom_config.json";

	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
}

// Loads factory config + local overrides, loads hotkeys + local overrides, then installs input and starts the game.
export async function initGame() {
	try {
		const response = await fetch("config.json", { cache: "no-store" });

		if (!response.ok) {
			throw new Error(
				`Failed to load config.json (HTTP ${response.status}).`,
			);
		}

		const defaultConfig = await response.json();
		const loadedData = loadLocalConfig(defaultConfig);

		Object.assign(Config, loadedData);

		player.speed = Config.PLAYER_SPEED;
		player.size = Config.PLAYER_SIZE_BLOCKS;

		await loadHotkeys();
		initInput();
		loadLevel();
		requestAnimationFrame(gameLoop);

		console.log("Config and hotkeys loaded successfully. Game starting...");
	} catch (error) {
		console.error("Failed to initialize game:", error);
		alert("Could not initialize the game. Check the console for details.");
	}
}

initGame();

// Preserve the original global API used by the config/editor UI.
window.Config = Config;
window.player = player;

if (window.syncConfigToUI) {
	window.syncConfigToUI();
}
