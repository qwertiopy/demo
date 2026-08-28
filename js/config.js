import {
	resolveProjectileDefinition,
	validateBaseProjectile,
} from "./combat/projectile-schema.js";
import { validateRenderedShapeDefinition } from "./combat/shapes.js";

export const CONFIG_STORAGE_KEY = "demoGameConfig";

export const Config = {
    CONFIG_SCHEMA_VERSION: 23,
    PLAYER_SPEED: 0,
    BASE_PROJECTILE: {},
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
        TRAIL_LENGTH_FRAMES: 0,
        TRAIL_DETAIL: 60,
        TRAIL_QUAD_DETAIL: 30,
    },
    DEBUG: {
        MAX_DRAWS_PER_FRAME: 1000,
        SHOW_FPS: true,
        SHOW_TARGET_FPS: true,
        SHOW_MS_PER_TICK: true,
        SHOW_ENTITY_COUNT: true,
        SHOW_ENEMY_COUNT: true,
        SHOW_BULLET_COUNT: true,
        DRAW_GRID_COORDINATES: true,
        DRAW_ENEMY_SPAWNS: true,
        DRAW_ENEMY_AIM_MAXIMUM_CONE: true,
        DRAW_ENEMY_AIM_VISIBILITY_REGION: true,
        DRAW_ENEMY_AIM_VISIBLE_INTERVAL: true,
        DRAW_ENEMY_AIM_BOUNDARY_POINTS: true,
        DRAW_ENEMY_AIM_LEAD_ANGLE: true,
        DRAW_ENEMY_AIM_CACHED_CORNER: true,
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
		if (["__proto__", "prototype", "constructor"].includes(key)) {
			throw new Error(`Unsafe configuration field ${key} is not allowed.`);
		}
        if (isPlainObject(value) && isPlainObject(base[key])) {
            result[key] = mergeConfig(base[key], value);
        } else {
            result[key] = value;
        }
    }

    return result;
}

function rejectUnknownObjectKeys(value, template, path) {
	if (!isPlainObject(value) || !isPlainObject(template)) return;
	for (const key of Object.keys(value)) {
		if (["__proto__", "prototype", "constructor"].includes(key)) {
			throw new Error(`${path}.${key} is unsafe.`);
		}
		if (!(key in template)) {
			throw new Error(`${path}.${key} is not recognised by this schema.`);
		}
	}
}

function requireFinite(path, value, minimum = -Infinity) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric < minimum) {
		throw new Error(`${path} must be a finite number >= ${minimum}.`);
	}
	return numeric;
}

const ENEMY_FIELDS = new Set([
	"sizeBlocks",
	"speed",
	"hp",
	"color",
	"shape",
	"ai",
	"maximumProjectileCount",
	"weapons",
	"upgrades",
	"predictionVariationThreshold",
	"predictionVariation",
	"wallVelocityChangeThreshold",
	"wallGapSafetyFactor",
	"wallMaxDurationMs",
]);

function validateStructureLibrary(structures) {
	for (const [index, structure] of structures.entries()) {
		if (!isPlainObject(structure)) {
			throw new Error(`config.STRUCTURE_LIBRARY[${index}] must be an object.`);
		}
		rejectUnknownObjectKeys(
			structure,
			{ type: true, widthBlocks: true, heightBlocks: true, color: true, grid: true },
			`config.STRUCTURE_LIBRARY[${index}]`,
		);
		requireFinite(`config.STRUCTURE_LIBRARY[${index}].widthBlocks`, structure.widthBlocks, 1);
		requireFinite(`config.STRUCTURE_LIBRARY[${index}].heightBlocks`, structure.heightBlocks, 1);
		if (!Array.isArray(structure.grid) || structure.grid.length === 0) {
			throw new Error(`config.STRUCTURE_LIBRARY[${index}].grid must be a non-empty array.`);
		}
		for (const [rowIndex, row] of structure.grid.entries()) {
			if (!Array.isArray(row) || row.length === 0) {
				throw new Error(`config.STRUCTURE_LIBRARY[${index}].grid[${rowIndex}] is invalid.`);
			}
			for (const cell of row) requireFinite(
				`config.STRUCTURE_LIBRARY[${index}].grid[${rowIndex}] cell`,
				cell,
				0,
			);
		}
	}
}

export function validateCompleteConfig(config, template = config) {
	if (!isPlainObject(config)) throw new Error("Configuration must be one object.");
	rejectUnknownObjectKeys(config, template, "config");
	rejectUnknownObjectKeys(config.RENDERING, template.RENDERING, "config.RENDERING");
	rejectUnknownObjectKeys(config.DEBUG, template.DEBUG, "config.DEBUG");
	requireFinite("config.PLAYER_SPEED", config.PLAYER_SPEED, 0);
	if (config.PLAYER_SIZE_BLOCKS !== undefined) {
		requireFinite("config.PLAYER_SIZE_BLOCKS", config.PLAYER_SIZE_BLOCKS, 0);
	}
	for (const [key, value] of Object.entries(config.RENDERING || {})) {
		requireFinite(`config.RENDERING.${key}`, value, key === "ZOOM" ? 0.01 : 0);
	}
	for (const [key, value] of Object.entries(config.DEBUG || {})) {
		if (key === "MAX_DRAWS_PER_FRAME") {
			requireFinite(`config.DEBUG.${key}`, value, 0);
		} else if (typeof value !== "boolean") {
			throw new Error(`config.DEBUG.${key} must be true or false.`);
		}
	}
	validateBaseProjectile(config.BASE_PROJECTILE);

	if (!Array.isArray(config.WEAPONS)) throw new Error("config.WEAPONS must be an array.");
	for (const [index, weapon] of config.WEAPONS.entries()) {
		resolveProjectileDefinition(config.BASE_PROJECTILE, weapon);
		if (!isPlainObject(weapon)) throw new Error(`config.WEAPONS[${index}] is invalid.`);
	}

	if (!isPlainObject(config.ENEMY_TYPES)) {
		throw new Error("config.ENEMY_TYPES must be an object.");
	}
	for (const [typeName, enemy] of Object.entries(config.ENEMY_TYPES)) {
		if (!isPlainObject(enemy) || !Array.isArray(enemy.weapons) || enemy.weapons.length === 0) {
			throw new Error(`config.ENEMY_TYPES.${typeName}.weapons is required.`);
		}
		rejectUnknownObjectKeys(
			enemy,
			Object.fromEntries([...ENEMY_FIELDS].map((field) => [field, true])),
			`config.ENEMY_TYPES.${typeName}`,
		);
		for (const field of [
			"sizeBlocks", "speed", "hp", "maximumProjectileCount",
			"predictionVariationThreshold", "predictionVariation",
			"wallVelocityChangeThreshold", "wallGapSafetyFactor",
			"wallMaxDurationMs",
		]) {
			if (enemy[field] !== undefined) {
				requireFinite(`config.ENEMY_TYPES.${typeName}.${field}`, enemy[field], 0);
			}
		}
		if (typeof enemy.color !== "string" || typeof enemy.ai !== "string") {
			throw new Error(`config.ENEMY_TYPES.${typeName} color and ai must be strings.`);
		}
		for (const weapon of enemy.weapons) {
			resolveProjectileDefinition(config.BASE_PROJECTILE, weapon);
		}
		validateRenderedShapeDefinition(
			enemy.shape,
			`config.ENEMY_TYPES.${typeName}.shape`,
		);
	}
	if (!Array.isArray(config.STRUCTURE_LIBRARY)) {
		throw new Error("config.STRUCTURE_LIBRARY must be an array.");
	}
	validateStructureLibrary(config.STRUCTURE_LIBRARY);
	return config;
}

function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
}

function addVariationRngDefaults(projectile, rngDefaults) {
    if (!isPlainObject(projectile)) return;

    if (isPlainObject(projectile.variation)) {
        projectile.variation.rng = mergeConfig(
            rngDefaults,
            isPlainObject(projectile.variation.rng)
                ? projectile.variation.rng
                : {},
        );
    }

    const children = projectile.split?.children;
    if (!Array.isArray(children)) return;
    for (const child of children) {
        addVariationRngDefaults(child?.projectile, rngDefaults);
    }
}

function migrateVariationRng(defaultConfig, migratedConfig) {
    const rngDefaults = defaultConfig.BASE_PROJECTILE?.variation?.rng;
    if (!isPlainObject(rngDefaults)) return;

    addVariationRngDefaults(migratedConfig.BASE_PROJECTILE, rngDefaults);
    for (const weapon of Array.isArray(migratedConfig.WEAPONS)
        ? migratedConfig.WEAPONS
        : []) {
        addVariationRngDefaults(weapon, rngDefaults);
    }
    if (isPlainObject(migratedConfig.ENEMY_TYPES)) {
        for (const enemy of Object.values(migratedConfig.ENEMY_TYPES)) {
            for (const weapon of Array.isArray(enemy?.weapons)
                ? enemy.weapons
                : []) {
                addVariationRngDefaults(weapon, rngDefaults);
            }
        }
    }
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

    // Schema v21 adds independently configurable debug stats/draw layers and a
    // shared per-frame debug drawing budget.
    if (savedVersion < 21) {
        migratedConfig.DEBUG = mergeConfig(
            defaultConfig.DEBUG,
            isPlainObject(savedConfig.DEBUG) ? savedConfig.DEBUG : {},
        );
    }

    // Schema v23 adds bounded, upgradeable luck to every variation modifier.
    // Use the factory base as the only source of RNG defaults, including for
    // recursive split-child projectile definitions.
    if (savedVersion < 23) {
        migrateVariationRng(defaultConfig, migratedConfig);
    }

    return migratedConfig;
}

export function loadLocalConfig(defaultConfig) {
    try {
		validateCompleteConfig(defaultConfig, defaultConfig);
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
            // Schema v22 introduced the required global base. Those configs are
            // structurally safe to merge with v23's nested variation RNG defaults.
            // Pre-v22 flat configs still require explicit formatter migration.
            if (Number(savedConfig.CONFIG_SCHEMA_VERSION) < 22) {
                validateBaseProjectile(savedConfig.BASE_PROJECTILE);
            }
            const migratedConfig = migrateConfig(defaultConfig, savedConfig);
			validateCompleteConfig(migratedConfig, defaultConfig);

            localStorage.setItem(
                CONFIG_STORAGE_KEY,
                JSON.stringify(migratedConfig),
            );

            return migratedConfig;
        }

        validateBaseProjectile(savedConfig.BASE_PROJECTILE);
        const merged = mergeConfig(defaultConfig, savedConfig);
		validateCompleteConfig(merged, defaultConfig);
        return merged;
    } catch (error) {
        console.warn(
            "Could not load local config; using config.json defaults.",
            error,
        );

        return defaultConfig;
    }
}

if (typeof window !== "undefined") window.Config = Config;
