import { CONFIG_STORAGE_KEY, isPlainObject, mergeConfig } from "./config.js";

let defaultConfig = null;
let config = null;

function cloneConfig(value) {
	return JSON.parse(JSON.stringify(value));
}

const VALID_STRUCTURE_FLAGS = new Set([0, 1, 2, 3, 4, 5]);

function validateStructureLibrary(structures) {
	if (!Array.isArray(structures)) {
		throw new Error("STRUCTURE_LIBRARY must be an array.");
	}

	structures.forEach((structure, structureIndex) => {
		if (!Array.isArray(structure.grid)) {
			throw new Error(
				`Structure ${structureIndex} is missing a grid array.`,
			);
		}

		structure.grid.forEach((row, rowIndex) => {
			if (!Array.isArray(row)) {
				throw new Error(
					`Structure ${structureIndex}, row ${rowIndex} must be an array.`,
				);
			}

			row.forEach((cell, columnIndex) => {
				if (!VALID_STRUCTURE_FLAGS.has(cell)) {
					throw new Error(
						`Invalid structure flag ${cell} at structure ${structureIndex}, row ${rowIndex}, column ${columnIndex}. ` +
							"Use 0=empty, 1=wall, 2=random, 3=g-bot, 4=j-bot, or 5=h-bot.",
					);
				}
			});
		});
	});
}

function readLocalConfig() {
	try {
		const savedJson = localStorage.getItem(CONFIG_STORAGE_KEY);

		if (!savedJson) {
			return null;
		}

		const savedConfig = JSON.parse(savedJson);

		if (!isPlainObject(savedConfig)) {
			throw new Error("Saved config is not a JSON object.");
		}

		return savedConfig;
	} catch (error) {
		console.warn("Could not read locally saved config:", error);

		return null;
	}
}

function saveLocalConfig() {
	localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

async function init() {
	try {
		const response = await fetch("./config.json", { cache: "no-store" });

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		defaultConfig = await response.json();

		const savedConfig = readLocalConfig();

		if (savedConfig) {
			if (
				savedConfig.CONFIG_SCHEMA_VERSION !==
				defaultConfig.CONFIG_SCHEMA_VERSION
			) {
				config = mergeConfig(defaultConfig, savedConfig);

				config.CONFIG_SCHEMA_VERSION =
					defaultConfig.CONFIG_SCHEMA_VERSION;

				config.STRUCTURE_LIBRARY = cloneConfig(
					defaultConfig.STRUCTURE_LIBRARY,
				);

				saveLocalConfig();

				showStatus(
					"Local config upgraded to type-specific enemy spawn flags.",
				);
			} else {
				config = mergeConfig(defaultConfig, savedConfig);

				showStatus("Locally saved configuration loaded.");
			}
		} else {
			config = cloneConfig(defaultConfig);

			showStatus("config.json defaults loaded. No local save yet.");
		}

		syncConfigToUI();
	} catch (error) {
		showStatus("Failed to load config.json: " + error.message, true);
	}
}

function syncConfigToUI() {
	if (!config) {
		return;
	}

	document.getElementById("cfg_PLAYER_SPEED").value =
		config.PLAYER_SPEED ?? "";

	document.getElementById("cfg_PLAYER_BULLET_SPEED").value =
		config.PLAYER_BULLET_SPEED ?? "";

	document.getElementById("cfg_PLAYER_SHOOT_COOLDOWN").value =
		config.PLAYER_SHOOT_COOLDOWN ?? "";

	document.getElementById("cfg_STRUCTURE_DENSITY_BLOCKS").value =
		config.STRUCTURE_DENSITY_BLOCKS ?? "";

	// The textarea remains fully editable JSON,
	// containing the advanced configuration sections.
	const advancedData = {
		ENEMY_TYPES: config.ENEMY_TYPES,
		STRUCTURE_LIBRARY: config.STRUCTURE_LIBRARY,
	};

	document.getElementById("cfg_ADVANCED").value = JSON.stringify(
		advancedData,
		null,
		4,
	);
}

function readConfigFromUI() {
	if (!config) {
		throw new Error("Config has not loaded yet.");
	}

	const playerSpeed = parseFloat(
		document.getElementById("cfg_PLAYER_SPEED").value,
	);

	const bulletSpeed = parseFloat(
		document.getElementById("cfg_PLAYER_BULLET_SPEED").value,
	);

	const shootCooldown = parseFloat(
		document.getElementById("cfg_PLAYER_SHOOT_COOLDOWN").value,
	);

	const structureDensity = parseFloat(
		document.getElementById("cfg_STRUCTURE_DENSITY_BLOCKS").value,
	);

	if (!Number.isFinite(playerSpeed)) {
		throw new Error("Player Speed must be a number in blocks/sec.");
	}

	if (!Number.isFinite(bulletSpeed)) {
		throw new Error("Bullet Speed must be a number in blocks/sec.");
	}

	if (!Number.isFinite(shootCooldown) || shootCooldown < 0) {
		throw new Error("Shoot Cooldown must be a non-negative number in ms.");
	}

	if (!Number.isFinite(structureDensity)) {
		throw new Error("Structure Density must be a number.");
	}

	const advancedData = JSON.parse(
		document.getElementById("cfg_ADVANCED").value,
	);

	if (!isPlainObject(advancedData)) {
		throw new Error("Advanced Configuration must be a JSON object.");
	}

	config.PLAYER_SPEED = playerSpeed;

	config.PLAYER_BULLET_SPEED = bulletSpeed;

	config.PLAYER_SHOOT_COOLDOWN = shootCooldown;

	config.STRUCTURE_DENSITY_BLOCKS = structureDensity;

	if (advancedData.ENEMY_TYPES !== undefined) {
		config.ENEMY_TYPES = advancedData.ENEMY_TYPES;
	}

	if (advancedData.STRUCTURE_LIBRARY !== undefined) {
		validateStructureLibrary(advancedData.STRUCTURE_LIBRARY);

		config.STRUCTURE_LIBRARY = advancedData.STRUCTURE_LIBRARY;
	}
}

function applyConfig() {
	try {
		readConfigFromUI();
		saveLocalConfig();

		showStatus(
			"Saved locally. Return to the game (or reload it) to use these settings.",
		);
	} catch (error) {
		showStatus("Invalid configuration: " + error.message, true);
	}
}

function exportConfig() {
	try {
		readConfigFromUI();
	} catch (error) {
		showStatus(
			"Cannot export invalid configuration: " + error.message,
			true,
		);

		return;
	}

	const blob = new Blob([JSON.stringify(config, null, 4)], {
		type: "application/json",
	});

	const url = URL.createObjectURL(blob);

	const link = document.createElement("a");

	link.href = url;
	link.download = "config.json";

	document.body.appendChild(link);
	link.click();
	link.remove();

	URL.revokeObjectURL(url);

	showStatus("config.json exported successfully.");
}

function resetConfig() {
	if (!defaultConfig) {
		showStatus("Default config has not loaded yet.", true);

		return;
	}

	localStorage.removeItem(CONFIG_STORAGE_KEY);

	config = cloneConfig(defaultConfig);

	syncConfigToUI();

	showStatus("Local save cleared. Restored config.json defaults.");
}

function showStatus(message, error = false) {
	const status = document.getElementById("statusMessage");

	status.textContent = message;
	status.classList.toggle("error", error);
}

document
	.getElementById("applyConfigBtn")
	.addEventListener("click", applyConfig);

document
	.getElementById("exportConfigBtn")
	.addEventListener("click", exportConfig);

document
	.getElementById("resetConfigBtn")
	.addEventListener("click", resetConfig);

init();
