import { CONFIG_STORAGE_KEY, isPlainObject, mergeConfig } from "./config.js";

let defaultConfig = null;
let config = null;

function cloneConfig(value) {
	return JSON.parse(JSON.stringify(value));
}

const VALID_STRUCTURE_FLAGS = new Set([0, 1, 2, 3, 4, 5]);

function normalizeWeaponOptionalStats(weapon) {
	if (!isPlainObject(weapon)) return weapon;
	return {
		...weapon,
		bulletCount: weapon.bulletCount === undefined ? 1 : weapon.bulletCount,
		speedVariation:
			weapon.speedVariation === undefined ? 0 : weapon.speedVariation,
		radiusVariation:
			weapon.radiusVariation === undefined ? 0 : weapon.radiusVariation,
		damageVariation:
			weapon.damageVariation === undefined ? 0 : weapon.damageVariation,
		chain: weapon.chain === undefined ? 0 : weapon.chain,
	};
}

function normalizeWeaponOptionalStatsList(weapons) {
	if (!Array.isArray(weapons)) return weapons;
	return weapons.map((weapon) => normalizeWeaponOptionalStats(weapon));
}

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

function validateEnemyPredictionStats(enemyTypes) {
	if (!isPlainObject(enemyTypes)) {
		throw new Error("ENEMY_TYPES must be a JSON object.");
	}

	for (const [typeName, enemy] of Object.entries(enemyTypes)) {
		if (!isPlainObject(enemy)) {
			throw new Error(`ENEMY_TYPES.${typeName} must be a JSON object.`);
		}

		for (const field of [
			"spread",
			"predictionVariationThreshold",
			"predictionVariation",
			"wallVelocityChangeThreshold",
			"wallGapSafetyFactor",
			"wallMaxDurationMs",
		]) {
			if (!Number.isFinite(enemy[field]) || enemy[field] < 0) {
				throw new Error(
					`ENEMY_TYPES.${typeName}.${field} must be a non-negative finite number.`,
				);
			}
		}

		if (enemy.wallGapSafetyFactor > 1) {
			throw new Error(
				`ENEMY_TYPES.${typeName}.wallGapSafetyFactor must not exceed 1.`,
			);
		}

		if (enemy.wallMaxDurationMs <= 0) {
			throw new Error(
				`ENEMY_TYPES.${typeName}.wallMaxDurationMs must be greater than 0.`,
			);
		}
	}
}

function validateWeapons(weapons) {
	if (!Array.isArray(weapons) || weapons.length !== 10) {
		throw new Error("WEAPONS must be an array containing exactly 10 weapons.");
	}

	const numericFields = [
		"speed",
		"speedVariation",
		"radiusBlocks",
		"radiusVariation",
		"damage",
		"damageVariation",
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
		"bulletCount",
		"chain",
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

		for (const field of [
			"speedVariation",
			"radiusVariation",
			"damageVariation",
		]) {
			if (weapon[field] < 0) {
				throw new Error(
					`Weapon ${index + 1}.${field} cannot be negative.`,
				);
			}
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

		if (weapon.bulletCount < 1 || !Number.isInteger(weapon.bulletCount)) {
			throw new Error(
				`Weapon ${index + 1}.bulletCount must be an integer greater than or equal to 1.`,
			);
		}

		if (weapon.chain < 0 || !Number.isInteger(weapon.chain)) {
			throw new Error(
				`Weapon ${index + 1}.chain must be a non-negative integer.`,
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

	if (savedVersion < 14) {
		const sourceRendering = isPlainObject(savedConfig.RENDERING)
			? savedConfig.RENDERING
			: {};

		migrated.RENDERING = mergeConfig(
			defaultConfig.RENDERING,
			sourceRendering,
		);

		if (savedConfig.RENDER_ZOOM !== undefined) {
			migrated.RENDERING.ZOOM = Math.max(
				0.01,
				Number(savedConfig.RENDER_ZOOM) || defaultConfig.RENDERING.ZOOM,
			);
		}

		if (savedConfig.RENDER_DISTANCE_FRONT !== undefined) {
			migrated.RENDERING.DISTANCE_FRONT_BLOCKS = Math.max(
				0,
				Number(savedConfig.RENDER_DISTANCE_FRONT) || 0,
			);
		}

		if (savedConfig.RENDER_DISTANCE_BACK !== undefined) {
			migrated.RENDERING.DISTANCE_BACK_BLOCKS = Math.max(
				0,
				Number(savedConfig.RENDER_DISTANCE_BACK) || 0,
			);
		}

		if (savedConfig.BLOCK_SIZE_PX !== undefined) {
			migrated.RENDERING.BLOCK_SIZE_PX = Math.max(
				1,
				Number(savedConfig.BLOCK_SIZE_PX) || defaultConfig.RENDERING.BLOCK_SIZE_PX,
			);
		}

		delete migrated.RENDER_ZOOM;
		delete migrated.RENDER_DISTANCE_FRONT;
		delete migrated.RENDER_DISTANCE_BACK;
		delete migrated.BLOCK_SIZE_PX;
	}

	// Schema v16 adds zero-default absolute variation ranges. Arrays replace in
	// mergeConfig(), so merge each existing weapon/type with its new defaults.
	if (savedVersion < 16) {
		if (Array.isArray(defaultConfig.WEAPONS)) {
			migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) =>
				mergeConfig(defaultWeapon, migrated.WEAPONS?.[index] || {}),
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

	// Schema v17 adds chain=0 to every player weapon. Merge the new neutral
	// default into existing local Sandbox configs without changing balance.
	if (savedVersion < 17 && Array.isArray(defaultConfig.WEAPONS)) {
		migrated.WEAPONS = defaultConfig.WEAPONS.map((defaultWeapon, index) =>
			mergeConfig(defaultWeapon, migrated.WEAPONS?.[index] || {}),
		);
	}

	// Schema v18 adds predictive enemy aiming controls.
	if (savedVersion < 18 && isPlainObject(defaultConfig.ENEMY_TYPES)) {
		const migratedEnemyTypes = {};

		for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
			migratedEnemyTypes[typeName] = mergeConfig(
				defaultType,
				migrated.ENEMY_TYPES?.[typeName] || {},
			);
		}

		migrated.ENEMY_TYPES = migratedEnemyTypes;
	}

	// Schema v19 adds committed predictive wall attacks.
	if (savedVersion < 19 && isPlainObject(defaultConfig.ENEMY_TYPES)) {
		const migratedEnemyTypes = {};

		for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
			migratedEnemyTypes[typeName] = mergeConfig(
				defaultType,
				migrated.ENEMY_TYPES?.[typeName] || {},
			);
		}

		migrated.ENEMY_TYPES = migratedEnemyTypes;
	}

	// Schema v20 adds a maximum committed-wall duration.
	if (savedVersion < 20 && isPlainObject(defaultConfig.ENEMY_TYPES)) {
		const migratedEnemyTypes = {};

		for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
			migratedEnemyTypes[typeName] = mergeConfig(
				defaultType,
				migrated.ENEMY_TYPES?.[typeName] || {},
			);
		}

		migrated.ENEMY_TYPES = migratedEnemyTypes;
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

		config.WEAPONS = normalizeWeaponOptionalStatsList(config.WEAPONS);
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

	const rendering = config.RENDERING || {};
	document.getElementById("cfg_RENDER_CANVAS_WIDTH_PX").value =
		rendering.CANVAS_WIDTH_PX ?? 1920;
	document.getElementById("cfg_RENDER_CANVAS_HEIGHT_PX").value =
		rendering.CANVAS_HEIGHT_PX ?? 1080;
	document.getElementById("cfg_RENDER_BLOCK_SIZE_PX").value =
		rendering.BLOCK_SIZE_PX ?? 64;
	document.getElementById("cfg_RENDER_ZOOM").value = rendering.ZOOM ?? 1;
	document.getElementById("cfg_RENDER_TARGET_FPS").value =
		rendering.TARGET_FPS ?? 60;
	document.getElementById("cfg_RENDER_DISTANCE_FRONT_BLOCKS").value =
		rendering.DISTANCE_FRONT_BLOCKS ?? 35;
	document.getElementById("cfg_RENDER_DISTANCE_BACK_BLOCKS").value =
		rendering.DISTANCE_BACK_BLOCKS ?? 20;
	document.getElementById("cfg_RENDER_ENVIRONMENT_OVERSCAN_BLOCKS").value =
		rendering.ENVIRONMENT_OVERSCAN_BLOCKS ?? 2;
	document.getElementById("cfg_RENDER_CLEANUP_BUFFER_BLOCKS").value =
		rendering.CLEANUP_BUFFER_BLOCKS ?? 0;
	document.getElementById("cfg_RENDER_LASER_FLASH_DURATION_MS").value =
		rendering.LASER_FLASH_DURATION_MS ?? 90;
	document.getElementById("cfg_RENDER_LASER_CALCULATION_BUDGET_PER_FRAME").value =
		rendering.LASER_CALCULATION_BUDGET_PER_FRAME ?? 100000;
	document.getElementById("cfg_RENDER_TRAIL_LENGTH_FRAMES").value =
		rendering.TRAIL_LENGTH_FRAMES ?? 0;
	document.getElementById("cfg_RENDER_TRAIL_DETAIL").value =
		rendering.TRAIL_DETAIL ?? 60;
	document.getElementById("cfg_RENDER_TRAIL_QUAD_DETAIL").value =
		rendering.TRAIL_QUAD_DETAIL ?? 30;

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
	const canvasWidthPx = parseFloat(
		document.getElementById("cfg_RENDER_CANVAS_WIDTH_PX").value,
	);
	const canvasHeightPx = parseFloat(
		document.getElementById("cfg_RENDER_CANVAS_HEIGHT_PX").value,
	);
	const blockSizePx = parseFloat(
		document.getElementById("cfg_RENDER_BLOCK_SIZE_PX").value,
	);
	const renderZoom = parseFloat(
		document.getElementById("cfg_RENDER_ZOOM").value,
	);
	const targetFps = parseFloat(
		document.getElementById("cfg_RENDER_TARGET_FPS").value,
	);
	const renderDistanceFront = parseFloat(
		document.getElementById("cfg_RENDER_DISTANCE_FRONT_BLOCKS").value,
	);
	const renderDistanceBack = parseFloat(
		document.getElementById("cfg_RENDER_DISTANCE_BACK_BLOCKS").value,
	);
	const environmentOverscan = parseFloat(
		document.getElementById("cfg_RENDER_ENVIRONMENT_OVERSCAN_BLOCKS").value,
	);
	const cleanupBuffer = parseFloat(
		document.getElementById("cfg_RENDER_CLEANUP_BUFFER_BLOCKS").value,
	);
	const laserFlashDurationMs = parseFloat(
		document.getElementById("cfg_RENDER_LASER_FLASH_DURATION_MS").value,
	);
	const laserCalculationBudgetPerFrame = parseFloat(
		document.getElementById("cfg_RENDER_LASER_CALCULATION_BUDGET_PER_FRAME").value,
	);
	const trailLengthFrames = parseFloat(
		document.getElementById("cfg_RENDER_TRAIL_LENGTH_FRAMES").value,
	);
	const trailDetail = parseFloat(
		document.getElementById("cfg_RENDER_TRAIL_DETAIL").value,
	);
	const trailQuadDetail = parseFloat(
		document.getElementById("cfg_RENDER_TRAIL_QUAD_DETAIL").value,
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

	if (!Number.isInteger(canvasWidthPx) || canvasWidthPx <= 0) {
		throw new Error("Canvas Width must be a positive integer.");
	}

	if (!Number.isInteger(canvasHeightPx) || canvasHeightPx <= 0) {
		throw new Error("Canvas Height must be a positive integer.");
	}

	if (!Number.isFinite(blockSizePx) || blockSizePx <= 0) {
		throw new Error("Block Size must be a number greater than 0.");
	}

	if (!Number.isFinite(renderZoom) || renderZoom <= 0) {
		throw new Error("Render Zoom must be a number greater than 0.");
	}

	if (!Number.isInteger(targetFps) || targetFps <= 0) {
		throw new Error("Target FPS must be a positive integer.");
	}

	if (
		!Number.isInteger(laserCalculationBudgetPerFrame) ||
		laserCalculationBudgetPerFrame <= 0
	) {
		throw new Error("Laser Calculation Budget / Frame must be a positive integer.");
	}

	for (const [label, value] of [
		["Front Render Distance", renderDistanceFront],
		["Back Render Distance", renderDistanceBack],
		["Environment Overscan", environmentOverscan],
		["Cleanup Buffer", cleanupBuffer],
		["Laser Flash Duration", laserFlashDurationMs],
	]) {
		if (!Number.isFinite(value) || value < 0) {
			throw new Error(`${label} must be a non-negative number.`);
		}
	}

	if (!Number.isInteger(trailLengthFrames) || trailLengthFrames < 0) {
		throw new Error("Trail Length must be a non-negative integer frame count.");
	}

	if (!Number.isInteger(trailDetail) || trailDetail < 0 || trailDetail > 60) {
		throw new Error("Trail Detail must be an integer between 0 and 60.");
	}

	if (
		!Number.isInteger(trailQuadDetail) ||
		trailQuadDetail < 0 ||
		trailQuadDetail > 60
	) {
		throw new Error("Quad Trail Detail must be an integer between 0 and 60.");
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
	config.RENDERING = {
		CANVAS_WIDTH_PX: canvasWidthPx,
		CANVAS_HEIGHT_PX: canvasHeightPx,
		BLOCK_SIZE_PX: blockSizePx,
		ZOOM: renderZoom,
		TARGET_FPS: targetFps,
		DISTANCE_FRONT_BLOCKS: renderDistanceFront,
		DISTANCE_BACK_BLOCKS: renderDistanceBack,
		ENVIRONMENT_OVERSCAN_BLOCKS: environmentOverscan,
		CLEANUP_BUFFER_BLOCKS: cleanupBuffer,
		LASER_FLASH_DURATION_MS: laserFlashDurationMs,
		LASER_CALCULATION_BUDGET_PER_FRAME: laserCalculationBudgetPerFrame,
		TRAIL_LENGTH_FRAMES: trailLengthFrames,
		TRAIL_DETAIL: trailDetail,
		TRAIL_QUAD_DETAIL: trailQuadDetail,
	};
	config.STRUCTURE_DENSITY_BLOCKS = structureDensity;

	if (advancedData.WEAPONS !== undefined) {
		const normalizedWeapons = normalizeWeaponOptionalStatsList(advancedData.WEAPONS);
		validateWeapons(normalizedWeapons);
		config.WEAPONS = normalizedWeapons;
	}

	if (advancedData.ENEMY_TYPES !== undefined) {
		validateEnemyPredictionStats(advancedData.ENEMY_TYPES);
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
	config.WEAPONS = normalizeWeaponOptionalStatsList(config.WEAPONS);
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
