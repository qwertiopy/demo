export const CONFIG_STORAGE_KEY = "demoGameConfig";

export const Config = {
    CONFIG_SCHEMA_VERSION: 4,
    PLAYER_SPEED: 0,
    PLAYER_BULLET_SPEED: 0,
    PLAYER_SHOOT_COOLDOWN: 0,
    WEAPONS: [],
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

function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
}

function migrateConfig(defaultConfig, savedConfig) {
    const savedVersion = Number(savedConfig.CONFIG_SCHEMA_VERSION) || 0;
    const migratedConfig = mergeConfig(defaultConfig, savedConfig);

    migratedConfig.CONFIG_SCHEMA_VERSION = defaultConfig.CONFIG_SCHEMA_VERSION;

    // Schema v3 introduced the current type-specific structure flags. Very old
    // local saves may still contain the pre-v3 structure format, so only those
    // old saves have their structure library replaced.
    if (savedVersion < 3) {
        migratedConfig.STRUCTURE_LIBRARY = cloneConfig(
            defaultConfig.STRUCTURE_LIBRARY,
        );
    }

    // Schema v4 introduces ten configurable player weapons. Existing local
    // config values are preserved while the new weapon list comes from the
    // current config.json defaults.
    if (savedVersion < 4 || !Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = cloneConfig(defaultConfig.WEAPONS);
    }

    return migratedConfig;
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
            const migratedConfig = migrateConfig(defaultConfig, savedConfig);

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
