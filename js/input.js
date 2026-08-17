// Keyboard/mouse input, hotkey action dispatch, aiming, and level/UI controls.

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
import { requestLaserShot, shoot } from "./combat.js";
import {
	getActionsForInput,
	keyboardEventToInputCode,
	mouseEventToInputCode,
} from "./hotkeys.js";
import {
	getActiveWeaponIndex,
	getActiveWeaponStats,
	selectWeapon,
} from "./weapons.js";

// Shows or hides the editor/debug UI and updates the matching GameState flag.
export function toggleUI() {
	GameState.showEditorHelpers = !GameState.showEditorHelpers;
	editorUI.style.display = GameState.showEditorHelpers ? "block" : "none";
}

// Parses level JSON, resets runtime entities and procedural state, then loads either a seeded procedural level or explicit walls/spawns.
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
		GameState.explosions.length = 0;
		GameState.laserWarmups.length = 0;
		GameState.laserBeams.length = 0;
		GameState.laserCooldownUntilByWeapon.length = 0;
		GameState.enemies.length = 0;
		GameState.walls.length = 0;
		GameState.enemySpawns.length = 0;
		GameState.generatedColumns.clear();
		GameState.placedStructures.length = 0;
		GameState.lastSpawnTime = performance.now();
		GameState.playerLastShot = 0;
		GameState.isPlayerDead = false;

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

function isEditableTarget(target) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target?.isContentEditable
	);
}

function updateAimFromMouseEvent(event) {
	const rect = canvas.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return;

	GameState.aimWorldX =
		((event.clientX - rect.left) * (canvas.width / rect.width)) /
			Config.BLOCK_SIZE_PX +
		camera.x;

	GameState.aimWorldY =
		((event.clientY - rect.top) * (canvas.height / rect.height)) /
			Config.BLOCK_SIZE_PX +
		camera.y;
}

function fireActiveWeapon() {
	const now = performance.now();

	if (now - GameState.playerLastShot < Config.PLAYER_SHOOT_COOLDOWN) {
		return;
	}

	GameState.playerLastShot = now;

	shoot(
		player,
		GameState.aimWorldX,
		GameState.aimWorldY,
		GameState.bullets,
		getActiveWeaponStats(),
	);
}

function selectWeaponFromAction(actionId) {
	const match = /^weapon(10|[1-9])$/.exec(actionId);
	if (!match) return false;

	selectWeapon(Number(match[1]) - 1);
	return true;
}

// Runs one-shot actions for a newly pressed physical input. Weapon selection is
// resolved before shooting so a deliberately double-bound select+shoot input
// fires the newly selected weapon.
function triggerPressedActions(actions) {
	actions.forEach((actionId) => selectWeaponFromAction(actionId));

	if (actions.includes("toggleUI")) toggleUI();
	if (actions.includes("shoot")) fireActiveWeapon();
}

function pressInput(inputCode, event) {
	const actions = getActionsForInput(inputCode);
	const wasPressed = GameState.pressedInputs.has(inputCode);

	GameState.pressedInputs.add(inputCode);

	if (actions.length > 0 && event?.cancelable) {
		event.preventDefault();
	}

	if (!wasPressed) {
		triggerPressedActions(actions);
	}
}

function releaseInput(inputCode) {
	GameState.pressedInputs.delete(inputCode);
}

function handleKeyDown(event) {
	if (isEditableTarget(event.target)) return;
	pressInput(keyboardEventToInputCode(event), event);
}

function handleKeyUp(event) {
	releaseInput(keyboardEventToInputCode(event));
}

function handleMouseDown(event) {
	updateAimFromMouseEvent(event);
	pressInput(mouseEventToInputCode(event), event);
}

function handleMouseUp(event) {
	releaseInput(mouseEventToInputCode(event));
}

function handleMouseMove(event) {
	updateAimFromMouseEvent(event);
}

function clearPressedInputs() {
	GameState.pressedInputs.clear();
}

// Installs all keyboard, mouse, UI-button, level-loading, and optional god-mode listeners.
export function initInput() {
	window.addEventListener("keydown", handleKeyDown);
	window.addEventListener("keyup", handleKeyUp);
	window.addEventListener("mousedown", handleMouseDown);
	window.addEventListener("mouseup", handleMouseUp);
	window.addEventListener("mousemove", handleMouseMove);
	window.addEventListener("blur", clearPressedInputs);

	canvas.addEventListener("contextmenu", (event) => event.preventDefault());

	// Clicking the debug editor should not also trigger game mouse bindings.
	editorUI.addEventListener("mousedown", (event) => event.stopPropagation());
	editorUI.addEventListener("mouseup", (event) => event.stopPropagation());

	hideUIBtn.addEventListener("click", toggleUI);
	loadLevelBtn.addEventListener("click", loadLevel);

	if (godModeToggle) {
		godModeToggle.addEventListener("change", (event) => {
			GameState.isInvincible = event.target.checked;
		});
	}
}
