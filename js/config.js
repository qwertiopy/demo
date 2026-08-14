export const CONFIG_STORAGE_KEY = "demoGameConfig";

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

export function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

export function loadLocalConfig(defaultConfig) {
	try {
		const savedJson = localStorage.getItem(CONFIG_STORAGE_KEY);

		if (!savedJson) {
			return defaultConfig;
		}

		const savedConfig = JSON.parse(savedJson);

		if (!isPlainObject(savedConfig)) {
			throw new Error("Saved config is not a JSON object.");
		}

		if (
			savedConfig.CONFIG_SCHEMA_VERSION !==
			defaultConfig.CONFIG_SCHEMA_VERSION
		) {
			const migratedConfig = mergeConfig(defaultConfig, savedConfig);

			migratedConfig.CONFIG_SCHEMA_VERSION =
				defaultConfig.CONFIG_SCHEMA_VERSION;

			migratedConfig.STRUCTURE_LIBRARY = structuredClone(
				defaultConfig.STRUCTURE_LIBRARY,
			);

			localStorage.setItem(
				CONFIG_STORAGE_KEY,
				JSON.stringify(migratedConfig),
			);

			return migratedConfig;
		}

		return mergeConfig(defaultConfig, savedConfig);
	} catch (error) {
		console.warn(
			"Could not load local config; using config.json defaults.",
			error,
		);

		return defaultConfig;
	}
}

window.Config = Config;
