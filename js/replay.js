// Visual snapshot history, replay recording/playback, and trails.

import { Config } from "./config.js";
import { GameState, player, camera } from "./state.js";
import {
	replayRecordBtn,
	replayStopRecordingBtn,
	replayPlayPauseBtn,
	replayStopBtn,
	replayStatus,
} from "./dom.js";
import { REPLAY_VERSION, validateReplayData } from "./replay-file.js";
import { saveActiveReplay } from "./replay-store.js";

// Stable IDs let consecutive visual snapshots identify the same moving object.
// This is used by trail interpolation and is also serialized into replay files.
const renderIds = new WeakMap();
const replayEnvironmentMaps = new WeakMap();
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
	recordedRendering: null,
	recordedEnvironments: [],
	lastRecordedEnvironmentStateRevision: null,
	currentRecordedEnvironmentRevision: -1,
	loadedReplay: null,
	playbackActive: false,
	playbackPlaying: false,
	playbackFrameIndex: 0,
	playbackStartedAt: 0,
	playbackBaseTimeMs: 0,
	playbackSpeed: 1,
	trailHistory: [],
	liveTrailSequence: 0,
	playbackHydratedReplay: null,
	playbackHydratedFrameIndex: -1,
	playbackHydratedSnapshot: null,
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

function debugSnapshot() {
	const source = Config.DEBUG || {};
	const configuredBudget = Number(source.MAX_DRAWS_PER_FRAME);

	return {
		MAX_DRAWS_PER_FRAME: Number.isFinite(configuredBudget)
			? Math.max(0, Math.floor(configuredBudget))
			: 1000,
		SHOW_FPS: source.SHOW_FPS !== false,
		SHOW_TARGET_FPS: source.SHOW_TARGET_FPS !== false,
		SHOW_MS_PER_TICK: source.SHOW_MS_PER_TICK !== false,
		SHOW_ENTITY_COUNT: source.SHOW_ENTITY_COUNT !== false,
		SHOW_ENEMY_COUNT: source.SHOW_ENEMY_COUNT !== false,
		SHOW_BULLET_COUNT: source.SHOW_BULLET_COUNT !== false,
		DRAW_GRID_COORDINATES: source.DRAW_GRID_COORDINATES !== false,
		DRAW_ENEMY_SPAWNS: source.DRAW_ENEMY_SPAWNS !== false,
		DRAW_ENEMY_AIM_MAXIMUM_CONE:
			source.DRAW_ENEMY_AIM_MAXIMUM_CONE !== false,
		DRAW_ENEMY_AIM_VISIBILITY_REGION:
			source.DRAW_ENEMY_AIM_VISIBILITY_REGION !== false,
		DRAW_ENEMY_AIM_VISIBLE_INTERVAL:
			source.DRAW_ENEMY_AIM_VISIBLE_INTERVAL !== false,
		DRAW_ENEMY_AIM_BOUNDARY_POINTS:
			source.DRAW_ENEMY_AIM_BOUNDARY_POINTS !== false,
		DRAW_ENEMY_AIM_LEAD_ANGLE:
			source.DRAW_ENEMY_AIM_LEAD_ANGLE !== false,
		DRAW_ENEMY_AIM_CACHED_CORNER:
			source.DRAW_ENEMY_AIM_CACHED_CORNER !== false,
	};
}

function captureEnemyAimDebugSnapshot(enemy, debug) {
	const maximumAimInterval =
		debug.DRAW_ENEMY_AIM_MAXIMUM_CONE && enemy.debugMaximumAimInterval
			? {
				originX: enemy.debugMaximumAimInterval.originX,
				originY: enemy.debugMaximumAimInterval.originY,
				minAngle: enemy.debugMaximumAimInterval.minAngle,
				maxAngle: enemy.debugMaximumAimInterval.maxAngle,
			}
			: null;
	const aimVisibilityProfile =
		debug.DRAW_ENEMY_AIM_VISIBILITY_REGION && enemy.debugAimVisibilityProfile
			? {
				originX: enemy.debugAimVisibilityProfile.originX,
				originY: enemy.debugAimVisibilityProfile.originY,
				maxDistance: Number.isFinite(
					enemy.debugAimVisibilityProfile.maxDistance,
				)
					? enemy.debugAimVisibilityProfile.maxDistance
					: 50,
				rays: enemy.debugAimVisibilityProfile.rays.map((ray) => ({
					angle: ray.angle,
					distance: Number.isFinite(ray.distance) ? ray.distance : 50,
					blocked: ray.blocked === true,
				})),
			}
			: null;
	const visibleInterval =
		(debug.DRAW_ENEMY_AIM_VISIBLE_INTERVAL ||
			debug.DRAW_ENEMY_AIM_BOUNDARY_POINTS) &&
		enemy.debugVisibleAimInterval
			? {
				originX: enemy.debugVisibleAimInterval.originX,
				originY: enemy.debugVisibleAimInterval.originY,
				minAngle: enemy.debugVisibleAimInterval.minAngle,
				maxAngle: enemy.debugVisibleAimInterval.maxAngle,
				minBoundaryPoint:
					enemy.debugVisibleAimInterval.minBoundary?.point || null,
				maxBoundaryPoint:
					enemy.debugVisibleAimInterval.maxBoundary?.point || null,
			}
			: null;
	let cachedCornerPoint = null;
	if (debug.DRAW_ENEMY_AIM_CACHED_CORNER) {
		if (
			enemy.lostLosCorner?.source?.kind === "point" ||
			enemy.lostLosCorner?.source?.kind === "rounded-corner-tangent"
		) {
			cachedCornerPoint = {
				x: enemy.lostLosCorner.source.x,
				y: enemy.lostLosCorner.source.y,
			};
		} else {
			cachedCornerPoint = enemy.lostLosCorner?.point || null;
		}
	}

	return {
		originX: Number.isFinite(enemy.debugAimOriginX)
			? enemy.debugAimOriginX
			: enemy.x + enemy.size / 2,
		originY: Number.isFinite(enemy.debugAimOriginY)
			? enemy.debugAimOriginY
			: enemy.y + enemy.size / 2,
		leadAngle:
			debug.DRAW_ENEMY_AIM_LEAD_ANGLE &&
			Number.isFinite(enemy.currentPredictedShotAngle)
				? enemy.currentPredictedShotAngle
				: null,
		maximumAimInterval,
		aimVisibilityProfile,
		visibleInterval,
		distance: Number.isFinite(enemy.debugAimDistance)
			? Math.max(0, enemy.debugAimDistance)
			: 50,
		cachedCornerAngle:
			debug.DRAW_ENEMY_AIM_CACHED_CORNER &&
			Number.isFinite(enemy.lostLosCornerAngle)
				? enemy.lostLosCornerAngle
				: null,
		cachedCornerPoint,
		usingCachedCorner: enemy.debugUsingCachedCorner === true,
	};
}

// Captures render-relevant data for the current frame. Environment arrays are
// referenced directly for live drawing; trail history strips them, and replay
// recording clones them only when GameState.environmentRevision changes.
export function captureVisualSnapshot(currentTime) {
	const rendering = renderingSnapshot();
	const debug = debugSnapshot();
	const captureEnemyAimDebug =
		GameState.showEditorHelpers &&
		debug.MAX_DRAWS_PER_FRAME > 0 &&
		(
			debug.DRAW_ENEMY_AIM_MAXIMUM_CONE ||
			debug.DRAW_ENEMY_AIM_VISIBILITY_REGION ||
			debug.DRAW_ENEMY_AIM_VISIBLE_INTERVAL ||
			debug.DRAW_ENEMY_AIM_BOUNDARY_POINTS ||
			debug.DRAW_ENEMY_AIM_LEAD_ANGLE ||
			debug.DRAW_ENEMY_AIM_CACHED_CORNER
		);

	return {
		rendering,
		debug,
		camera: {
			x: camera.x,
			y: camera.y,
			widthBlocks: camera.widthBlocks,
			heightBlocks: camera.heightBlocks,
		},
		showEditorHelpers: GameState.showEditorHelpers,
		activeWeaponIndex: GameState.activeWeaponIndex,
		maxDistance: GameState.MaxDistance,
		walls: GameState.walls,
		enemySpawns: GameState.enemySpawns,
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
			aimDebug: captureEnemyAimDebug
				? captureEnemyAimDebugSnapshot(enemy, debug)
				: null,
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
		projectileTrailEvents: (GameState.projectileTrailEvents || []).map(
			(event) => ({
				renderId: getRenderId(event.projectile, "projectile"),
				x: event.x,
				y: event.y,
				radius: event.radius,
				color: event.color,
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
			const alpha = 0.16 + progress * 0.34;

			if ((shot.coneHalfAngle ?? 0) > 0) {
				return {
					renderId: getRenderId(shot, "laser-warmup"),
					type: "cone",
					originX,
					originY,
					centerAngle: shot.centerAngle,
					halfAngle: shot.coneHalfAngle,
					range: Math.max(0, Number(shot.telegraphRangeBlocks) || 0),
					color: shot.stats.color ?? "white",
					alpha,
				};
			}

			return {
				renderId: getRenderId(shot, "laser-warmup"),
				type: "beam",
				x1: originX,
				y1: originY,
				x2: originX + shot.dirX * Math.max(0, Number(shot.telegraphRangeBlocks) || 0),
				y2: originY + shot.dirY * Math.max(0, Number(shot.telegraphRangeBlocks) || 0),
				color: shot.stats.color ?? "white",
				radius,
				alpha,
			};
		}),
		laserBeams: GameState.laserBeams.map((beam) => {
			const age = Math.max(0, currentTime - beam.createdAt);
			const alpha = Math.max(
				0,
				1 - age / Math.max(1, Number(beam.durationMs) || 1),
			);

			if (beam.type === "cone") {
				return {
					renderId: getRenderId(beam, "laser-beam"),
					type: "cone",
					points: (beam.points || []).map((point) => ({
						x: point.x,
						y: point.y,
					})),
					color: beam.color,
					alpha,
				};
			}

			return {
				renderId: getRenderId(beam, "laser-beam"),
				type: "beam",
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
		projectileTrailEvents: snapshot.projectileTrailEvents || [],
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
export function getLiveTrailEntries(
	detail = getTrailDetail(),
	preserveProjectileEvents = true,
) {
	const trailLength = getTrailLengthFrames();
	detail = Math.min(60, Math.max(0, Math.round(Number(detail) || 0)));
	const history = ReplayRuntime.trailHistory;

	if (trailLength <= 0 || detail <= 0 || history.length <= 1) return [];

	const current = history[history.length - 1];
	const entries = [];

	for (const entry of history) {
		const ageFrames = current.sequence - entry.sequence;
		if (ageFrames < 0 || ageFrames > trailLength) continue;
		const hasProjectileTrailEvents =
			preserveProjectileEvents &&
			(entry.snapshot.projectileTrailEvents?.length ?? 0) > 0;
		if (!isTrailDetailFrame(entry.sequence, detail) && !hasProjectileTrailEvents) {
			continue;
		}

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

function cloneEnvironmentSnapshot(snapshot, revision) {
	return {
		revision,
		walls: (snapshot.walls || []).map((wall) => ({
			x: wall.x,
			y: wall.y,
			width: wall.width,
			height: wall.height,
			color: wall.color,
		})),
		enemySpawns: (snapshot.enemySpawns || []).map((spawn) => ({
			x: spawn.x,
			y: spawn.y,
			size: spawn.size,
			type: spawn.type,
		})),
	};
}

function ensureRecordedEnvironment(snapshot) {
	const stateRevision = Number(GameState.environmentRevision) || 0;

	if (
		ReplayRuntime.recordedEnvironments.length === 0 ||
		ReplayRuntime.lastRecordedEnvironmentStateRevision !== stateRevision
	) {
		const revision = ReplayRuntime.recordedEnvironments.length;
		ReplayRuntime.recordedEnvironments.push(
			cloneEnvironmentSnapshot(snapshot, revision),
		);
		ReplayRuntime.lastRecordedEnvironmentStateRevision = stateRevision;
		ReplayRuntime.currentRecordedEnvironmentRevision = revision;
	}

	return ReplayRuntime.currentRecordedEnvironmentRevision;
}

function environmentMapForReplay(replay) {
	if (Number(replay?.replayVersion) < 2) return null;

	let environmentMap = replayEnvironmentMaps.get(replay);
	if (!environmentMap) {
		environmentMap = new Map(
			(replay.environments || []).map((environment) => [
				Number(environment.revision),
				environment,
			]),
		);
		replayEnvironmentMaps.set(replay, environmentMap);
	}

	return environmentMap;
}

function hydrateReplayFrame(replay, frame, frameIndex) {
	if (!replay || !frame) return null;
	if (Number(replay.replayVersion) < 2) return frame;

	if (
		ReplayRuntime.playbackHydratedReplay === replay &&
		ReplayRuntime.playbackHydratedFrameIndex === frameIndex &&
		ReplayRuntime.playbackHydratedSnapshot
	) {
		return ReplayRuntime.playbackHydratedSnapshot;
	}

	const environment = environmentMapForReplay(replay)?.get(
		Number(frame.environmentRevision),
	);
	const snapshot = {
		...frame,
		rendering: replay.rendering,
		walls: environment?.walls || [],
		enemySpawns: environment?.enemySpawns || [],
	};

	ReplayRuntime.playbackHydratedReplay = replay;
	ReplayRuntime.playbackHydratedFrameIndex = frameIndex;
	ReplayRuntime.playbackHydratedSnapshot = snapshot;
	return snapshot;
}

function clearHydratedReplayFrame() {
	ReplayRuntime.playbackHydratedReplay = null;
	ReplayRuntime.playbackHydratedFrameIndex = -1;
	ReplayRuntime.playbackHydratedSnapshot = null;
}

function setReplayStatus(message) {
	if (replayStatus) replayStatus.textContent = message;
}

function syncReplayButtons() {
	if (replayRecordBtn) replayRecordBtn.disabled = ReplayRuntime.recording;
	if (replayStopRecordingBtn) replayStopRecordingBtn.disabled = !ReplayRuntime.recording;
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
	ReplayRuntime.recordedRendering = null;
	ReplayRuntime.recordedEnvironments = [];
	ReplayRuntime.lastRecordedEnvironmentStateRevision = null;
	ReplayRuntime.currentRecordedEnvironmentRevision = -1;
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
	}

	const environmentRevision = ensureRecordedEnvironment(snapshot);
	const {
		rendering: _rendering,
		walls: _walls,
		enemySpawns: _enemySpawns,
		...dynamicSnapshot
	} = snapshot;

	ReplayRuntime.recordedFrames.push({
		...dynamicSnapshot,
		frame: ReplayRuntime.recordedFrames.length,
		timeMs,
		environmentRevision,
	});

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
		config: clonePlain(Config),
		rendering: ReplayRuntime.recordedRendering,
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

export function loadReplayData(replay) {
	validateReplayData(replay);
	stopReplayPlayback();
	ReplayRuntime.loadedReplay = replay;
	ReplayRuntime.playbackFrameIndex = 0;
	ReplayRuntime.playbackBaseTimeMs = 0;
	clearHydratedReplayFrame();
	setReplayStatus(`Loaded replay: ${replay.frames.length} frames.`);
	syncReplayButtons();
	return replay;
}

export function getLoadedReplay() {
	return ReplayRuntime.loadedReplay;
}

export function getReplayPlaybackState(currentTime = performance.now()) {
	const replay = ReplayRuntime.loadedReplay;
	const frames = replay?.frames || [];
	const durationMs = frames.length > 0
		? Math.max(0, Number(frames[frames.length - 1].timeMs) || 0)
		: 0;
	const playbackTimeMs = replay
		? Math.min(durationMs, Math.max(0, currentPlaybackTimeMs(currentTime)))
		: 0;

	return {
		recording: ReplayRuntime.recording,
		playbackActive: ReplayRuntime.playbackActive,
		playbackPlaying: ReplayRuntime.playbackPlaying,
		playbackFrameIndex: ReplayRuntime.playbackFrameIndex,
		frameCount: frames.length,
		playbackTimeMs,
		durationMs,
		playbackSpeed: ReplayRuntime.playbackSpeed,
	};
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

	ReplayRuntime.playbackBaseTimeMs = currentPlaybackTimeMs(currentTime);
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
	clearHydratedReplayFrame();
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
		Math.max(0, currentTime - ReplayRuntime.playbackStartedAt) *
			ReplayRuntime.playbackSpeed
	);
}

function findReplayFrameIndexAtTime(frames, targetTimeMs) {
	let low = 0;
	let high = frames.length - 1;
	let result = 0;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const frameTime = Number(frames[middle]?.timeMs) || 0;

		if (frameTime <= targetTimeMs) {
			result = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	return result;
}

export function setReplayPlaybackSpeed(speed, currentTime = performance.now()) {
	const numericSpeed = Number(speed);
	if (!Number.isFinite(numericSpeed) || numericSpeed <= 0) return false;

	if (ReplayRuntime.playbackPlaying) {
		ReplayRuntime.playbackBaseTimeMs = currentPlaybackTimeMs(currentTime);
		ReplayRuntime.playbackStartedAt = currentTime;
	}

	ReplayRuntime.playbackSpeed = numericSpeed;
	return true;
}

export function seekReplayPlayback(targetTimeMs, currentTime = performance.now()) {
	const replay = ReplayRuntime.loadedReplay;
	if (!replay?.frames?.length) return false;

	const frames = replay.frames;
	const durationMs = Math.max(
		0,
		Number(frames[frames.length - 1].timeMs) || 0,
	);
	const target = Math.min(
		durationMs,
		Math.max(0, Number(targetTimeMs) || 0),
	);

	if (!ReplayRuntime.playbackActive) {
		ReplayRuntime.playbackActive = true;
	}

	ReplayRuntime.playbackBaseTimeMs = target;
	ReplayRuntime.playbackStartedAt = currentTime;
	ReplayRuntime.playbackFrameIndex = findReplayFrameIndexAtTime(frames, target);

	if (target >= durationMs && ReplayRuntime.playbackPlaying) {
		ReplayRuntime.playbackPlaying = false;
	}

	clearTrailHistory();
	clearHydratedReplayFrame();
	syncReplayButtons();
	return true;
}

export function skipReplayPlayback(deltaMs, currentTime = performance.now()) {
	const currentTimeMs = currentPlaybackTimeMs(currentTime);
	return seekReplayPlayback(currentTimeMs + (Number(deltaMs) || 0), currentTime);
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

	return hydrateReplayFrame(
		ReplayRuntime.loadedReplay,
		frames[ReplayRuntime.playbackFrameIndex],
		ReplayRuntime.playbackFrameIndex,
	);
}

// Replay trails are taken straight from already-recorded preceding snapshots,
// avoiding duplicate history entries if display FPS differs from recorded FPS.
export function getReplayTrailEntries(
	detail = getTrailDetail(),
	preserveProjectileEvents = true,
) {
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
		const hasProjectileTrailEvents =
			preserveProjectileEvents &&
			(frames[index]?.projectileTrailEvents?.length ?? 0) > 0;
		if (!isTrailDetailFrame(frameNumber, detail) && !hasProjectileTrailEvents) {
			continue;
		}

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
	replayStopRecordingBtn?.addEventListener("click", async () => {
		await stopReplayRecording();
	});

	setReplayStatus("Replay recording idle.");
	syncReplayButtons();
}
