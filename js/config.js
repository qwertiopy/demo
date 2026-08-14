// Config object + persistence (schema migration, localStorage)

// Central configuration singleton. It starts with safe defaults and is populated from config.json during initialization
export const Config = {
	PLAYER_SPEED: 0,
	PLAYER_BULLET_SPEED: 0,
	PLAYER_SHOOT_COOLDOWN: 0,
	STRUCTURE_DENSITY_BLOCKS: 0,
	ENEMY_TYPES: {},
	STRUCTURE_LIBRARY: [],
	BLOCK_SIZE_PX: 64,
	PLAYER_SIZE_BLOCKS: 0.5,
	MIN_SPAWN_DISTANCE_BLOCKS: 15,
	MAX_SPAWN_DISTANCE_BLOCKS: 25,
	RENDER_DISTANCE_FRONT: 35,
	RENDER_DISTANCE_BACK: 12,
};

// localStorage key shared with the configuration editor so customized settings survive page reloads.
export const CONFIG_STORAGE_KEY = "demoGameConfig";

// Returns true only for non-null plain object-like values; used to validate parsed saved configuration.
export function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Merge saved settings over defaults while retaining newly added defaults.
// Arrays are intentionally replaced.
// Recursively merges saved configuration over defaults while preserving newly introduced default keys. Arrays are replaced as complete values.
export function mergeConfig(base, override) {
	if (!isPlainObject(base) || !isPlainObject(override)) {
		return override;
	}

	const result = { ...base };

	for (const [key, value] of Object.entries(override)) {
		if (isPlainObject(value) && isPlainObject(base[key])) {
			result[key] = mergeConfig(base[key], value);
		} else {
			result[key] = value;
		}
	}

	return result;
}

// Loads persisted configuration, validates it, performs the existing schema migration when versions differ, and falls back to factory defaults on errors.
export function loadLocalConfig(defaultConfig) {
	try {
		const savedJson = localStorage.getItem(CONFIG_STORAGE_KEY);
		if (!savedJson) return defaultConfig;

		const savedConfig = JSON.parse(savedJson);
		if (!isPlainObject(savedConfig)) {
			throw new Error("Saved config is not a JSON object.");
		}

		// Schema v3 adds type-specific enemy spawn flags to structure grids.
		if (
			savedConfig.CONFIG_SCHEMA_VERSION !==
			defaultConfig.CONFIG_SCHEMA_VERSION
		) {
			const migratedConfig = mergeConfig(defaultConfig, savedConfig);
			migratedConfig.CONFIG_SCHEMA_VERSION =
				defaultConfig.CONFIG_SCHEMA_VERSION;
			migratedConfig.STRUCTURE_LIBRARY = defaultConfig.STRUCTURE_LIBRARY;

			localStorage.setItem(
				CONFIG_STORAGE_KEY,
				JSON.stringify(migratedConfig),
			);
			console.log(
				"Local config migrated to type-specific structure-spawn schema v3.",
			);
			return migratedConfig;
		}

		console.log("Using locally saved config.");
		return mergeConfig(defaultConfig, savedConfig);
	} catch (error) {
		console.warn(
			"Could not load local config; using config.json defaults.",
			error,
		);
		return defaultConfig;
	}
}
