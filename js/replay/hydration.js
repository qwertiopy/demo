// Replay frame hydration and environment attachment.

import { ReplayRuntime } from "./runtime.js";
import { environmentMapForReplay } from "./environment.js";
import {
	decodeV3Frame,
	replayFrameEnvironmentRevision,
} from "./codec.js";

const replayHydratedFrameMaps = new WeakMap();

export function hydrateReplayFrame(replay, frame, frameIndex) {
	if (!replay || !frame) return null;
	if (Number(replay.replayVersion) < 2) {
		return { ...frame, showEditorHelpers: false };
	}
	if (Number(replay.replayVersion) >= 3) {
		let frameMap = replayHydratedFrameMaps.get(replay);
		if (!frameMap) {
			frameMap = new Map();
			replayHydratedFrameMaps.set(replay, frameMap);
		}
		if (frameMap.has(frameIndex)) return frameMap.get(frameIndex);
	}

	if (
		ReplayRuntime.playbackHydratedReplay === replay &&
		ReplayRuntime.playbackHydratedFrameIndex === frameIndex &&
		ReplayRuntime.playbackHydratedSnapshot
	) {
		return ReplayRuntime.playbackHydratedSnapshot;
	}

	const dynamicSnapshot =
		Number(replay.replayVersion) >= 3
			? decodeV3Frame(replay, frame, frameIndex)
			: frame;
	const environment = environmentMapForReplay(replay)?.get(
		replayFrameEnvironmentRevision(replay, frame),
	);
	const snapshot = {
		...dynamicSnapshot,
		// Replays intentionally reproduce the clean hidden-UI view, including
		// older files that may contain recorded debug-helper state.
		showEditorHelpers: false,
		rendering: replay.rendering,
		walls: environment?.walls || [],
		enemySpawns: environment?.enemySpawns || [],
	};

	ReplayRuntime.playbackHydratedReplay = replay;
	ReplayRuntime.playbackHydratedFrameIndex = frameIndex;
	ReplayRuntime.playbackHydratedSnapshot = snapshot;
	if (Number(replay.replayVersion) >= 3) {
		replayHydratedFrameMaps.get(replay).set(frameIndex, snapshot);
	}
	return snapshot;
}

export function clearHydratedReplayFrame() {
	ReplayRuntime.playbackHydratedReplay = null;
	ReplayRuntime.playbackHydratedFrameIndex = -1;
	ReplayRuntime.playbackHydratedSnapshot = null;
}

