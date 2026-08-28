// Main-menu navigation, launch options, and game-mode selection.

import { getGameMode, getGameModes } from "./game-modes.js";
import {
	readLaunchOptions,
	resetLaunchOptions,
	writeLaunchOptions,
} from "./launch-options.js";
import {
	loadDefaultLevelDefinition,
	validateLevelDefinition,
} from "./level.js";
import { readJsonObjectFile } from "./json-file.js";
import { downloadReplay, readReplayFile, validateReplayData } from "./replay-file.js";
import { clearActiveReplay, loadActiveReplay, saveActiveReplay } from "./replay-store.js";

const tabButtons = Array.from(document.querySelectorAll("[data-menu-tab]"));
const panels = Array.from(document.querySelectorAll("[data-menu-panel]"));
const gameModeList = document.getElementById("gameModeList");
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

	for (const button of tabButtons) {
		const active = button.dataset.menuTab === tabId;
		button.classList.toggle("active", active);
		button.setAttribute("aria-current", active ? "page" : "false");
	}

	if (updateHash) history.replaceState(null, "", `#${tabId}`);
}

function renderGameModes() {
	gameModeList.textContent = "";

	for (const mode of getGameModes()) {
		const label = document.createElement("label");
		label.className = "game-mode-card";
		if (!mode.available) label.classList.add("disabled");

		const input = document.createElement("input");
		input.type = "radio";
		input.name = "gameMode";
		input.value = mode.id;
		input.disabled = !mode.available;
		input.checked = getGameMode(launchOptions.gameModeId).id === mode.id;
		input.addEventListener("change", () => {
			launchOptions.gameModeId = mode.id;
			writeLaunchOptions(launchOptions);
			updateLaunchSummary();
		});

		const copy = document.createElement("span");
		copy.className = "game-mode-copy";
		const title = document.createElement("strong");
		title.textContent = mode.label;
		const description = document.createElement("span");
		description.textContent = mode.description;
		copy.append(title, description);
		label.append(input, copy);
		gameModeList.append(label);
	}

	const architectureCard = document.createElement("div");
	architectureCard.className = "game-mode-card architecture-card";
	architectureCard.innerHTML =
		'<span class="mode-plus">+</span><span class="game-mode-copy"><strong>Future modes</strong><span>Add definitions in js/game-modes.js; the menu and runtime resolve them through the same registry.</span></span>';
	gameModeList.append(architectureCard);
}

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

	const selectedMode = document.querySelector('input[name="gameMode"]:checked');
	launchOptions = {
		gameModeId: selectedMode?.value || launchOptions.gameModeId || "sandbox",
		level: parsedLevel,
	};

	launchOptions = writeLaunchOptions(launchOptions);
	return launchOptions;
}

function updateLaunchSummary() {
	const mode = getGameMode(launchOptions.gameModeId);
	const effectiveLevel = mode.allowsEditedLevel
		? launchOptions.level
		: factoryLevelDefinition;
	const seed = effectiveLevel?.seed;
	const seedText = seed === undefined
		? "explicit level"
		: mode.id === "endless"
			? "new random seed per run"
			: `seed ${seed}`;
	launchSummary.textContent = `${mode.label} · ${seedText}${effectiveLevel?.invincibility === true ? " · Invincible" : ""}`;
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

	replaySetupStatus.textContent = message || (hasReplay ? "Replay ready." : "No active replay.");
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
		syncReplaySetupUi(activeReplay ? "Active replay loaded from browser storage." : "No active replay.");
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

for (const button of tabButtons) {
	button.addEventListener("click", () => showTab(button.dataset.menuTab));
}

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
		const importedLevel = validateLevelDefinition(
			await readJsonObjectFile(file, "level.json"),
		);
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
		const options = readLaunchOptionsFromUi();
		window.location.href = `index.html?mode=${encodeURIComponent(options.gameModeId)}`;
	} catch (error) {
		setStatus(levelStatus, error.message, true);
		showTab("level");
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
