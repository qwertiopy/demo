import {
	COMBAT_DEFAULTS_STORAGE_KEY,
	loadFactoryCombatDefaults,
	resetLocalCombatDefaults,
	saveLocalCombatDefaults,
	validateCombatDefaults,
} from "./combat/defaults.js";
import { readJsonObjectFile } from "./json-file.js";

const data = document.getElementById("defaultsData");
const status = document.getElementById("defaultsStatus");
const fileInput = document.getElementById("importDefaultsFileInput");
let factoryDefaults = null;

function showStatus(message, isError = false) {
	status.textContent = message;
	status.classList.toggle("error", isError);
}

function readEditor() {
	const parsed = JSON.parse(data.value);
	return validateCombatDefaults(parsed);
}

function downloadJson(value) {
	const url = URL.createObjectURL(new Blob([
		JSON.stringify(value, null, 4),
	], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = "defaults.json";
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

async function init() {
	try {
		factoryDefaults = await loadFactoryCombatDefaults();
		const saved = localStorage.getItem(COMBAT_DEFAULTS_STORAGE_KEY);
		const loaded = saved ? validateCombatDefaults(JSON.parse(saved)) : factoryDefaults;
		data.value = JSON.stringify(loaded, null, 4);
		showStatus(saved ? "Local Sandbox defaults loaded." : "Factory defaults loaded.");
	} catch (error) {
		showStatus(`Could not load defaults: ${error.message}`, true);
	}
}

document.getElementById("saveDefaultsBtn").addEventListener("click", () => {
	try {
		const value = saveLocalCombatDefaults(readEditor());
		data.value = JSON.stringify(value, null, 4);
		showStatus("Saved locally for Sandbox. Endless remains factory-only.");
	} catch (error) {
		showStatus(`Invalid defaults: ${error.message}`, true);
	}
});

document.getElementById("exportDefaultsBtn").addEventListener("click", () => {
	try {
		downloadJson(readEditor());
		showStatus("defaults.json exported.");
	} catch (error) {
		showStatus(`Cannot export: ${error.message}`, true);
	}
});

document.getElementById("resetDefaultsBtn").addEventListener("click", () => {
	resetLocalCombatDefaults();
	data.value = JSON.stringify(factoryDefaults, null, 4);
	showStatus("Local defaults cleared. Factory values restored.");
});

document.getElementById("importDefaultsBtn").addEventListener("click", () =>
	fileInput.click(),
);

fileInput.addEventListener("change", async () => {
	const file = fileInput.files?.[0];
	fileInput.value = "";
	if (!file) return;
	try {
		const imported = validateCombatDefaults(
			await readJsonObjectFile(file, "defaults.json"),
		);
		saveLocalCombatDefaults(imported);
		data.value = JSON.stringify(imported, null, 4);
		showStatus(`Imported and saved ${file.name} for Sandbox.`);
	} catch (error) {
		showStatus(`Could not import defaults.json: ${error.message}`, true);
	}
});

init();
