export const CONFIG_STORAGE_KEY = "demoGameConfig";

export const Config = {
    CONFIG_SCHEMA_VERSION: 20,
    PLAYER_SPEED: 0,
    PLAYER_BULLET_SPEED: 0,
    WEAPONS: [],
    STRUCTURE_DENSITY_BLOCKS: 0,
    ENEMY_TYPES: {},
    STRUCTURE_LIBRARY: [],
    RENDERING: {
        CANVAS_WIDTH_PX: 1920,
        CANVAS_HEIGHT_PX: 1080,
        BLOCK_SIZE_PX: 64,
        ZOOM: 1,
        TARGET_FPS: 60,
        DISTANCE_FRONT_BLOCKS: 35,
        DISTANCE_BACK_BLOCKS: 20,
        ENVIRONMENT_OVERSCAN_BLOCKS: 2,
        CLEANUP_BUFFER_BLOCKS: 0,
        LASER_FLASH_DURATION_MS: 90,
        LASER_CALCULATION_BUDGET_PER_FRAME: 100000,
        TRAIL_LENGTH_FRAMES: 0,
        TRAIL_DETAIL: 60,
        TRAIL_QUAD_DETAIL: 30,
    },
    PLAYER_SIZE_BLOCKS: 0.5,
    MIN_SPAWN_DISTANCE_BLOCKS: 25,
    MAX_SPAWN_DISTANCE_BLOCKS: 35,
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

    // Schema v10 adds laser timing and collision-penetration settings. Merge
    // neutral defaults into existing weapons so prior local balancing is kept.
    if (savedVersion < 10 && Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) =>
                mergeConfig(defaultWeapon, migratedConfig.WEAPONS[index] || {}),
        );
    }

    // Schema v11 replaces laserCooldownMs + the old global player cooldown with
    // one per-weapon cooldownMs field. Lasers preserve their former laser-only
    // cooldown; non-lasers preserve the old global cooldown unless they already
    // had a non-zero laserCooldownMs value configured.
    if (savedVersion < 11 && Array.isArray(savedConfig.WEAPONS)) {
        const oldGlobalCooldown = Math.max(
            0,
            Number(savedConfig.PLAYER_SHOOT_COOLDOWN ?? 0) || 0,
        );

        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) => {
                const sourceWeapon = migratedConfig.WEAPONS[index] || {};
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
            },
        );

        delete migratedConfig.PLAYER_SHOOT_COOLDOWN;
    }

    // Schema v12 replaces the fixed spreadOffset field with spread, a total
    // random angular spread in radians. Preserve any old numeric value as the
    // new spread magnitude and remove the retired field.
    if (savedVersion < 12 && Array.isArray(savedConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) => {
                const sourceWeapon = migratedConfig.WEAPONS[index] || {};
                const migratedWeapon = mergeConfig(defaultWeapon, sourceWeapon);

                migratedWeapon.spread = Math.max(
                    0,
                    Number(sourceWeapon.spread ?? sourceWeapon.spreadOffset ?? defaultWeapon.spread ?? 0) || 0,
                );
                delete migratedWeapon.spreadOffset;
                return migratedWeapon;
            },
        );
    }

    // Schema v13 adds opt-in projectile/projectile collision. Merge the new
    // neutral false default into player weapons and enemy bullet definitions.
    if (savedVersion < 13) {
        if (Array.isArray(savedConfig.WEAPONS)) {
            migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
                (defaultWeapon, index) =>
                    mergeConfig(defaultWeapon, migratedConfig.WEAPONS[index] || {}),
            );
        }

        if (isPlainObject(defaultConfig.ENEMY_TYPES)) {
            const migratedEnemyTypes = {};

            for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
                migratedEnemyTypes[typeName] = mergeConfig(
                    defaultType,
                    migratedConfig.ENEMY_TYPES?.[typeName] || {},
                );
            }

            migratedConfig.ENEMY_TYPES = migratedEnemyTypes;
        }
    }

    // Schema v14 centralizes rendering/load-window settings in RENDERING.
    // Preserve the old top-level zoom/distance values when they exist, while
    // introducing the new trails setting with a neutral 0% default.
    if (savedVersion < 14) {
        const sourceRendering = isPlainObject(savedConfig.RENDERING)
            ? savedConfig.RENDERING
            : {};

        migratedConfig.RENDERING = mergeConfig(
            defaultConfig.RENDERING,
            sourceRendering,
        );

        if (savedConfig.RENDER_ZOOM !== undefined) {
            migratedConfig.RENDERING.ZOOM = Math.max(
                0.01,
                Number(savedConfig.RENDER_ZOOM) || defaultConfig.RENDERING.ZOOM,
            );
        }

        if (savedConfig.RENDER_DISTANCE_FRONT !== undefined) {
            migratedConfig.RENDERING.DISTANCE_FRONT_BLOCKS = Math.max(
                0,
                Number(savedConfig.RENDER_DISTANCE_FRONT) || 0,
            );
        }

        if (savedConfig.RENDER_DISTANCE_BACK !== undefined) {
            migratedConfig.RENDERING.DISTANCE_BACK_BLOCKS = Math.max(
                0,
                Number(savedConfig.RENDER_DISTANCE_BACK) || 0,
            );
        }

        if (savedConfig.BLOCK_SIZE_PX !== undefined) {
            migratedConfig.RENDERING.BLOCK_SIZE_PX = Math.max(
                1,
                Number(savedConfig.BLOCK_SIZE_PX) || defaultConfig.RENDERING.BLOCK_SIZE_PX,
            );
        }

        delete migratedConfig.RENDER_ZOOM;
        delete migratedConfig.RENDER_DISTANCE_FRONT;
        delete migratedConfig.RENDER_DISTANCE_BACK;
        delete migratedConfig.BLOCK_SIZE_PX;
    }


    // Schema v15 splits the old trail percentage/frame-count setting into an
    // explicit retained-history length and an independent sampling density.
    // Preserve the old v14 trail value as the new length and default detail to
    // all 60 source frames per 60-frame window.
    if (savedVersion < 15) {
        const sourceRendering = isPlainObject(savedConfig.RENDERING)
            ? savedConfig.RENDERING
            : {};
        const oldTrailFrames = Math.max(
            0,
            Math.round(Number(sourceRendering.TRAILS_PERCENT ?? 0) || 0),
        );

        migratedConfig.RENDERING = mergeConfig(
            defaultConfig.RENDERING,
            migratedConfig.RENDERING || {},
        );
        migratedConfig.RENDERING.TRAIL_LENGTH_FRAMES = oldTrailFrames;
        migratedConfig.RENDERING.TRAIL_DETAIL = 60;
        delete migratedConfig.RENDERING.TRAILS_PERCENT;
    }


    // Schema v16 adds absolute +/- variation ranges for bullet speed, radius,
    // and damage. Merge zero-variation defaults into each player weapon and
    // enemy type so existing Sandbox saves preserve their prior behaviour.
    if (savedVersion < 16) {
        if (Array.isArray(defaultConfig.WEAPONS)) {
            migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
                (defaultWeapon, index) =>
                    mergeConfig(defaultWeapon, migratedConfig.WEAPONS?.[index] || {}),
            );
        }

        if (isPlainObject(defaultConfig.ENEMY_TYPES)) {
            const migratedEnemyTypes = {};

            for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
                migratedEnemyTypes[typeName] = mergeConfig(
                    defaultType,
                    migratedConfig.ENEMY_TYPES?.[typeName] || {},
                );
            }

            migratedConfig.ENEMY_TYPES = migratedEnemyTypes;
        }
    }

    // Schema v17 adds player-projectile chaining. Merge chain=0 into existing
    // Sandbox weapons so old local saves keep identical projectile behaviour.
    if (savedVersion < 17 && Array.isArray(defaultConfig.WEAPONS)) {
        migratedConfig.WEAPONS = defaultConfig.WEAPONS.map(
            (defaultWeapon, index) =>
                mergeConfig(defaultWeapon, migratedConfig.WEAPONS?.[index] || {}),
        );
    }

    // Schema v18 adds predictive enemy aiming controls. Merge the new enemy
    // defaults into old Sandbox saves while preserving every existing stat.
    if (savedVersion < 18 && isPlainObject(defaultConfig.ENEMY_TYPES)) {
        const migratedEnemyTypes = {};

        for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
            migratedEnemyTypes[typeName] = mergeConfig(
                defaultType,
                migratedConfig.ENEMY_TYPES?.[typeName] || {},
            );
        }

        migratedConfig.ENEMY_TYPES = migratedEnemyTypes;
    }

    // Schema v19 adds committed predictive wall attacks. Merge the per-enemy
    // velocity-change threshold and wall overlap factor into old local saves.
    if (savedVersion < 19 && isPlainObject(defaultConfig.ENEMY_TYPES)) {
        const migratedEnemyTypes = {};

        for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
            migratedEnemyTypes[typeName] = mergeConfig(
                defaultType,
                migratedConfig.ENEMY_TYPES?.[typeName] || {},
            );
        }

        migratedConfig.ENEMY_TYPES = migratedEnemyTypes;
    }

    // Schema v20 prevents gap-safe spacing from making wall attacks effectively
    // endless by adding a per-enemy maximum sweep duration.
    if (savedVersion < 20 && isPlainObject(defaultConfig.ENEMY_TYPES)) {
        const migratedEnemyTypes = {};

        for (const [typeName, defaultType] of Object.entries(defaultConfig.ENEMY_TYPES)) {
            migratedEnemyTypes[typeName] = mergeConfig(
                defaultType,
                migratedConfig.ENEMY_TYPES?.[typeName] || {},
            );
        }

        migratedConfig.ENEMY_TYPES = migratedEnemyTypes;
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
