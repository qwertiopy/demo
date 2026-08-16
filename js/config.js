export const CONFIG_STORAGE_KEY = "demoGameConfig";

export const Config = {
    CONFIG_SCHEMA_VERSION: 9,
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

    // Schema v4 introduced ten configurable player weapons.
    if (savedVersion < 4 || !Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = cloneConfig(defaultConfig.WEAPONS);
    }

    // Schema v5 adds explosive-projectile fields. Arrays replace rather than
    // deep-merge in mergeConfig(), so merge each saved weapon into its v5
    // default individually. This preserves existing weapon balance while
    // adding the new explosion fields with safe neutral defaults.
    if (savedVersion < 5 && Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) =>
                mergeConfig(defaultWeapon, savedConfig.WEAPONS[index] || {}),
        );
    }

    // Schema v6 adds the throwable flag. Merge each existing weapon into its
    // v6 default so old local saves gain throwable=false without losing any
    // of their weapon balancing.
    if (savedVersion < 6 && Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) =>
                mergeConfig(defaultWeapon, migratedConfig.WEAPONS[index] || {}),
        );
    }

    // Schema v7 adds configurable throwable duration, distance multiplier, and
    // initial throw speed. Merge defaults into each existing weapon so local
    // balancing and throwable choices are preserved.
    if (savedVersion < 7 && Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) =>
                mergeConfig(defaultWeapon, migratedConfig.WEAPONS[index] || {}),
        );
    }

    // Schema v8 replaces throwSpeed with throwDeceleration. Merge the new
    // default into each weapon, preserve all other balancing, and explicitly
    // remove the retired throwSpeed field from migrated local saves.
    if (savedVersion < 8 && Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) => {
                const migratedWeapon = mergeConfig(
                    defaultWeapon,
                    migratedConfig.WEAPONS[index] || {},
                );

                delete migratedWeapon.throwSpeed;
                return migratedWeapon;
            },
        );
    }

    // Schema v9 makes throwDeceleration a physical constant in blocks/sec² and
    // derives initial throw speed + duration from distance. The v8 field had
    // incompatible dimensionless curve semantics, so it cannot be preserved
    // safely. Replace it with the v9 default and remove retired duration/speed.
    if (savedVersion < 9 && Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) => {
                const migratedWeapon = mergeConfig(
                    defaultWeapon,
                    migratedConfig.WEAPONS[index] || {},
                );

                migratedWeapon.throwDeceleration = defaultWeapon.throwDeceleration;
                delete migratedWeapon.throwDurationMs;
                delete migratedWeapon.throwSpeed;
                return migratedWeapon;
            },
        );
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
