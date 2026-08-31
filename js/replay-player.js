// Dedicated replay-only runtime. It renders recorded visual snapshots and never
// starts live gameplay simulation, procedural generation, AI, or player input.

import { Config } from "./config.js";
import { draw } from "./render.js";
import { syncRespawnButton } from "./runtime/game-ui.js";
import {
	getReplayPlaybackState,
	getReplaySnapshotForRender,
	getReplayTrailEntries,
	getTrailQuadDetail,
	loadReplayData,
	pauseReplayPlayback,
	seekReplayPlayback,
	setReplayPlaybackSpeed,
	skipReplayPlayback,
	startOrResumeReplayPlayback,
	stopReplayPlayback,
} from "./replay.js";
import { validateReplayData } from "./replay-file.js";
import { loadActiveReplay } from "./replay-store.js";

const SKIP_INTERVAL_MS = 5000;

const playPauseBtn = document.getElementById("replayPlayPauseBtn");
const stopBtn = document.getElementById("replayStopBtn");
const rewindBtn = document.getElementById("replayRewindBtn");
const skipBtn = document.getElementById("replaySkipBtn");
const hideUiBtn = document.getElementById("replayHideUiBtn");
const speedSelect = document.getElementById("replaySpeedSelect");
const timeline = document.getElementById("replayTimeline");
const frameLabel = document.getElementById("replayPlayerFrame");
const timeLabel = document.getElementById("replayPlayerTime");
const status = document.getElementById("replayStatus");

let activeReplay = null;
let uiHidden = false;

function formatTime(milliseconds) {
	const totalSeconds = Math.max(0, milliseconds) / 1000;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const secondsText = seconds.toFixed(1).padStart(4, "0");

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${secondsText.padStart(4, "0")}`;
	}

	return `${minutes}:${secondsText}`;
}

function setUiHidden(hidden) {
	uiHidden = hidden;
	document.body.classList.toggle("replay-ui-hidden", uiHidden);
	if (!uiHidden) hideUiBtn.focus({ preventScroll: true });
}

function toggleUi() {
	setUiHidden(!uiHidden);
}

function syncControls(currentTime = performance.now()) {
	const state = getReplayPlaybackState(currentTime);

	frameLabel.textContent = state.frameCount > 0
		? `Frame ${state.playbackFrameIndex + 1} / ${state.frameCount}`
		: "Frame -- / --";
	timeLabel.textContent = `${formatTime(state.playbackTimeMs)} / ${formatTime(state.durationMs)}`;

	timeline.max = String(Math.max(1, state.durationMs));
	timeline.value = String(Math.min(state.durationMs, state.playbackTimeMs));
	timeline.disabled = state.frameCount === 0;

	speedSelect.value = String(state.playbackSpeed);
	playPauseBtn.textContent = state.playbackPlaying ? "Pause" : "Play";
}

function renderCurrentFrame(currentTime = performance.now()) {
	const snapshot = getReplaySnapshotForRender(currentTime);
	if (snapshot) {
		const quadTrailDetail = getTrailQuadDetail();
		draw(snapshot, getReplayTrailEntries(), {
			replayActive: true,
			quadTrailEntries: getReplayTrailEntries(quadTrailDetail),
			playerTrailEntries:
				quadTrailDetail > 0 ? getReplayTrailEntries(60, false) : [],
		});
		syncRespawnButton(snapshot, { replayActive: true });
	}
	syncControls(currentTime);
}

function renderLoop(currentTime) {
	renderCurrentFrame(currentTime);
	requestAnimationFrame(renderLoop);
}

function resetToFirstFrame(currentTime = performance.now()) {
	if (!activeReplay) return;
	stopReplayPlayback();
	loadReplayData(activeReplay);
	startOrResumeReplayPlayback(currentTime);
	pauseReplayPlayback(currentTime);
	seekReplayPlayback(0, currentTime);
	renderCurrentFrame(currentTime);
}

function togglePlayback() {
	const currentTime = performance.now();
	const state = getReplayPlaybackState(currentTime);
	if (state.playbackPlaying) pauseReplayPlayback(currentTime);
	else startOrResumeReplayPlayback(currentTime);
	syncControls(currentTime);
}

function skipBy(deltaMs) {
	const currentTime = performance.now();
	skipReplayPlayback(deltaMs, currentTime);
	renderCurrentFrame(currentTime);
}

playPauseBtn.addEventListener("click", togglePlayback);
stopBtn.addEventListener("click", () => resetToFirstFrame());
rewindBtn.addEventListener("click", () => skipBy(-SKIP_INTERVAL_MS));
skipBtn.addEventListener("click", () => skipBy(SKIP_INTERVAL_MS));
hideUiBtn.addEventListener("click", toggleUi);

speedSelect.addEventListener("change", () => {
	const currentTime = performance.now();
	setReplayPlaybackSpeed(Number(speedSelect.value), currentTime);
	syncControls(currentTime);
});

timeline.addEventListener("input", () => {
	const currentTime = performance.now();
	seekReplayPlayback(Number(timeline.value), currentTime);
	renderCurrentFrame(currentTime);
});

document.addEventListener("keydown", (event) => {
	if (event.key.toLowerCase() === "h") {
		event.preventDefault();
		toggleUi();
		return;
	}

	if (uiHidden && event.key === "Escape") {
		event.preventDefault();
		setUiHidden(false);
		return;
	}

	const tagName = event.target?.tagName?.toLowerCase();
	if (tagName === "input" || tagName === "select") {
		return;
	}

	if (event.code === "Space") {
		if (tagName === "button" || tagName === "a") return;
		event.preventDefault();
		togglePlayback();
	} else if (event.key === "ArrowLeft") {
		event.preventDefault();
		skipBy(-SKIP_INTERVAL_MS);
	} else if (event.key === "ArrowRight") {
		event.preventDefault();
		skipBy(SKIP_INTERVAL_MS);
	}
});

async function initReplayPlayer() {
	try {
		const replay = await loadActiveReplay();
		validateReplayData(replay);
		activeReplay = replay;

		if (replay.config && typeof replay.config === "object") {
			Object.assign(Config, replay.config);
		}
		Config.RENDERING = {
			...(Config.RENDERING || {}),
			...(replay.rendering || replay.frames[0]?.rendering || {}),
		};

		loadReplayData(replay);
		setReplayPlaybackSpeed(1);
		startOrResumeReplayPlayback(performance.now());
		playPauseBtn.disabled = false;
		stopBtn.disabled = false;
		rewindBtn.disabled = false;
		skipBtn.disabled = false;
		speedSelect.disabled = false;
		timeline.disabled = false;
		status.textContent = "Playing replay. Space: play/pause · ←/→: rewind/skip 5s · H: hide UI.";
		requestAnimationFrame(renderLoop);
	} catch (error) {
		console.error("Could not start replay player:", error);
		status.textContent = `Replay player failed: ${error.message}. Return to Replay Setup and load a replay.`;
		playPauseBtn.disabled = true;
		stopBtn.disabled = true;
		rewindBtn.disabled = true;
		skipBtn.disabled = true;
		speedSelect.disabled = true;
		timeline.disabled = true;
	}
}

initReplayPlayer();
