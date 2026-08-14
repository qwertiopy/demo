// Keyboard/mouse input and level/UI controls through event listeners

import { Config } from "./config.js";
import { GameState, player, camera } from "./state.js";
import {
	canvas,
	editorUI,
	hideUIBtn,
	levelDataInput,
	loadLevelBtn,
	godModeToggle,
} from "./dom.js";
import { shoot } from "./combat.js";

// Shows or hides the editor/debug UI and updates the matching GameState flag.
export function toggleUI() {
	GameState.showEditorHelpers = !GameState.showEditorHelpers;

	editorUI.style.display = GameState.showEditorHelpers ? "block" : "none";
}

// Parses level JSON, resets runtime entities and procedural state, then loads either a seeded procedural level or explicit walls/spawns
// might be better to move this out of the input.js file
export function loadLevel() {
	try {
		const data = JSON.parse(levelDataInput.value);

		if (data.playerSpawn) {
			player.x = data.playerSpawn.x;
			player.y = data.playerSpawn.y;
			player.hp = player.maxHp;
		}

		GameState.bullets.length = 0;
		GameState.enemyBullets.length = 0;
		GameState.enemies.length = 0;
		GameState.walls.length = 0;
		GameState.enemySpawns.length = 0;
		GameState.generatedColumns.clear();
		GameState.placedStructures.length = 0;
		GameState.lastSpawnTime = performance.now();

		if (data.seed !== undefined) {
			GameState.levelSeed = data.seed;
			GameState.currentSeed = data.seed;
			GameState.enemySpawnRate = data.enemySpawnRate || 0.5;
		} else {
			GameState.walls = data.walls || [];
			GameState.enemySpawns = data.enemySpawns || [];
			GameState.enemySpawnRate = data.enemySpawnRate || 0;
		}

		window.focus();
	} catch (error) {
		alert("Invalid JSON format. Please check your syntax.");
	}
}

// Records WASD key presses in GameState and maps H to the editor/debug UI toggle.
function handleKeyDown(e) {
	const key = e.key.toLowerCase();

	if (Object.prototype.hasOwnProperty.call(GameState.keys, key)) {
		GameState.keys[key] = true;
	}

	if (key === "h") toggleUI();
}

// Clears WASD key flags when keys are released.
function handleKeyUp(e) {
	const key = e.key.toLowerCase();

	if (Object.prototype.hasOwnProperty.call(GameState.keys, key)) {
		GameState.keys[key] = false;
	}
}

// Converts a mouse position from canvas pixels to world coordinates and fires a player bullet when the cooldown allows.
function handleMouseDown(e) {
	e.preventDefault();

	const now = performance.now();
	if (now - GameState.playerLastShot < Config.PLAYER_SHOOT_COOLDOWN) {
		return;
	}

	GameState.playerLastShot = now;

	const rect = canvas.getBoundingClientRect();

	const worldTargetX =
		((e.clientX - rect.left) * (canvas.width / rect.width)) /
			Config.BLOCK_SIZE_PX +
		camera.x;

	const worldTargetY =
		((e.clientY - rect.top) * (canvas.height / rect.height)) /
			Config.BLOCK_SIZE_PX +
		camera.y;

	shoot(player, worldTargetX, worldTargetY, GameState.bullets, {
		color: "crimson",
		speed: Config.PLAYER_BULLET_SPEED,
		radiusBlocks: 0.08,
		maxBounces: 1,
	});
}

// Installs all keyboard, mouse, UI-button, level-loading, and optional god-mode listeners.
export function initInput() {
	window.addEventListener("keydown", handleKeyDown);

	window.addEventListener("keyup", handleKeyUp);

	window.addEventListener("mousedown", handleMouseDown);

	window.addEventListener("contextmenu", (e) => e.preventDefault());

	editorUI.addEventListener("mousedown", (e) => e.stopPropagation());

	hideUIBtn.addEventListener("click", toggleUI);

	loadLevelBtn.addEventListener("click", loadLevel);

	if (godModeToggle) {
		godModeToggle.addEventListener("change", (e) => {
			GameState.isInvincible = e.target.checked;
		});
	}
}
