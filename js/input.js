// Keyboard/mouse input, hotkey action dispatch, aiming, and level/UI controls.

import { Config } from "./config.js";
import {
	GameState,
	player,
	camera,
	markEnvironmentChanged,
	resetEntityIds,
} from "./state.js";
import { markWallIndexDirty } from "./spatial/wall-index.js";
import { canvas, debugUI, respawnBtn } from "./dom.js";
import { readLaunchOptions } from "./launch-options.js";
import { resolveLevelRuntimeSettings } from "./level.js";
import { prepareLevelForGameMode } from "./game-modes.js";
import {
	getMinimumStructureOriginXExclusive,
	getProceduralPlayerSpawn,
} from "./procgen.js";
import {
	normalizeVariationLuckUpgrade,
	requestLaserShot,
	shoot,
} from "./combat.js";
import { clampProjectileCount, resetProjectileCaps } from "./combat/projectile-cap.js";
import {
	getActionsForInput,
	isActionDown,
	keyboardEventToInputCode,
	mouseEventToInputCode,
} from "./hotkeys.js";
import {
	getActiveWeaponIndex,
	getActiveWeaponStats,
	selectWeapon,
} from "./weapons.js";
import { isReplayPlaybackActive } from "./replay.js";

const UI_MODES = ["none", "debug"];

let keyboardLockPending = false;
let keyboardLockDesired = false;

function isExpectedKeyboardLockError(error) {
	return [
		"AbortError",
		"InvalidStateError",
		"NotAllowedError",
		"SecurityError",
	].includes(error?.name);
}

// A hidden runtime UI is the game's distraction-free input mode. Request all
// physical keys so modifier combinations such as Ctrl+W are delivered to the
// game where handleKeyDown() can cancel their browser defaults. The request is
// retried from later key/mouse gestures when startup lacks user activation.
async function syncKeyboardLockToUIMode() {
	keyboardLockDesired = GameState.uiMode === "none";

	const keyboard = navigator.keyboard;
	if (!keyboard) return;

	if (!keyboardLockDesired) {
		keyboard.unlock?.();
		return;
	}

	if (keyboardLockPending || typeof keyboard.lock !== "function") return;

	keyboardLockPending = true;

	try {
		await keyboard.lock();
	} catch (error) {
		if (!isExpectedKeyboardLockError(error)) {
			console.warn("Could not lock keyboard input.", error);
		}
	} finally {
		keyboardLockPending = false;

		// The UI may have become visible while lock() was still pending.
		if (!keyboardLockDesired || GameState.uiMode !== "none") {
			keyboard.unlock?.();
		}
	}
}

// Applies the in-game overlay mode. Configuration now lives on menu.html, so
// the game only cycles between a clean view and runtime/debug information.
export function setUIMode(mode) {
	const normalizedMode = UI_MODES.includes(mode) ? mode : "none";
	GameState.uiMode = normalizedMode;

	const showDebugUI = normalizedMode === "debug";
	debugUI.hidden = !showDebugUI;
	GameState.showEditorHelpers = showDebugUI;
	void syncKeyboardLockToUIMode();
}

// Cycles none -> debug -> none.
export function toggleUI() {
	const currentIndex = UI_MODES.indexOf(GameState.uiMode);
	const nextIndex = (currentIndex + 1 + UI_MODES.length) % UI_MODES.length;
	setUIMode(UI_MODES[nextIndex]);
}

let activeLevelDefinition = null;

function cloneLevelDefinition(level) {
	return JSON.parse(JSON.stringify(level));
}

function readEnemySpawnRate(value, fallback) {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) && numericValue >= 0
		? numericValue
		: fallback;
}

// Procedural runs become denser according to furthest forward progress. Keeping
// a high-water mark prevents retreating from reducing the current difficulty.
export function updateProgressiveEnemySpawnRate(playerX = player.x) {
	if (!GameState.enemySpawnRateProgressionEnabled) {
		return GameState.enemySpawnRate;
	}

	const forwardProgress = Math.max(
		0,
		(Number(playerX) || 0) - GameState.enemySpawnProgressOriginX,
	);
	GameState.enemySpawnProgressBlocks = Math.max(
		GameState.enemySpawnProgressBlocks,
		forwardProgress,
	);

	const completedIntervals = Math.floor(
		(GameState.enemySpawnProgressBlocks + 1e-9) /
			GameState.enemySpawnRateIncreaseIntervalBlocks,
	);
	GameState.enemySpawnRate =
		GameState.enemySpawnBaseRate +
		completedIntervals * GameState.enemySpawnRateIncreasePerInterval;
	return GameState.enemySpawnRate;
}

// Resets runtime entities/procedural state and loads either a seeded procedural
// level or explicit walls/spawns. The main menu supplies the initial definition;
// respawns reuse the same active definition without depending on game-page DOM.
export function loadLevel(levelDefinition = null) {
	try {
		if (levelDefinition !== null) {
			activeLevelDefinition = cloneLevelDefinition(levelDefinition);
		}

		if (activeLevelDefinition === null) {
			activeLevelDefinition = cloneLevelDefinition(readLaunchOptions().level);
		}

		const data = cloneLevelDefinition(activeLevelDefinition);
		const runtimeSettings = resolveLevelRuntimeSettings(data, Config);

		const playerDefinition = data.player || {
			spawn: data.playerSpawn,
		};
		const proceduralLevel = data.seed !== undefined;
		if (proceduralLevel) {
			GameState.levelSeed = data.seed;
			GameState.currentSeed = data.seed;
		}

		const playerSpawn = proceduralLevel
			? getProceduralPlayerSpawn(runtimeSettings, player.size)
			: playerDefinition.spawn;
		if (playerSpawn) {
			player.x = playerSpawn.x;
			player.y = playerSpawn.y;
			player.hp = player.maxHp;
			player.vx = 0;
			player.vy = 0;
		}
		player.maximumProjectileCount = clampProjectileCount(
			playerDefinition.maximumProjectileCount,
			"level.player.maximumProjectileCount",
		);
		player.upgrades.variationLuck = normalizeVariationLuckUpgrade(
			playerDefinition.upgrades?.variationLuck,
		);

		GameState.projectiles.length = 0;
		GameState.explosions.length = 0;
		GameState.laserWarmups.length = 0;
		GameState.laserBeams.length = 0;
		GameState.weaponCooldownUntilByWeapon.length = 0;
		resetProjectileCaps();
		GameState.enemies.length = 0;
		resetEntityIds();
		GameState.walls.length = 0;
		GameState.enemySpawns.length = 0;
		GameState.generatedColumns.clear();
		GameState.placedStructures.length = 0;
		GameState.lastSpawnTime = performance.now();
		GameState.isPlayerDead = false;

		const configuredSpawnRate = readEnemySpawnRate(
			data.enemySpawnRate,
			proceduralLevel ? 0.5 : 0,
		);

		GameState.enemySpawnBaseRate = configuredSpawnRate;
		GameState.enemySpawnRate = configuredSpawnRate;
		GameState.enemySpawnProgressOriginX = player.x;
		GameState.enemySpawnProgressBlocks = 0;
		GameState.enemySpawnRateProgressionEnabled = proceduralLevel;
		GameState.enemySpawnRateIncreasePerInterval =
			runtimeSettings.enemySpawnRateIncreasePerInterval;
		GameState.enemySpawnRateIncreaseIntervalBlocks =
			runtimeSettings.enemySpawnRateIncreaseIntervalBlocks;
		GameState.minimumEnemySpawnDistanceBlocks =
			runtimeSettings.minimumEnemySpawnDistanceBlocks;
		GameState.maximumEnemySpawnDistanceBlocks =
			runtimeSettings.maximumEnemySpawnDistanceBlocks;
		GameState.corridorCeilingYBlocks = runtimeSettings.corridorCeilingYBlocks;
		GameState.corridorWidthBlocks = runtimeSettings.corridorWidthBlocks;
		GameState.structureSpawnChance = runtimeSettings.structureSpawnChance;
		GameState.structureDensityBlocks = runtimeSettings.structureDensityBlocks;
		GameState.minimumStructureOriginXExclusive =
			getMinimumStructureOriginXExclusive(Config.STRUCTURE_LIBRARY);
		GameState.isInvincible = runtimeSettings.invincibility;

		if (!proceduralLevel) {
			GameState.walls = data.walls || [];
			GameState.enemySpawns = data.enemySpawns || [];
		}

		markWallIndexDirty();
		markEnvironmentChanged();
		window.focus();
	} catch (error) {
		console.error("Could not load level definition:", error);
		alert("Could not load the selected level. Return to the main menu and check Level Setup.");
	}
}

// Starts another run after death. Endless receives a fresh procedural seed;
// other modes continue to reload their configured level unchanged.
export function respawnGame() {
	if (isReplayPlaybackActive() || player.hp > 0) return;

	GameState.pressedInputs.clear();
	GameState.MaxDistance = -1;
	const nextLevelDefinition = prepareLevelForGameMode(
		GameState.gameModeId,
		activeLevelDefinition,
		{
			newRun: true,
			previousSeed: GameState.levelSeed,
		},
	);
	loadLevel(nextLevelDefinition);
}

function isEditableTarget(target) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target?.isContentEditable
	);
}

export function refreshAimFromMousePosition() {
	if (
		!Number.isFinite(GameState.mouseClientX) ||
		!Number.isFinite(GameState.mouseClientY)
	) {
		return false;
	}

	const rect = canvas.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return false;

	const renderZoom = Math.max(0.01, Number(Config.RENDERING.ZOOM) || 1);
	const renderedBlockSizePx = Config.RENDERING.BLOCK_SIZE_PX * renderZoom;

	GameState.aimWorldX =
		((GameState.mouseClientX - rect.left) * (canvas.width / rect.width)) /
			renderedBlockSizePx +
		camera.x;

	GameState.aimWorldY =
		((GameState.mouseClientY - rect.top) * (canvas.height / rect.height)) /
			renderedBlockSizePx +
		camera.y;

	return true;
}

function updateAimFromMouseEvent(event) {
	GameState.mouseClientX = event.clientX;
	GameState.mouseClientY = event.clientY;
	refreshAimFromMousePosition();
}

export function fireActiveWeapon(currentTime = performance.now()) {
	if (isReplayPlaybackActive() || GameState.isPlayerDead || player.hp <= 0) {
		return false;
	}

	const now = Number.isFinite(currentTime) ? currentTime : performance.now();
	// Recalculate world aim from the last known screen-space mouse position every
	// firing attempt. This keeps keyboard/autofire aim correct while the camera
	// moves even when no mouse event fires.
	refreshAimFromMousePosition();
	const stats = getActiveWeaponStats();
	const weaponIndex = getActiveWeaponIndex();

	if (stats.laser === true) {
		return requestLaserShot(
			player,
			GameState.aimWorldX,
			GameState.aimWorldY,
			stats,
			weaponIndex,
			now,
		);
	}

	const cooldownUntil = GameState.weaponCooldownUntilByWeapon[weaponIndex] || 0;
	if (now < cooldownUntil) return false;

	shoot(
		player,
		GameState.aimWorldX,
		GameState.aimWorldY,
		stats,
	);

	GameState.weaponCooldownUntilByWeapon[weaponIndex] =
		now + Math.max(0, Number(stats.cooldownMs ?? 0) || 0);

	return true;
}

// Continuous-fire action. Unlike the one-shot Shoot action, Auto Fire is
// evaluated every simulation frame while any of its bindings are held. The
// per-weapon cooldown gate in fireActiveWeapon() determines whether that frame
// actually produces a shot.
export function processAutofire(currentTime = performance.now()) {
	if (!isActionDown("autofire", GameState.pressedInputs)) return false;
	return fireActiveWeapon(currentTime);
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
	if (isReplayPlaybackActive()) {
		if (actions.includes("toggleUI")) toggleUI();
		return;
	}

	actions.forEach((actionId) => selectWeaponFromAction(actionId));

	if (actions.includes("respawn")) respawnGame();
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

	if (GameState.uiMode === "none" && event.cancelable) {
		event.preventDefault();
	}

	void syncKeyboardLockToUIMode();
}

function handleKeyUp(event) {
	releaseInput(keyboardEventToInputCode(event));
}

function handleMouseDown(event) {
	updateAimFromMouseEvent(event);
	pressInput(mouseEventToInputCode(event), event);
	void syncKeyboardLockToUIMode();
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

	setUIMode(GameState.uiMode);

	// Runtime debug controls (replay/menu links) must not also trigger mouse bindings.
	debugUI.addEventListener("mousedown", (event) => event.stopPropagation());
	debugUI.addEventListener("mouseup", (event) => event.stopPropagation());

	respawnBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		respawnGame();
	});
	respawnBtn.addEventListener("mousedown", (event) => event.stopPropagation());
	respawnBtn.addEventListener("mouseup", (event) => event.stopPropagation());

}
