// Game startup, config/mode loading, viewport setup, and runtime wiring.

import { Config, loadLocalConfig } from "../config.js";
import { loadCombatDefaults } from "../combat/defaults.js";
import { validateBaseProjectile } from "../combat/projectile-schema.js";
import { readLaunchOptions, writeLaunchOptions } from "../launch-options.js";
import { loadDefaultLevelDefinition } from "../level.js";
import {
	configureGameModeRuntime,
	getGameMode,
	prepareLevelForGameMode,
	resolveGameModeId,
} from "../game-modes.js";
import { GameState, player, camera } from "../state.js";
import { initInput, loadLevel } from "../input.js";
import { loadHotkeys } from "../hotkeys.js";
import { canvas } from "../dom.js";
import { initReplayControls } from "../replay.js";
import { gameLoop, getTargetFps } from "./game-loop.js";

// Applies intrinsic render resolution and derives the camera viewport from the
// centralized rendering config. At zoom 1, one block uses BLOCK_SIZE_PX true
// internal canvas pixels.
export function syncCameraViewport() {
	const rendering = Config.RENDERING;
	const canvasWidthPx = Math.max(
		1,
		Math.round(Number(rendering.CANVAS_WIDTH_PX) || 1920),
	);
	const canvasHeightPx = Math.max(
		1,
		Math.round(Number(rendering.CANVAS_HEIGHT_PX) || 1080),
	);
	const blockSizePx = Math.max(1, Number(rendering.BLOCK_SIZE_PX) || 64);
	const renderZoom = Math.max(0.01, Number(rendering.ZOOM) || 1);
	const renderedBlockSizePx = blockSizePx * renderZoom;

	canvas.width = canvasWidthPx;
	canvas.height = canvasHeightPx;
	camera.widthBlocks = canvasWidthPx / renderedBlockSizePx;
	camera.heightBlocks = canvasHeightPx / renderedBlockSizePx;
}

// Loads factory config + local overrides, loads hotkeys + local overrides, then
// installs input and starts the game.
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
