// Main-menu navigation, launch options, and game-mode selection.

import { getGameMode, getGameModes } from "./game-modes.js";
import {
	readLaunchOptions,
	resetLaunchOptions,
	writeLaunchOptions,
} from "./launch-options.js";
import { loadDefaultLevelDefinition } from "./level.js";
import { readJsonObjectFile } from "./json-file.js";
import { downloadReplay, readReplayFile, validateReplayData } from "./replay-file.js";
import { clearActiveReplay, loadActiveReplay, saveActiveReplay } from "./replay-store.js";

const setupSelect = document.getElementById("setupSelect");
const backToPlay = document.getElementById("backToPlay");
const panels = Array.from(document.querySelectorAll("[data-menu-panel]"));
const gameModeSelect = document.getElementById("gameModeSelect");
const launchGameBtn = document.getElementById("launchGameBtn");
const launchSummary = document.getElementById("launchSummary");
const levelStatus = document.getElementById("levelStatus");
const godModeToggle = document.getElementById("menuGodModeToggle");
const levelData = document.getElementById("menuLevelData");
const saveLaunchOptionsBtn = document.getElementById("saveLaunchOptionsBtn");
const resetLaunchOptionsBtn = document.getElementById("resetLaunchOptionsBtn");
const importLevelBtn = document.getElementById("importLevelBtn");
const importLevelFileInput = document.getElementById("importLevelFileInput");
const replaySetupLoadBtn = document.getElementById("replaySetupLoadBtn");
const replaySetupSaveBtn = document.getElementById("replaySetupSaveBtn");
const replaySetupPlayBtn = document.getElementById("replaySetupPlayBtn");
const replaySetupClearBtn = document.getElementById("replaySetupClearBtn");
const replaySetupFileInput = document.getElementById("replaySetupFileInput");
const replaySetupStatus = document.getElementById("replaySetupStatus");
const replaySetupTitle = document.getElementById("replaySetupTitle");
const replaySetupDetails = document.getElementById("replaySetupDetails");

let launchOptions = readLaunchOptions();
let factoryLevelDefinition = null;
let activeReplay = null;

function setStatus(target, message, isError = false) {
	if (!target) return;
	target.textContent = message;
	target.classList.toggle("error", isError);
}

function selectedTabFromHash() {
	const requested = window.location.hash.replace(/^#/, "");
	return panels.some((panel) => panel.dataset.menuPanel === requested)
		? requested
		: "play";
}

function showTab(tabId, updateHash = true) {
	for (const panel of panels) {
		panel.hidden = panel.dataset.menuPanel !== tabId;
	}

	setupSelect.value = tabId;
	backToPlay.hidden = tabId === "play";
	document.body.classList.toggle("showing-setup", tabId !== "play");

	if (updateHash) history.replaceState(null, "", `#${tabId}`);
}

function renderGameModes() {
	gameModeSelect.replaceChildren();
	for (const mode of getGameModes().filter((mode) => mode.available)) {
		const option = document.createElement("option");
		option.value = mode.id;
		option.textContent = mode.label;
		gameModeSelect.append(option);
	}
	gameModeSelect.value = getGameMode(launchOptions.gameModeId).id;
}

gameModeSelect.addEventListener("change", () => {
	try {
		launchOptions = writeLaunchOptions({ ...launchOptions, gameModeId: gameModeSelect.value });
		updateLaunchSummary();
	} catch (error) {
		setStatus(levelStatus, error.message, true);
		showTab("level");
	}
});
setupSelect.addEventListener("change", () => {
	const destination = setupSelect.value;
	if (["editor.html", "hotkeys.html", "defaults.html"].includes(destination)) {
		window.location.href = destination;
	} else {
		showTab(destination);
	}
});
backToPlay.addEventListener("click", () => showTab("play"));

function syncLaunchOptionsToUi() {
	godModeToggle.checked = launchOptions.level?.invincibility === true;
	levelData.value = launchOptions.level
		? JSON.stringify(launchOptions.level, null, 4)
		: "";
	updateLaunchSummary();
}

function readLaunchOptionsFromUi() {
	let parsedLevel;
	try {
		parsedLevel = JSON.parse(levelData.value);
	} catch (error) {
		throw new Error(`Invalid level JSON: ${error.message}`);
	}

	if (!parsedLevel || typeof parsedLevel !== "object" || Array.isArray(parsedLevel)) {
		throw new Error("Level JSON must contain one object.");
	}

	const selectedMode = gameModeSelect;
	launchOptions = {
		gameModeId: selectedMode?.value || launchOptions.gameModeId || "sandbox",
		level: parsedLevel,
	};

	launchOptions = writeLaunchOptions(launchOptions);
	return launchOptions;
}

function updateLaunchSummary() {
	const mode = getGameMode(launchOptions.gameModeId);
	const level = mode.allowsEditedLevel ? launchOptions.level : factoryLevelDefinition;
	launchSummary.textContent = level?.invincibility === true ? "Invincibility on" : "";
}

function replayDurationMs(replay) {
	const frames = replay?.frames || [];
	if (frames.length === 0) return 0;
	const lastFrame = frames.at(-1);
	const timeMs = Number(replay.replayVersion) >= 3
		? Number(lastFrame?.[0])
		: Number(lastFrame?.timeMs);
	return Math.max(0, timeMs || 0);
}

function formatReplayDuration(milliseconds) {
	const totalSeconds = milliseconds / 1000;
	if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function syncReplaySetupUi(message = "") {
	const hasReplay = Boolean(activeReplay);
	replaySetupSaveBtn.disabled = !hasReplay;
	replaySetupPlayBtn.disabled = !hasReplay;
	replaySetupClearBtn.disabled = !hasReplay;

	if (!hasReplay) {
		replaySetupTitle.textContent = "No replay loaded";
		replaySetupDetails.textContent = "Record one in-game or load a .replay file.";
	} else {
		const frameCount = activeReplay.frames.length;
		const mode = getGameMode(activeReplay.gameModeId || "sandbox").label;
		const duration = formatReplayDuration(replayDurationMs(activeReplay));
		replaySetupTitle.textContent = `${frameCount.toLocaleString()} frames · ${duration}`;
		replaySetupDetails.textContent = `Mode: ${mode} · Created: ${activeReplay.createdAt || "unknown"}`;
	}

	replaySetupStatus.textContent = message || (hasReplay ? "" : "");
	replaySetupStatus.classList.remove("error");
}

function setReplaySetupError(message) {
	replaySetupStatus.textContent = message;
	replaySetupStatus.classList.add("error");
}

async function initReplaySetup() {
	try {
		const stored = await loadActiveReplay();
		if (stored) {
			validateReplayData(stored);
			activeReplay = stored;
		}
		syncReplaySetupUi(activeReplay ? "" : "");
	} catch (error) {
		console.error("Could not initialize replay setup:", error);
		setReplaySetupError(`Replay storage failed: ${error.message}`);
	}
}

replaySetupLoadBtn?.addEventListener("click", () => replaySetupFileInput?.click());
replaySetupFileInput?.addEventListener("change", async () => {
	const file = replaySetupFileInput.files?.[0];
	replaySetupFileInput.value = "";
	if (!file) return;

	try {
		const replay = await readReplayFile(file);
		await saveActiveReplay(replay);
		activeReplay = replay;
		syncReplaySetupUi(`Loaded ${file.name}.`);
	} catch (error) {
		console.error("Replay load failed:", error);
		setReplaySetupError(`Replay load failed: ${error.message}`);
	}
});

replaySetupSaveBtn?.addEventListener("click", async () => {
	if (!activeReplay) return;
	try {
		const bytes = await downloadReplay(activeReplay);
		syncReplaySetupUi(`Saved replay (${(bytes / 1024 / 1024).toFixed(2)} MiB).`);
	} catch (error) {
		setReplaySetupError(`Replay save failed: ${error.message}`);
	}
});

replaySetupPlayBtn?.addEventListener("click", () => {
	if (!activeReplay) return;
	window.location.href = "replay.html";
});

replaySetupClearBtn?.addEventListener("click", async () => {
	try {
		await clearActiveReplay();
		activeReplay = null;
		syncReplaySetupUi("Active replay cleared.");
	} catch (error) {
		setReplaySetupError(`Could not clear replay: ${error.message}`);
	}
});


window.addEventListener("hashchange", () => showTab(selectedTabFromHash(), false));

godModeToggle.addEventListener("change", () => {
	try {
		const parsedLevel = JSON.parse(levelData.value);
		if (!parsedLevel || typeof parsedLevel !== "object" || Array.isArray(parsedLevel)) {
			return;
		}
		parsedLevel.invincibility = godModeToggle.checked;
		levelData.value = JSON.stringify(parsedLevel, null, 4);
	} catch {
		// Keep invalid JSON untouched so the normal save validation can explain it.
	}
});

levelData.addEventListener("input", () => {
	try {
		const parsedLevel = JSON.parse(levelData.value);
		godModeToggle.checked = parsedLevel?.invincibility === true;
	} catch {
		// Do not interrupt editing while the JSON is temporarily incomplete.
	}
});

saveLaunchOptionsBtn.addEventListener("click", () => {
	try {
		readLaunchOptionsFromUi();
		updateLaunchSummary();
		setStatus(levelStatus, "Launch options saved for this browser session.");
	} catch (error) {
		setStatus(levelStatus, error.message, true);
	}
});

resetLaunchOptionsBtn.addEventListener("click", async () => {
	try {
		launchOptions = resetLaunchOptions();
		factoryLevelDefinition = await loadDefaultLevelDefinition({ reload: true });
		launchOptions.level = factoryLevelDefinition;
		launchOptions = writeLaunchOptions(launchOptions);
		syncLaunchOptionsToUi();
		renderGameModes();
		setStatus(levelStatus, "Level setup reloaded from level.json.");
	} catch (error) {
		setStatus(levelStatus, `Could not reload level.json: ${error.message}`, true);
	}
});

importLevelBtn.addEventListener("click", () => importLevelFileInput.click());
importLevelFileInput.addEventListener("change", async () => {
	const file = importLevelFileInput.files?.[0];
	importLevelFileInput.value = "";
	if (!file) return;

	try {
		const importedLevel = await readJsonObjectFile(file, "level.json");
		launchOptions = writeLaunchOptions({
			...launchOptions,
			level: importedLevel,
		});
		syncLaunchOptionsToUi();
		setStatus(
			levelStatus,
			`Imported ${file.name} for Sandbox. Endless will continue using the factory level.json.`,
		);
	} catch (error) {
		setStatus(levelStatus, `Could not import level.json: ${error.message}`, true);
	}
});

launchGameBtn.addEventListener("click", () => {
	try {
		const options = getGameMode(gameModeSelect.value).allowsEditedLevel
			? readLaunchOptionsFromUi()
			: writeLaunchOptions({ ...launchOptions, gameModeId: gameModeSelect.value });
		window.location.href = `index.html?mode=${encodeURIComponent(options.gameModeId)}`;
	} catch (error) {
		setStatus(levelStatus, error.message, true);
		showTab("level");
		document.getElementById("levelJsonDetails").open = true;
	}
});

async function initMenu() {
	try {
		factoryLevelDefinition = await loadDefaultLevelDefinition();
		if (!launchOptions.level) {
			launchOptions.level = factoryLevelDefinition;
			launchOptions = writeLaunchOptions(launchOptions);
		}

		renderGameModes();
		syncLaunchOptionsToUi();
		showTab(selectedTabFromHash(), false);
		launchGameBtn.disabled = false;
		gameModeSelect.disabled = false;
	} catch (error) {
		console.error("Could not initialize level setup:", error);
		showTab("level", false);
		setStatus(levelStatus, `Could not load level.json: ${error.message}`, true);
		launchGameBtn.disabled = true;
		saveLaunchOptionsBtn.disabled = true;
	}

	initReplaySetup();
}

initMenu();
