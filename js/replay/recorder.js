// Replay recording lifecycle and compact frame serialization.

import { Config } from "../config.js";
import { GameState } from "../state.js";
import { REPLAY_VERSION } from "../replay-file.js";
import { saveActiveReplay } from "../replay-store.js";
import { ReplayRuntime } from "./runtime.js";
import { encodeReplayFrame } from "./codec.js";
import { ensureRecordedEnvironment } from "./environment.js";
import { setReplayStatus, syncReplayButtons } from "./ui.js";

function clonePlain(value) {
	return JSON.parse(JSON.stringify(value));
}

function replayConfigSnapshot() {
	const config = clonePlain(Config);
	delete config.DEBUG;
	return config;
}


export function startReplayRecording() {
	if (ReplayRuntime.playbackActive) {
		setReplayStatus("Stop replay playback before recording.");
		return false;
	}

	ReplayRuntime.recording = true;
	ReplayRuntime.recordingStartedAt = null;
	ReplayRuntime.recordedFrames = [];
	ReplayRuntime.recordedRendering = null;
	ReplayRuntime.recordedViewport = null;
	ReplayRuntime.recordedPlayerStyle = null;
	ReplayRuntime.recordedSources = null;
	ReplayRuntime.recordedEnvironments = [];
	ReplayRuntime.recordedWallTuples = null;
	ReplayRuntime.lastRecordedEnvironmentStateRevision = null;
	ReplayRuntime.currentRecordedEnvironmentRevision = -1;
	ReplayRuntime.recordedRenderIds = new Map();
	ReplayRuntime.nextRecordedRenderId = 1;
	ReplayRuntime.recordedEnemyDefinitions = [];
	ReplayRuntime.recordedEnemyDefinitionIds = new Set();
	ReplayRuntime.recordedProjectileDefinitions = [];
	ReplayRuntime.recordedProjectileDefinitionIds = new Set();
	setReplayStatus("Recording replay... 0 frames");
	syncReplayButtons();
	return true;
}

export function recordReplaySnapshot(snapshot, currentTime) {
	if (!ReplayRuntime.recording) return;

	if (ReplayRuntime.recordingStartedAt === null) {
		ReplayRuntime.recordingStartedAt = currentTime;
	}

	const timeMs = Math.max(0, currentTime - ReplayRuntime.recordingStartedAt);
	if (!ReplayRuntime.recordedRendering) {
		ReplayRuntime.recordedRendering = clonePlain(snapshot.rendering);
		ReplayRuntime.recordedViewport = [
			snapshot.camera.widthBlocks,
			snapshot.camera.heightBlocks,
		];
		ReplayRuntime.recordedPlayerStyle = [
			snapshot.player.size,
			snapshot.player.color,
			snapshot.player.maxHp,
		];
		ReplayRuntime.recordedSources = {
			config: snapshot.configSource,
			level: snapshot.levelSource,
		};
	}

	const environmentRevision = ensureRecordedEnvironment(snapshot);
	ReplayRuntime.recordedFrames.push(
		encodeReplayFrame(snapshot, timeMs, environmentRevision),
	);

	if (ReplayRuntime.recordedFrames.length % 30 === 0) {
		setReplayStatus(
			`Recording replay... ${ReplayRuntime.recordedFrames.length} frames`,
		);
	}
}

export async function stopReplayRecording() {
	if (!ReplayRuntime.recording) return false;

	ReplayRuntime.recording = false;
	if (ReplayRuntime.recordedFrames.length === 0) {
		setReplayStatus("Recording stopped before any replay frames were captured.");
		syncReplayButtons();
		return false;
	}

	const replay = {
		replayVersion: REPLAY_VERSION,
		createdAt: new Date().toISOString(),
		configSchemaVersion: Config.CONFIG_SCHEMA_VERSION,
		levelSeed: GameState.levelSeed,
		gameModeId: GameState.gameModeId,
		config: replayConfigSnapshot(),
		rendering: ReplayRuntime.recordedRendering,
		viewport: ReplayRuntime.recordedViewport,
		playerStyle: ReplayRuntime.recordedPlayerStyle,
		sources: ReplayRuntime.recordedSources,
		entityDefinitions: {
			enemies: ReplayRuntime.recordedEnemyDefinitions,
			projectiles: ReplayRuntime.recordedProjectileDefinitions,
		},
		environments: ReplayRuntime.recordedEnvironments,
		frames: ReplayRuntime.recordedFrames,
	};

	ReplayRuntime.loadedReplay = replay;
	ReplayRuntime.playbackFrameIndex = 0;

	try {
		await saveActiveReplay(replay);
		setReplayStatus(
			`Recording stopped: ${replay.frames.length} frames, ${replay.environments.length} environment revisions. Replay is ready in Main Menu > Replays.`,
		);
	} catch (error) {
		console.error("Could not store recorded replay:", error);
		setReplayStatus(
			`Recording stopped, but replay storage failed: ${error.message}`,
		);
	}

	syncReplayButtons();
	return true;
}

