// Replay status and button synchronization.

import {
	replayRecordBtn,
	replayStopRecordingBtn,
	replayPlayPauseBtn,
	replayStopBtn,
	replayStatus,
} from "../dom.js";
import { ReplayRuntime } from "./runtime.js";

export function setReplayStatus(message) {
	if (replayStatus) replayStatus.textContent = message;
}

export function syncReplayButtons() {
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

