// Public replay subsystem API.

export { captureVisualSnapshot } from "./snapshot.js";
export {
	getTrailLengthFrames,
	getTrailDetail,
	getTrailQuadDetail,
	isTrailDetailFrame,
	pushTrailSnapshot,
	clearTrailHistory,
	getLiveTrailEntries,
} from "./trails.js";
export {
	startReplayRecording,
	recordReplaySnapshot,
	stopReplayRecording,
} from "./recorder.js";
export {
	loadReplayData,
	getLoadedReplay,
	getReplayPlaybackState,
	startOrResumeReplayPlayback,
	pauseReplayPlayback,
	stopReplayPlayback,
	isReplayPlaybackActive,
	setReplayPlaybackSpeed,
	seekReplayPlayback,
	skipReplayPlayback,
	getReplaySnapshotForRender,
	getReplayTrailEntries,
} from "./playback.js";
export { initReplayControls } from "./controls.js";
