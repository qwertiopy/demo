// Replay loading, timestamp-driven playback, seeking, and replay trails.

import { GameState } from "../state.js";
import { validateReplayData } from "../replay-file.js";
import { ReplayRuntime } from "./runtime.js";
import { clearTrailHistory, getTrailDetail, getTrailLengthFrames, isTrailDetailFrame } from "./trails.js";
import { clearHydratedReplayFrame, hydrateReplayFrame } from "./hydration.js";
import { replayFrameTimeMs } from "./codec.js";
import { setReplayStatus, syncReplayButtons } from "./ui.js";

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
		? Math.max(0, replayFrameTimeMs(replay, frames[frames.length - 1]))
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
			ReplayRuntime.playbackBaseTimeMs >= replayFrameTimeMs(replay, lastFrame)
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

function findReplayFrameIndexAtTime(replay, targetTimeMs) {
	const frames = replay.frames;
	let low = 0;
	let high = frames.length - 1;
	let result = 0;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const frameTime = replayFrameTimeMs(replay, frames[middle]);

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
		replayFrameTimeMs(replay, frames[frames.length - 1]),
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
	ReplayRuntime.playbackFrameIndex = findReplayFrameIndexAtTime(replay, target);

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

	const replay = ReplayRuntime.loadedReplay;
	const frames = replay.frames;
	const playbackTimeMs = currentPlaybackTimeMs(currentTime);

	while (
		ReplayRuntime.playbackFrameIndex + 1 < frames.length &&
		replayFrameTimeMs(
			replay,
			frames[ReplayRuntime.playbackFrameIndex + 1],
		) <=
			playbackTimeMs
	) {
		ReplayRuntime.playbackFrameIndex += 1;
	}

	if (
		ReplayRuntime.playbackPlaying &&
		ReplayRuntime.playbackFrameIndex === frames.length - 1 &&
		playbackTimeMs >= replayFrameTimeMs(replay, frames[frames.length - 1])
	) {
		ReplayRuntime.playbackPlaying = false;
		ReplayRuntime.playbackBaseTimeMs = replayFrameTimeMs(
			replay,
			frames[frames.length - 1],
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

	const replay = ReplayRuntime.loadedReplay;
	const frames = replay.frames;
	const currentIndex = ReplayRuntime.playbackFrameIndex;
	const startIndex = Math.max(0, currentIndex - trailLength);
	const entries = [];

	for (let index = startIndex; index <= currentIndex; index++) {
		const snapshot = hydrateReplayFrame(replay, frames[index], index);
		const frameNumber = Number.isFinite(Number(snapshot?.frame))
			? Math.max(0, Math.floor(Number(snapshot.frame)))
			: index;
		const hasProjectileTrailEvents =
			preserveProjectileEvents &&
			(snapshot?.projectileTrailEvents?.length ?? 0) > 0;
		if (!isTrailDetailFrame(frameNumber, detail) && !hasProjectileTrailEvents) {
			continue;
		}

		const ageFrames = currentIndex - index;
		entries.push({
			snapshot,
			alpha: Math.max(0, 1 - ageFrames / trailLength),
			frameNumber,
		});
	}

	const currentSnapshot = hydrateReplayFrame(
		replay,
		frames[currentIndex],
		currentIndex,
	);
	const currentFrameNumber = Number.isFinite(Number(currentSnapshot?.frame))
		? Math.max(0, Math.floor(Number(currentSnapshot.frame)))
		: currentIndex;
	if (entries.at(-1)?.frameNumber !== currentFrameNumber) {
		entries.push({
			snapshot: currentSnapshot,
			alpha: 1,
			frameNumber: currentFrameNumber,
		});
	}

	return entries.length >= 2 ? entries : [];
}

