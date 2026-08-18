// Visual snapshot history, replay recording/playback, and trails.

import { Config } from "./config.js";
import { GameState, player, camera } from "./state.js";
import {
	replayRecordBtn,
	replayStopSaveBtn,
	replayLoadBtn,
	replayFileInput,
	replayPlayPauseBtn,
	replayStopBtn,
	replayStatus,
} from "./dom.js";

export const REPLAY_VERSION = 1;
const LASER_TELEGRAPH_RANGE_BLOCKS = 60;

// Stable IDs let consecutive visual snapshots identify the same moving object.
// This is used by trail interpolation and is also serialized into replay files.
const renderIds = new WeakMap();
let nextRenderId = 1;

function getRenderId(object, prefix) {
	if (!object || typeof object !== "object") return null;
	let id = renderIds.get(object);
	if (!id) {
		id = `${prefix}:${nextRenderId++}`;
		renderIds.set(object, id);
	}
	return id;
}

const ReplayRuntime = {
	recording: false,
	recordingStartedAt: null,
	recordedFrames: [],
	loadedReplay: null,
	playbackActive: false,
	playbackPlaying: false,
	playbackFrameIndex: 0,
	playbackStartedAt: 0,
	playbackBaseTimeMs: 0,
	trailHistory: [],
	liveTrailSequence: 0,
};

function clonePlain(value) {
	return JSON.parse(JSON.stringify(value));
}

function renderingSnapshot() {
	return {
		CANVAS_WIDTH_PX: Math.max(
			1,
			Math.round(Number(Config.RENDERING.CANVAS_WIDTH_PX) || 1920),
		),
		CANVAS_HEIGHT_PX: Math.max(
			1,
			Math.round(Number(Config.RENDERING.CANVAS_HEIGHT_PX) || 1080),
		),
		BLOCK_SIZE_PX: Math.max(
			1,
			Number(Config.RENDERING.BLOCK_SIZE_PX) || 64,
		),
		ZOOM: Math.max(0.01, Number(Config.RENDERING.ZOOM) || 1),
		TARGET_FPS: Math.max(
			1,
			Math.round(Number(Config.RENDERING.TARGET_FPS ?? 60) || 60),
		),
		ENVIRONMENT_OVERSCAN_BLOCKS: Math.max(
			0,
			Number(Config.RENDERING.ENVIRONMENT_OVERSCAN_BLOCKS) || 0,
		),
		TRAIL_LENGTH_FRAMES: Math.max(
			0,
			Math.round(Number(Config.RENDERING.TRAIL_LENGTH_FRAMES) || 0),
		),
		TRAIL_DETAIL: Math.min(
			60,
			Math.max(0, Math.round(Number(Config.RENDERING.TRAIL_DETAIL) || 0)),
		),
		TRAIL_QUAD_DETAIL: Math.min(
			60,
			Math.max(
				0,
				Math.round(Number(Config.RENDERING.TRAIL_QUAD_DETAIL ?? 30) || 0),
			),
		),
	};
}

// Captures only render-relevant, JSON-safe data. The same representation feeds
// normal drawing, trail history, and replay playback.
export function captureVisualSnapshot(currentTime) {
	const rendering = renderingSnapshot();

	return {
		rendering,
		camera: {
			x: camera.x,
			y: camera.y,
			widthBlocks: camera.widthBlocks,
			heightBlocks: camera.heightBlocks,
		},
		showEditorHelpers: GameState.showEditorHelpers,
		activeWeaponIndex: GameState.activeWeaponIndex,
		maxDistance: GameState.MaxDistance,
		walls: GameState.walls.map((wall) => ({
			x: wall.x,
			y: wall.y,
			width: wall.width,
			height: wall.height,
			color: wall.color,
		})),
		enemySpawns: GameState.enemySpawns.map((spawn) => ({
			x: spawn.x,
			y: spawn.y,
			size: spawn.size,
			type: spawn.type,
		})),
		player: {
			renderId: "player",
			x: player.x,
			y: player.y,
			size: player.size,
			color: player.color,
			hp: player.hp,
			maxHp: player.maxHp,
		},
		enemies: GameState.enemies.map((enemy) => ({
			renderId: getRenderId(enemy, "enemy"),
			x: enemy.x,
			y: enemy.y,
			size: enemy.size,
			color: enemy.color,
			hp: enemy.hp,
			maxHp: enemy.maxHp,
		})),
		projectiles: [...GameState.bullets, ...GameState.enemyBullets].map(
			(projectile) => ({
				renderId: getRenderId(projectile, "projectile"),
				x: projectile.x,
				y: projectile.y,
				radius: projectile.radius,
				color: projectile.color,
			}),
		),
		laserWarmups: GameState.laserWarmups.map((shot) => {
			const originX = shot.shooter.x + shot.shooter.size / 2;
			const originY = shot.shooter.y + shot.shooter.size / 2;
			const elapsed = Math.max(0, currentTime - shot.startedAt);
			const duration = Math.max(1, shot.fireAt - shot.startedAt);
			const progress = Math.min(1, elapsed / duration);
			const radius = Math.max(
				0.015,
				Number(shot.stats.radiusBlocks ?? 0.03) || 0.03,
			);

			return {
				renderId: getRenderId(shot, "laser-warmup"),
				x1: originX,
				y1: originY,
				x2: originX + shot.dirX * LASER_TELEGRAPH_RANGE_BLOCKS,
				y2: originY + shot.dirY * LASER_TELEGRAPH_RANGE_BLOCKS,
				color: shot.stats.color ?? "white",
				radius,
				alpha: 0.16 + progress * 0.34,
			};
		}),
		laserBeams: GameState.laserBeams.map((beam) => {
			const age = Math.max(0, currentTime - beam.createdAt);
			const alpha = Math.max(
				0,
				1 - age / Math.max(1, Number(beam.durationMs) || 1),
			);

			return {
				renderId: getRenderId(beam, "laser-beam"),
				x1: beam.x1,
				y1: beam.y1,
				x2: beam.x2,
				y2: beam.y2,
				color: beam.color,
				radius: beam.radius,
				alpha,
			};
		}),
		explosions: GameState.explosions.map((explosion) => ({
			renderId: getRenderId(explosion, "explosion"),
			x: explosion.x,
			y: explosion.y,
			radius: explosion.radius,
			color: explosion.color,
		})),
	};
}

export function getTrailLengthFrames() {
	return Math.max(
		0,
		Math.round(Number(Config.RENDERING.TRAIL_LENGTH_FRAMES) || 0),
	);
}

export function getTrailDetail() {
	return Math.min(
		60,
		Math.max(0, Math.round(Number(Config.RENDERING.TRAIL_DETAIL) || 0)),
	);
}

export function getTrailQuadDetail() {
	return Math.min(
		60,
		Math.max(
			0,
			Math.round(Number(Config.RENDERING.TRAIL_QUAD_DETAIL ?? 30) || 0),
		),
	);
}

// Select exactly `detail` source frames out of each repeating 60-frame
// window. This uses a deterministic distributed/Bresenham-like pattern rather
// than a floating stride. Important examples:
//   detail 60 -> 0,1,2,3,...
//   detail 30 -> 0,2,4,6,...
//   detail 20 -> 0,3,6,9,...
// Non-divisors (e.g. 40) are spread as evenly as possible across all 60.
export function isTrailDetailFrame(frameNumber, detail = getTrailDetail()) {
	const normalizedDetail = Math.min(60, Math.max(0, Math.round(detail || 0)));
	if (normalizedDetail <= 0) return false;
	if (normalizedDetail >= 60) return true;

	const frame = Math.max(0, Math.floor(Number(frameNumber) || 0));
	if (frame === 0) return true;

	return (
		Math.floor((frame * normalizedDetail) / 60) !==
		Math.floor(((frame - 1) * normalizedDetail) / 60)
	);
}

function makeDynamicTrailSnapshot(snapshot) {
	return {
		player: snapshot.player,
		enemies: snapshot.enemies,
		projectiles: snapshot.projectiles,
		laserWarmups: snapshot.laserWarmups,
		laserBeams: snapshot.laserBeams,
		explosions: snapshot.explosions,
	};
}

// Keep all source frames inside the configured length window. Trail Detail is
// deliberately applied only when entries are requested: a detail of 30 can
// therefore connect source frame 0 directly to frame 2 without losing the
// ability to change detail at runtime.
export function pushTrailSnapshot(snapshot) {
	const trailLength = getTrailLengthFrames();
	const sequence = ReplayRuntime.liveTrailSequence++;

	if (trailLength <= 0 || (getTrailDetail() <= 0 && getTrailQuadDetail() <= 0)) {
		ReplayRuntime.trailHistory.length = 0;
		return;
	}

	ReplayRuntime.trailHistory.push({
		sequence,
		snapshot: makeDynamicTrailSnapshot(snapshot),
	});
	const maxSnapshots = trailLength + 1;

	if (ReplayRuntime.trailHistory.length > maxSnapshots) {
		ReplayRuntime.trailHistory.splice(
			0,
			ReplayRuntime.trailHistory.length - maxSnapshots,
		);
	}
}

export function clearTrailHistory() {
	ReplayRuntime.trailHistory.length = 0;
	ReplayRuntime.liveTrailSequence = 0;
}

// Returns sampled trail frames oldest -> newest. Trail Detail controls the
// historical samples, but the current source frame is always included as the
// terminal sample. This prevents a visible gap at the head of low-detail trails
// on frames that are intentionally skipped by Trail Detail. Alpha is still based
// on actual source-frame age, not the number of sampled frames.
export function getLiveTrailEntries(detail = getTrailDetail()) {
	const trailLength = getTrailLengthFrames();
	detail = Math.min(60, Math.max(0, Math.round(Number(detail) || 0)));
	const history = ReplayRuntime.trailHistory;

	if (trailLength <= 0 || detail <= 0 || history.length <= 1) return [];

	const current = history[history.length - 1];
	const entries = [];

	for (const entry of history) {
		const ageFrames = current.sequence - entry.sequence;
		if (ageFrames < 0 || ageFrames > trailLength) continue;
		if (!isTrailDetailFrame(entry.sequence, detail)) continue;

		entries.push({
			snapshot: entry.snapshot,
			alpha: Math.max(0, 1 - ageFrames / trailLength),
			frameNumber: entry.sequence,
		});
	}

	// Always terminate the ribbon at the live position. At lower detail the
	// current frame is often intentionally unsampled (e.g. odd frames at 30),
	// which previously left the newest quad missing until the next sample.
	if (entries.at(-1)?.frameNumber !== current.sequence) {
		entries.push({
			snapshot: current.snapshot,
			alpha: 1,
			frameNumber: current.sequence,
		});
	}

	return entries.length >= 2 ? entries : [];
}

function setReplayStatus(message) {
	if (replayStatus) replayStatus.textContent = message;
}

function syncReplayButtons() {
	if (replayRecordBtn) replayRecordBtn.disabled = ReplayRuntime.recording;
	if (replayStopSaveBtn) replayStopSaveBtn.disabled = !ReplayRuntime.recording;
	if (replayLoadBtn) replayLoadBtn.disabled = ReplayRuntime.recording;
	if (replayPlayPauseBtn) {
		replayPlayPauseBtn.disabled =
			ReplayRuntime.recording || !ReplayRuntime.loadedReplay;
		replayPlayPauseBtn.textContent = ReplayRuntime.playbackPlaying
			? "Pause Replay"
			: ReplayRuntime.playbackActive
				? "Resume Replay"
				: "Play Replay";
	}
	if (replayStopBtn) replayStopBtn.disabled = !ReplayRuntime.playbackActive;
}

export function startReplayRecording() {
	if (ReplayRuntime.playbackActive) {
		setReplayStatus("Stop replay playback before recording.");
		return false;
	}

	ReplayRuntime.recording = true;
	ReplayRuntime.recordingStartedAt = null;
	ReplayRuntime.recordedFrames = [];
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
	ReplayRuntime.recordedFrames.push({
		...snapshot,
		frame: ReplayRuntime.recordedFrames.length,
		timeMs,
	});

	if (ReplayRuntime.recordedFrames.length % 30 === 0) {
		setReplayStatus(
			`Recording replay... ${ReplayRuntime.recordedFrames.length} frames`,
		);
	}
}

function replayFileName() {
	return `demo-${new Date().toISOString().replace(/[:.]/g, "-")}.replay`;
}

export function stopReplayRecordingAndSave() {
	if (!ReplayRuntime.recording) return false;

	ReplayRuntime.recording = false;
	const replay = {
		replayVersion: REPLAY_VERSION,
		createdAt: new Date().toISOString(),
		configSchemaVersion: Config.CONFIG_SCHEMA_VERSION,
		levelSeed: GameState.levelSeed,
		config: clonePlain(Config),
		frames: ReplayRuntime.recordedFrames,
	};

	const blob = new Blob([JSON.stringify(replay)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = replayFileName();
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);

	ReplayRuntime.loadedReplay = replay;
	ReplayRuntime.playbackFrameIndex = 0;
	setReplayStatus(
		`Saved ${replay.frames.length} replay frames (${(
			blob.size /
			1024 /
			1024
		).toFixed(2)} MiB).`,
	);
	syncReplayButtons();
	return true;
}

function validateReplayData(data) {
	if (!data || typeof data !== "object") {
		throw new Error("Replay file must contain a JSON object.");
	}
	if (Number(data.replayVersion) !== REPLAY_VERSION) {
		throw new Error(
			`Unsupported replay version ${data.replayVersion ?? "unknown"}.`,
		);
	}
	if (!Array.isArray(data.frames) || data.frames.length === 0) {
		throw new Error("Replay file contains no frames.");
	}

	let previousTime = -Infinity;
	for (const [index, frame] of data.frames.entries()) {
		const timeMs = Number(frame?.timeMs);
		if (!Number.isFinite(timeMs) || timeMs < previousTime) {
			throw new Error(`Replay frame ${index} has an invalid timestamp.`);
		}
		if (!frame?.camera || !frame?.player || !frame?.rendering) {
			throw new Error(`Replay frame ${index} is missing visual snapshot data.`);
		}
		previousTime = timeMs;
	}
}

export async function loadReplayFile(file) {
	if (!file) return false;

	try {
		const text = await file.text();
		const replay = JSON.parse(text);
		validateReplayData(replay);

		stopReplayPlayback();
		ReplayRuntime.loadedReplay = replay;
		ReplayRuntime.playbackFrameIndex = 0;
		setReplayStatus(`Loaded replay: ${replay.frames.length} frames.`);
		syncReplayButtons();
		return true;
	} catch (error) {
		console.error("Failed to load replay:", error);
		setReplayStatus(`Replay load failed: ${error.message}`);
		return false;
	}
}

export function startOrResumeReplayPlayback(currentTime = performance.now()) {
	const replay = ReplayRuntime.loadedReplay;
	if (!replay || ReplayRuntime.recording) return false;

	if (!ReplayRuntime.playbackActive) {
		ReplayRuntime.playbackActive = true;
		ReplayRuntime.playbackFrameIndex = 0;
		ReplayRuntime.playbackBaseTimeMs = 0;
	} else if (ReplayRuntime.playbackPlaying) {
		return pauseReplayPlayback(currentTime);
	} else {
		const lastFrame = replay.frames[replay.frames.length - 1];
		if (
			ReplayRuntime.playbackFrameIndex >= replay.frames.length - 1 &&
			ReplayRuntime.playbackBaseTimeMs >= Number(lastFrame.timeMs)
		) {
			ReplayRuntime.playbackFrameIndex = 0;
			ReplayRuntime.playbackBaseTimeMs = 0;
		}
	}

	ReplayRuntime.playbackPlaying = true;
	ReplayRuntime.playbackStartedAt = currentTime;
	GameState.pressedInputs.clear();
	clearTrailHistory();
	setReplayStatus("Playing replay...");
	syncReplayButtons();
	return true;
}

export function pauseReplayPlayback(currentTime = performance.now()) {
	if (!ReplayRuntime.playbackActive || !ReplayRuntime.playbackPlaying) {
		return false;
	}

	ReplayRuntime.playbackBaseTimeMs += Math.max(
		0,
		currentTime - ReplayRuntime.playbackStartedAt,
	);
	ReplayRuntime.playbackPlaying = false;
	setReplayStatus(
		`Replay paused at frame ${ReplayRuntime.playbackFrameIndex + 1}.`,
	);
	syncReplayButtons();
	return true;
}

export function stopReplayPlayback() {
	if (!ReplayRuntime.playbackActive) {
		syncReplayButtons();
		return false;
	}

	ReplayRuntime.playbackActive = false;
	ReplayRuntime.playbackPlaying = false;
	ReplayRuntime.playbackFrameIndex = 0;
	ReplayRuntime.playbackBaseTimeMs = 0;
	GameState.pressedInputs.clear();
	clearTrailHistory();
	setReplayStatus("Replay stopped.");
	syncReplayButtons();
	return true;
}

export function isReplayPlaybackActive() {
	return ReplayRuntime.playbackActive;
}

function currentPlaybackTimeMs(currentTime) {
	if (!ReplayRuntime.playbackPlaying) {
		return ReplayRuntime.playbackBaseTimeMs;
	}

	return (
		ReplayRuntime.playbackBaseTimeMs +
		Math.max(0, currentTime - ReplayRuntime.playbackStartedAt)
	);
}

// Advances by recorded timestamps rather than assuming a fixed FPS. That keeps
// playback timing faithful even when the original render cadence varied.
export function getReplaySnapshotForRender(currentTime) {
	if (!ReplayRuntime.playbackActive || !ReplayRuntime.loadedReplay) {
		return null;
	}

	const frames = ReplayRuntime.loadedReplay.frames;
	const playbackTimeMs = currentPlaybackTimeMs(currentTime);

	while (
		ReplayRuntime.playbackFrameIndex + 1 < frames.length &&
		Number(frames[ReplayRuntime.playbackFrameIndex + 1].timeMs) <=
			playbackTimeMs
	) {
		ReplayRuntime.playbackFrameIndex += 1;
	}

	if (
		ReplayRuntime.playbackPlaying &&
		ReplayRuntime.playbackFrameIndex === frames.length - 1 &&
		playbackTimeMs >= Number(frames[frames.length - 1].timeMs)
	) {
		ReplayRuntime.playbackPlaying = false;
		ReplayRuntime.playbackBaseTimeMs = Number(
			frames[frames.length - 1].timeMs,
		);
		setReplayStatus(`Replay finished (${frames.length} frames).`);
		syncReplayButtons();
	}

	return frames[ReplayRuntime.playbackFrameIndex];
}

// Replay trails are taken straight from already-recorded preceding snapshots,
// avoiding duplicate history entries if display FPS differs from recorded FPS.
export function getReplayTrailEntries(detail = getTrailDetail()) {
	if (!ReplayRuntime.playbackActive || !ReplayRuntime.loadedReplay) return [];

	const trailLength = getTrailLengthFrames();
	detail = Math.min(60, Math.max(0, Math.round(Number(detail) || 0)));
	if (trailLength <= 0 || detail <= 0) return [];

	const frames = ReplayRuntime.loadedReplay.frames;
	const currentIndex = ReplayRuntime.playbackFrameIndex;
	const startIndex = Math.max(0, currentIndex - trailLength);
	const entries = [];

	for (let index = startIndex; index <= currentIndex; index++) {
		const frameNumber = Number.isFinite(Number(frames[index]?.frame))
			? Math.max(0, Math.floor(Number(frames[index].frame)))
			: index;
		if (!isTrailDetailFrame(frameNumber, detail)) continue;

		const ageFrames = currentIndex - index;
		entries.push({
			snapshot: frames[index],
			alpha: Math.max(0, 1 - ageFrames / trailLength),
			frameNumber,
		});
	}

	const currentFrameNumber = Number.isFinite(Number(frames[currentIndex]?.frame))
		? Math.max(0, Math.floor(Number(frames[currentIndex].frame)))
		: currentIndex;
	if (entries.at(-1)?.frameNumber !== currentFrameNumber) {
		entries.push({
			snapshot: frames[currentIndex],
			alpha: 1,
			frameNumber: currentFrameNumber,
		});
	}

	return entries.length >= 2 ? entries : [];
}

export function initReplayControls() {
	if (!replayRecordBtn) return;

	replayRecordBtn.addEventListener("click", () => startReplayRecording());
	replayStopSaveBtn?.addEventListener("click", () =>
		stopReplayRecordingAndSave(),
	);
	replayLoadBtn?.addEventListener("click", () => replayFileInput?.click());
	replayFileInput?.addEventListener("change", async () => {
		const file = replayFileInput.files?.[0];
		await loadReplayFile(file);
		replayFileInput.value = "";
	});
	replayPlayPauseBtn?.addEventListener("click", () => {
		if (ReplayRuntime.playbackPlaying) {
			pauseReplayPlayback();
		} else {
			startOrResumeReplayPlayback();
		}
	});
	replayStopBtn?.addEventListener("click", () => stopReplayPlayback());

	setReplayStatus("Replay idle.");
	syncReplayButtons();
}
