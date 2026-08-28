// Entry point: update loop, initialization, config/hotkey loading, and config export.

import {
	Config,
	loadLocalConfig,
	validateCompleteConfig,
} from "./config.js";
import {
	getCombatDefault,
	loadCombatDefaults,
} from "./combat/defaults.js";
import { validateBaseProjectile } from "./combat/projectile-schema.js";
import { readLaunchOptions, writeLaunchOptions } from "./launch-options.js";
import { loadDefaultLevelDefinition } from "./level.js";
import {
	configureGameModeRuntime,
	getGameMode,
	prepareLevelForGameMode,
	resolveGameModeId,
} from "./game-modes.js";
import {
	GameState,
	player,
	camera,
	getRegisteredEntities,
} from "./state.js";
import { handleWallCollisions } from "./utils.js";
import {
	updateProceduralGeneration,
	cleanupProceduralGeneration,
} from "./procgen.js";
import {
	updateEnemies,
	resolveEnemyVectorCollisions,
	processProjectiles,
	processExplosions,
	processLasers,
	resetLaserCalculationBudget,
	getLaserCalculationBudgetOverrun,
	getLaserCalculationBudgetSpent,
	resolveProjectileVectorCollisions,
} from "./combat.js";
import {
	initInput,
	loadLevel,
	processAutofire,
	updateProgressiveEnemySpawnRate,
} from "./input.js";
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
import {
	beginProfileFrame,
	beginProfileSection,
	endProfileFrame,
	endProfileSection,
	setProfileCounter,
} from "./performance/profiler.js";
import {
	SimulationClock,
	createRenderPacer,
} from "./runtime/simulation-clock.js";
import { rebuildActorIndex } from "./spatial/entity-index.js";

// Runs one simulation step: procedural generation, player movement, enemy AI/movement, camera tracking, and projectile processing.
export function update(currentTime, dt) {
	resetLaserCalculationBudget();
	GameState.projectileTrailEvents.length = 0;

	if (player.hp <= 0) {
		GameState.isPlayerDead = true;
		return;
		// then add functionality for other stuff like resetting here
	}

	const proceduralProfile = beginProfileSection();
	if (GameState.isProceduralLevel) {
		updateProceduralGeneration(player.x);
		cleanupProceduralGeneration(player.x);
	}
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
	rebuildActorIndex(getRegisteredEntities());
	updateEnemies(currentTime, dt);
	resolveEnemyVectorCollisions(dt);
	rebuildActorIndex(getRegisteredEntities());
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
	setProfileCounter("laser-budget-overrun", getLaserCalculationBudgetOverrun());
	setProfileCounter("laser-budget-spent", getLaserCalculationBudgetSpent());
	endProfileSection("lasers", laserProfile);
	const explosionProfile = beginProfileSection();
	processExplosions(currentTime);
	endProfileSection("explosions", explosionProfile);

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
	canvas.style.setProperty(
		"--game-aspect-ratio",
		String(canvasWidthPx / canvasHeightPx),
	);
	camera.widthBlocks = canvasWidthPx / renderedBlockSizePx;
	camera.heightBlocks = canvasHeightPx / renderedBlockSizePx;
}

const simulationClock = new SimulationClock({ hz: 60 });
const renderPacer = createRenderPacer();
let lastRenderWallTime = null;
let lastVisualSnapshot = null;
const PERFORMANCE_UPDATE_INTERVAL_MS = 500;

const PerformanceStats = {
	windowStartedAt: null,
	tickDurationTotalMs: 0,
	tickDurationSamples: 0,
};

function setDebugStatVisibility(element, visible) {
	if (element) element.hidden = !visible;
}

export function getTargetFps() {
	return Math.max(
		1,
		Math.round(Number(Config.RENDERING?.TARGET_FPS ?? 60) || 60),
	);
}

function updatePerformanceUi(currentTime, tickDurationMs, targetFps) {
	const debug = Config.DEBUG || {};
	const showFps = debug.SHOW_FPS !== false;
	const showTargetFps = debug.SHOW_TARGET_FPS !== false;
	const showMsPerTick = debug.SHOW_MS_PER_TICK !== false;
	const showEntityCount = debug.SHOW_ENTITY_COUNT !== false;
	const showEnemyCount = debug.SHOW_ENEMY_COUNT !== false;
	const showBulletCount = debug.SHOW_BULLET_COUNT !== false;

	setDebugStatVisibility(performanceFps, showFps);
	setDebugStatVisibility(performanceTargetFps, showTargetFps);
	setDebugStatVisibility(performanceMsPerTick, showMsPerTick);
	setDebugStatVisibility(performanceEntityCount, showEntityCount);
	setDebugStatVisibility(performanceEnemyCount, showEnemyCount);
	setDebugStatVisibility(performanceBulletCount, showBulletCount);

	if (PerformanceStats.windowStartedAt === null) {
		PerformanceStats.windowStartedAt = currentTime;
	}

	if (
		(showFps || showMsPerTick) &&
		Number.isFinite(tickDurationMs) &&
		tickDurationMs > 0
	) {
		PerformanceStats.tickDurationTotalMs += tickDurationMs;
		PerformanceStats.tickDurationSamples += 1;
	}

	if (showTargetFps && performanceTargetFps) {
		performanceTargetFps.textContent = `Target FPS: ${targetFps}`;
	}

	if (showEntityCount || showEnemyCount || showBulletCount) {
		const enemyCount = GameState.enemies.length;
		let playerBulletCount = 0;
		let enemyBulletCount = 0;
		for (const projectile of GameState.projectiles) {
			if (projectile.team === player.team) playerBulletCount++;
			else enemyBulletCount++;
		}
		const bulletCount = GameState.projectiles.length;

		if (showEntityCount && performanceEntityCount) {
			performanceEntityCount.textContent =
				`Entities: ${enemyCount + bulletCount}`;
		}
		if (showEnemyCount && performanceEnemyCount) {
			performanceEnemyCount.textContent = `Enemies: ${enemyCount}`;
		}
		if (showBulletCount && performanceBulletCount) {
			performanceBulletCount.textContent =
				`Bullets: ${bulletCount} (Player: ${playerBulletCount} / Enemy: ${enemyBulletCount})`;
		}
	}

	if (!showFps && !showMsPerTick) {
		PerformanceStats.windowStartedAt = currentTime;
		PerformanceStats.tickDurationTotalMs = 0;
		PerformanceStats.tickDurationSamples = 0;
		return;
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

	if (showFps && performanceFps) {
		performanceFps.textContent = `FPS: ${measuredFps.toFixed(1)}`;
	}
	if (showMsPerTick && performanceMsPerTick) {
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
	const step = simulationClock.consumeWallTime(currentTime);
	const shouldRender = renderPacer.consume(currentTime, targetFps);
	if (!step && !shouldRender) return;
	beginProfileFrame(currentTime);

	if (step) {
		GameState.simulationTimeMs = step.timeMs;
		GameState.simulationTick = step.tick;
		const updateProfile = beginProfileSection();
		update(step.timeMs, step.dtSeconds);
		endProfileSection("update-total", updateProfile);

		const snapshotProfile = beginProfileSection();
		lastVisualSnapshot = captureVisualSnapshot(step.timeMs);
		pushTrailSnapshot(lastVisualSnapshot);
		recordReplaySnapshot(lastVisualSnapshot, step.timeMs);
		endProfileSection("snapshot-replay", snapshotProfile);
	}
	setProfileCounter("enemies", GameState.enemies.length);
	setProfileCounter("projectiles", GameState.projectiles.length);
	setProfileCounter("walls", GameState.walls.length);
	const clockMetrics = simulationClock.getMetrics();
	setProfileCounter("simulation-tick", clockMetrics.tick);
	setProfileCounter(
		"discarded-wall-time-ms",
		clockMetrics.discardedWallTimeMs,
	);
	setProfileCounter("delayed-scheduler-callbacks", clockMetrics.delayedCallbacks);
	if (shouldRender) {
		const renderElapsed = lastRenderWallTime === null
			? 1000 / targetFps
			: Math.max(0, currentTime - lastRenderWallTime);
		lastRenderWallTime = currentTime;
		updatePerformanceUi(currentTime, renderElapsed, targetFps);
		lastVisualSnapshot ??= captureVisualSnapshot(GameState.simulationTimeMs);
		const renderProfile = beginProfileSection();
		draw(lastVisualSnapshot, getLiveTrailEntries(), {
			quadTrailEntries: getLiveTrailEntries(getTrailQuadDetail(), false),
		});
		endProfileSection("render", renderProfile);
	}
	endProfileFrame();
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
		validateBaseProjectile(defaultConfig.BASE_PROJECTILE);
		validateCompleteConfig(defaultConfig, defaultConfig);

		const defaultLevel = await loadDefaultLevelDefinition();
		let launchOptions = readLaunchOptions();
		if (!launchOptions.level) {
			launchOptions.level = defaultLevel;
			launchOptions = writeLaunchOptions(launchOptions);
		}

		const gameModeId = resolveGameModeId(
			window.location.search,
			launchOptions.gameModeId,
		);
		const gameMode = getGameMode(gameModeId);
		await loadCombatDefaults({
			allowLocal: gameMode.allowsEditedDefaults,
		});
		simulationClock.setRate(getCombatDefault("SIMULATION_HZ"));
		const loadedData = gameMode.allowsEditedConfig
			? loadLocalConfig(defaultConfig)
			: defaultConfig;

		Object.assign(Config, loadedData);
		Config.RENDERING = {
			...(Config.RENDERING || {}),
			TARGET_FPS: getTargetFps(),
		};
		const sourceLevel = gameMode.allowsEditedLevel
			? launchOptions.level
			: defaultLevel;
		const levelDefinition = prepareLevelForGameMode(
			gameModeId,
			sourceLevel,
			{ newRun: true },
		);

		GameState.gameModeId = gameModeId;
		GameState.configSource = gameMode.allowsEditedConfig ? "session" : "factory";
		GameState.levelSource = gameMode.allowsEditedLevel ? "session" : "factory";
		GameState.defaultsSource = gameMode.allowsEditedDefaults
			? "session"
			: "factory";
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
		simulationClock.reset({ startTimeMs: 0 });
		GameState.simulationTimeMs = 0;
		GameState.simulationTick = 0;
		renderPacer.reset();
		requestAnimationFrame(gameLoop);

		console.log(
			`Game starting in ${gameModeId} mode using ${
				gameMode.allowsEditedConfig ? "sandbox-edited config" : "factory config.json"
			}.`,
		);
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
