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

function validateWeapons(weapons) {
	if (!Array.isArray(weapons) || weapons.length !== 10) {
		throw new Error("WEAPONS must be an array containing exactly 10 weapons.");
	}

	const numericFields = [
		"speed",
		"radiusBlocks",
		"damage",
		"maxBounces",
		"spread",
		"lifetimeMs",
		"explosionRadiusBlocks",
		"detonationTimeMs",
		"explosionDurationMs",
		"explosionDamage",
		"throwDistanceMultiplier",
		"throwDeceleration",
		"laserWarmupMs",
		"cooldownMs",
		"penetrationBlocks",
	];

	weapons.forEach((weapon, index) => {
		if (!isPlainObject(weapon)) {
			throw new Error(`Weapon ${index + 1} must be a JSON object.`);
		}

		numericFields.forEach((field) => {
			if (!Number.isFinite(weapon[field])) {
				throw new Error(
					`Weapon ${index + 1}.${field} must be a finite number.`,
				);
			}
		});

		if (weapon.speed < 0) {
			throw new Error(`Weapon ${index + 1}.speed cannot be negative.`);
		}

		if (weapon.radiusBlocks <= 0) {
			throw new Error(
				`Weapon ${index + 1}.radiusBlocks must be greater than 0.`,
			);
		}

		if (weapon.maxBounces < 0 || !Number.isInteger(weapon.maxBounces)) {
			throw new Error(
				`Weapon ${index + 1}.maxBounces must be a non-negative integer.`,
			);
		}

		if (weapon.lifetimeMs < 0) {
			throw new Error(
				`Weapon ${index + 1}.lifetimeMs cannot be negative.`,
			);
		}

		for (const field of [
			"spread",
			"explosionRadiusBlocks",
			"detonationTimeMs",
			"explosionDurationMs",
			"explosionDamage",
			"throwDistanceMultiplier",
			"throwDeceleration",
			"laserWarmupMs",
			"cooldownMs",
			"penetrationBlocks",
		]) {
			if (weapon[field] < 0) {
				throw new Error(
					`Weapon ${index + 1}.${field} cannot be negative.`,
				);
			}
		}

		if (weapon.throwDeceleration <= 0) {
			throw new Error(
				`Weapon ${index + 1}.throwDeceleration must be greater than 0.`,
			);
		}

		if (typeof weapon.detonatesOnImpact !== "boolean") {
			throw new Error(
				`Weapon ${index + 1}.detonatesOnImpact must be true or false.`,
			);
		}

		if (typeof weapon.throwable !== "boolean") {
			throw new Error(
				`Weapon ${index + 1}.throwable must be true or false.`,
			);
		}

		if (typeof weapon.laser !== "boolean") {
			throw new Error(
				`Weapon ${index + 1}.laser must be true or false.`,
			);
		}

		if (typeof weapon.bulletCollision !== "boolean") {
			throw new Error(
				`Weapon ${index + 1}.bulletCollision must be true or false.`,
			);
		}

		if (typeof weapon.color !== "string" || weapon.color.length === 0) {
			throw new Error(`Weapon ${index + 1}.color must be a CSS color string.`);
		}
	});
}

function readLocalConfig() {
	try {
		const savedJson = localStorage.getItem(CONFIG_STORAGE_KEY);
		if (!savedJson) return null;

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

function migrateSavedConfig(savedConfig) {
	const savedVersion = Number(savedConfig.CONFIG_SCHEMA_VERSION) || 0;
	const migrated = mergeConfig(defaultConfig, savedConfig);

	migrated.CONFIG_SCHEMA_VERSION = defaultConfig.CONFIG_SCHEMA_VERSION;

	if (savedVersion < 3) {
		migrated.STRUCTURE_LIBRARY = cloneConfig(defaultConfig.STRUCTURE_LIBRARY);
	}

	if (savedVersion < 4 || !Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = cloneConfig(defaultConfig.WEAPONS);
	}

	if (savedVersion < 5 && Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) =>
			mergeConfig(defaultWeapon, savedConfig.WEAPONS[index] || {}),
		);
	}

	if (savedVersion < 6 && Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) =>
			mergeConfig(defaultWeapon, migrated.WEAPONS[index] || {}),
		);
	}

	if (savedVersion < 7 && Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) =>
			mergeConfig(defaultWeapon, migrated.WEAPONS[index] || {}),
		);
	}


	if (savedVersion < 8 && Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) => {
			const migratedWeapon = mergeConfig(
				defaultWeapon,
				migrated.WEAPONS[index] || {},
			);

			delete migratedWeapon.throwSpeed;
			return migratedWeapon;
		});
	}

	if (savedVersion < 9 && Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) => {
			const migratedWeapon = mergeConfig(
				defaultWeapon,
				migrated.WEAPONS[index] || {},
			);

			migratedWeapon.throwDeceleration = defaultWeapon.throwDeceleration;
			delete migratedWeapon.throwDurationMs;
			delete migratedWeapon.throwSpeed;
			return migratedWeapon;
		});
	}

	if (savedVersion < 10 && Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) =>
			mergeConfig(defaultWeapon, migrated.WEAPONS[index] || {}),
		);
	}

	if (savedVersion < 11 && Array.isArray(savedConfig.WEAPONS)) {
		const oldGlobalCooldown = Math.max(
			0,
			Number(savedConfig.PLAYER_SHOOT_COOLDOWN ?? 0) || 0,
		);

		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) => {
			const sourceWeapon = migrated.WEAPONS[index] || {};
			const oldLaserCooldown = Math.max(
				0,
				Number(sourceWeapon.laserCooldownMs ?? 0) || 0,
			);
			const migratedWeapon = mergeConfig(defaultWeapon, sourceWeapon);

			migratedWeapon.cooldownMs = sourceWeapon.laser === true
				? oldLaserCooldown
				: oldLaserCooldown > 0
					? oldLaserCooldown
					: oldGlobalCooldown;

			delete migratedWeapon.laserCooldownMs;
			return migratedWeapon;
		});

		delete migrated.PLAYER_SHOOT_COOLDOWN;
	}

	if (savedVersion < 12 && Array.isArray(savedConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) => {
			const sourceWeapon = migrated.WEAPONS[index] || {};
			const migratedWeapon = mergeConfig(defaultWeapon, sourceWeapon);

			migratedWeapon.spread = Math.max(
				0,
				Number(sourceWeapon.spread ?? sourceWeapon.spreadOffset ?? defaultWeapon.spread ?? 0) || 0,
			);
			delete migratedWeapon.spreadOffset;
			return migratedWeapon;
		});
	}

	if (savedVersion < 13) {
		if (Array.isArray(savedConfig.WEAPONS)) {
			migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) =>
				mergeConfig(defaultWeapon, migrated.WEAPONS[index] || {}),
			);
		}

		if (isPlainObject(defaultConfig.ENEMY_TYPES)) {
			const migratedEnemyTypes = {};

			for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
				migratedEnemyTypes[typeName] = mergeConfig(
					defaultType,
					migrated.ENEMY_TYPES?.[typeName] || {},
				);
			}

			migrated.ENEMY_TYPES = migratedEnemyTypes;
		}
	}

	return migrated;
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
				config = migrateSavedConfig(savedConfig);
				saveLocalConfig();
				showStatus(
					"Local config upgraded to the latest weapon schema while preserving existing settings.",
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
	if (!config) return;

	document.getElementById("cfg_PLAYER_SPEED").value =
		config.PLAYER_SPEED ?? "";

	document.getElementById("cfg_PLAYER_BULLET_SPEED").value =
		config.PLAYER_BULLET_SPEED ?? "";

	document.getElementById("cfg_RENDER_ZOOM").value =
		config.RENDER_ZOOM ?? 1;

	document.getElementById("cfg_STRUCTURE_DENSITY_BLOCKS").value =
		config.STRUCTURE_DENSITY_BLOCKS ?? "";

	const advancedData = {
		WEAPONS: config.WEAPONS,
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
	const renderZoom = parseFloat(
		document.getElementById("cfg_RENDER_ZOOM").value,
	);
	const structureDensity = parseFloat(
		document.getElementById("cfg_STRUCTURE_DENSITY_BLOCKS").value,
	);

	if (!Number.isFinite(playerSpeed)) {
		throw new Error("Player Speed must be a number in blocks/sec.");
	}

	if (!Number.isFinite(bulletSpeed)) {
		throw new Error("Fallback Bullet Speed must be a number in blocks/sec.");
	}

	if (!Number.isFinite(renderZoom) || renderZoom <= 0) {
		throw new Error("Render Zoom must be a number greater than 0.");
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
	config.RENDER_ZOOM = renderZoom;
	config.STRUCTURE_DENSITY_BLOCKS = structureDensity;

	if (advancedData.WEAPONS !== undefined) {
		validateWeapons(advancedData.WEAPONS);
		config.WEAPONS = advancedData.WEAPONS;
	}

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
