// Entry point: update loop, initialization, config/hotkey loading, and config export.

import { Config, loadLocalConfig } from "./config.js";
import { readLaunchOptions, writeLaunchOptions } from "./launch-options.js";
import { loadDefaultLevelDefinition } from "./level.js";
import {
	configureGameModeRuntime,
	prepareLevelForGameMode,
	resolveGameModeId,
} from "./game-modes.js";
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
	processLasers,
	resetLaserCalculationBudget,
	resolveProjectileVectorCollisions,
} from "./combat.js";
import { initInput, loadLevel, processAutofire } from "./input.js";
import { isActionDown, loadHotkeys } from "./hotkeys.js";
import { draw } from "./render.js";
import {
	canvas,
	performanceFps,
	performanceTargetFps,
	performanceMsPerTick,
	performanceEntityCount,
	performanceEnemyCount,
	performanceBulletCount,
} from "./dom.js";
import {
	captureVisualSnapshot,
	pushTrailSnapshot,
	getLiveTrailEntries,
	getTrailQuadDetail,
	recordReplaySnapshot,
	initReplayControls,
} from "./replay.js";

// Runs one simulation step: procedural generation, player movement, enemy AI/movement, camera tracking, and projectile processing.
export function update(currentTime, dt) {
	resetLaserCalculationBudget();
	GameState.projectileTrailEvents.length = 0;

	if (player.hp <= 0) {
		GameState.isPlayerDead = true;
		return;
		// then add functionality for other stuff like resetting here
	}

	updateProceduralGeneration(player.x);
	cleanupProceduralGeneration(player.x);

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

	handleWallCollisions(player, dx, dy);

	updateEnemies(currentTime, dt);
	resolveEnemyVectorCollisions(dt);

	camera.x = player.x - camera.widthBlocks / 2 + player.size / 2;
	camera.y = player.y - camera.heightBlocks / 2 + player.size / 2;

	// Fire after movement/camera tracking so a held autofire binding recalculates
	// aim against the current frame's camera position.
	processAutofire(currentTime);

	processBullets(GameState.bullets, true, currentTime, dt);
	processBullets(GameState.enemyBullets, false, currentTime, dt);
	resolveProjectileVectorCollisions();
	processLasers(currentTime);
	processExplosions(currentTime);

	if (player.x > GameState.MaxDistance) {
		GameState.MaxDistance = player.x;
	}
}

// Applies intrinsic render resolution and derives the camera viewport from the
// centralized rendering config. At zoom 1, one block uses BLOCK_SIZE_PX true
// internal canvas pixels.
export function syncCameraViewport() {
	const rendering = Config.RENDERING;
	const canvasWidthPx = Math.max(1, Math.round(Number(rendering.CANVAS_WIDTH_PX) || 1920));
	const canvasHeightPx = Math.max(1, Math.round(Number(rendering.CANVAS_HEIGHT_PX) || 1080));
	const blockSizePx = Math.max(1, Number(rendering.BLOCK_SIZE_PX) || 64);
	const renderZoom = Math.max(0.01, Number(rendering.ZOOM) || 1);
	const renderedBlockSizePx = blockSizePx * renderZoom;

	canvas.width = canvasWidthPx;
	canvas.height = canvasHeightPx;
	camera.widthBlocks = canvasWidthPx / renderedBlockSizePx;
	camera.heightBlocks = canvasHeightPx / renderedBlockSizePx;
}

let lastAnimationFrameTime = null;
let lastTickTime = null;
let tickAccumulatorMs = 0;

// Small tolerance prevents a nominal 60 Hz rAF interval such as 16.66 ms from
// accidentally missing a 16.67 ms target deadline and falling to ~30 FPS.
const FRAME_PACING_EPSILON_MS = 0.5;
const PERFORMANCE_UPDATE_INTERVAL_MS = 500;

const PerformanceStats = {
	windowStartedAt: null,
	tickDurationTotalMs: 0,
	tickDurationSamples: 0,
};

// Caps unexpected stalls while still allowing deliberately low target FPS
// values to use their intended timestep rather than entering slow motion.
export const MAX_DT_SECONDS = 0.05;

export function getTargetFps() {
	return Math.max(
		1,
		Math.round(Number(Config.RENDERING?.TARGET_FPS ?? 60) || 60),
	);
}

function updatePerformanceUi(currentTime, tickDurationMs, targetFps) {
	if (PerformanceStats.windowStartedAt === null) {
		PerformanceStats.windowStartedAt = currentTime;
	}

	if (Number.isFinite(tickDurationMs) && tickDurationMs > 0) {
		PerformanceStats.tickDurationTotalMs += tickDurationMs;
		PerformanceStats.tickDurationSamples += 1;
	}

	if (performanceTargetFps) {
		performanceTargetFps.textContent = `Target FPS: ${targetFps}`;
	}

	const enemyCount = GameState.enemies.length;
	const playerBulletCount = GameState.bullets.length;
	const enemyBulletCount = GameState.enemyBullets.length;
	const bulletCount = playerBulletCount + enemyBulletCount;
	const entityCount = enemyCount + bulletCount;

	if (performanceEntityCount) {
		performanceEntityCount.textContent = `Entities: ${entityCount}`;
	}
	if (performanceEnemyCount) {
		performanceEnemyCount.textContent = `Enemies: ${enemyCount}`;
	}
	if (performanceBulletCount) {
		performanceBulletCount.textContent =
			`Bullets: ${bulletCount} (Player: ${playerBulletCount} / Enemy: ${enemyBulletCount})`;
	}

	const windowMs = currentTime - PerformanceStats.windowStartedAt;
	if (windowMs < PERFORMANCE_UPDATE_INTERVAL_MS) return;

	const measuredMsPerTick =
		PerformanceStats.tickDurationSamples > 0
			? PerformanceStats.tickDurationTotalMs /
				PerformanceStats.tickDurationSamples
			: 0;
	const measuredFps =
		measuredMsPerTick > 0 ? 1000 / measuredMsPerTick : 0;

	if (performanceFps) {
		performanceFps.textContent = `FPS: ${measuredFps.toFixed(1)}`;
	}
	if (performanceMsPerTick) {
		performanceMsPerTick.textContent = `ms/tick: ${measuredMsPerTick.toFixed(2)}`;
	}

	PerformanceStats.windowStartedAt = currentTime;
	PerformanceStats.tickDurationTotalMs = 0;
	PerformanceStats.tickDurationSamples = 0;
}

// requestAnimationFrame loop with an explicit target tick/render rate. rAF is
// still used for browser scheduling, but simulation + rendering only run when
// enough target-frame time has accumulated. Actual FPS therefore cannot exceed
// the browser/display's rAF rate.
export function gameLoop(currentTime) {
	requestAnimationFrame(gameLoop);

	const targetFps = getTargetFps();
	const targetFrameMs = 1000 / targetFps;

	if (lastAnimationFrameTime === null) {
		lastAnimationFrameTime = currentTime;
		// Render immediately on startup rather than waiting one target interval.
		tickAccumulatorMs = targetFrameMs;
	} else {
		const rafElapsedMs = Math.max(0, currentTime - lastAnimationFrameTime);
		lastAnimationFrameTime = currentTime;
		tickAccumulatorMs += rafElapsedMs;
	}

	if (tickAccumulatorMs + FRAME_PACING_EPSILON_MS < targetFrameMs) {
		return;
	}

	// If we are only fractionally early because of rAF timestamp precision,
	// treat this as the target deadline. Otherwise preserve fractional overshoot
	// so 60 FPS targets schedule correctly even on 120/144 Hz displays.
	if (tickAccumulatorMs < targetFrameMs) {
		tickAccumulatorMs = targetFrameMs;
	}
	tickAccumulatorMs %= targetFrameMs;

	const tickDurationMs =
		lastTickTime === null
			? targetFrameMs
			: Math.max(0, currentTime - lastTickTime);
	lastTickTime = currentTime;
	updatePerformanceUi(currentTime, tickDurationMs, targetFps);

	const maxDtForTarget = Math.max(MAX_DT_SECONDS, targetFrameMs / 1000);
	const dt = Math.min(
		Math.max(tickDurationMs / 1000, 0),
		maxDtForTarget,
	);

	if (dt > 0) {
		update(currentTime, dt);
	}

	const snapshot = captureVisualSnapshot(currentTime);
	pushTrailSnapshot(snapshot);
	recordReplaySnapshot(snapshot, currentTime);
	draw(snapshot, getLiveTrailEntries(), {
		quadTrailEntries: getLiveTrailEntries(getTrailQuadDetail(), false),
	});
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
		Config.RENDERING = {
			...(Config.RENDERING || {}),
			TARGET_FPS: getTargetFps(),
		};

		let launchOptions = readLaunchOptions();
		if (!launchOptions.level) {
			launchOptions.level = await loadDefaultLevelDefinition();
			launchOptions = writeLaunchOptions(launchOptions);
		}

		const gameModeId = resolveGameModeId(
			window.location.search,
			launchOptions.gameModeId,
		);
		const levelDefinition = prepareLevelForGameMode(
			gameModeId,
			launchOptions.level,
		);

		GameState.gameModeId = gameModeId;
		GameState.isInvincible = launchOptions.godMode === true;
		player.speed = Config.PLAYER_SPEED;
		player.size = Config.PLAYER_SIZE_BLOCKS;
		syncCameraViewport();

		configureGameModeRuntime(gameModeId, {
			Config,
			GameState,
			player,
			camera,
			launchOptions,
		});

		await loadHotkeys();
		initInput();
		initReplayControls();
		loadLevel(levelDefinition);
		requestAnimationFrame(gameLoop);

		console.log(`Game starting in ${gameModeId} mode.`);
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
