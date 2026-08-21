#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const MAX_SUPPORTED_SCHEMA_VERSION = 20;
const DEFAULT_CONFIG_PATH = "config.json";
const CONFIG_SOURCE_PATH = path.join("js", "config.js");

const RENDERING_DEFAULTS = {
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
};

const WEAPON_CURRENT_DEFAULTS = {
    maxBounces: 0,
    spread: 0,
    lifetimeMs: 60000,
    explosionRadiusBlocks: 0,
    detonationTimeMs: 0,
    explosionDurationMs: 0,
    explosionDamage: 0,
    detonatesOnImpact: false,
    throwable: false,
    throwDistanceMultiplier: 1,
    throwDeceleration: 20,
    laser: false,
    laserWarmupMs: 0,
    cooldownMs: 0,
    penetrationBlocks: 0,
    bulletCollision: false,
    bulletCount: 1,
    chain: 0,
};

const ENEMY_CURRENT_DEFAULTS = {
    predictionVariationThreshold: 0.1,
    predictionVariation: 0.04,
    wallVelocityChangeThreshold: 0.1,
    wallGapSafetyFactor: 0.9,
    wallMaxDurationMs: 1500,
    bulletExplosionRadiusBlocks: 0,
    bulletDetonationTimeMs: 0,
    bulletExplosionDurationMs: 0,
    bulletExplosionDamage: 0,
    bulletDetonatesOnImpact: false,
    bulletPenetrationBlocks: 0,
    bulletCollision: false,
};

const TOP_LEVEL_ORDER = [
    "CONFIG_SCHEMA_VERSION",
    "PLAYER_SPEED",
    "PLAYER_BULLET_SPEED",
    "RENDERING",
    "WEAPONS",
    "PLAYER_SIZE_BLOCKS",
    "MIN_SPAWN_DISTANCE_BLOCKS",
    "MAX_SPAWN_DISTANCE_BLOCKS",
    "STRUCTURE_DENSITY_BLOCKS",
    "ENEMY_TYPES",
    "STRUCTURE_LIBRARY",
];

const RENDERING_ORDER = Object.keys(RENDERING_DEFAULTS);

const WEAPON_ORDER = [
    "speed",
    "speedVariation",
    "radiusBlocks",
    "radiusVariation",
    "color",
    "damage",
    "damageVariation",
    "maxBounces",
    "spread",
    "lifetimeMs",
    "explosionRadiusBlocks",
    "detonationTimeMs",
    "explosionDurationMs",
    "explosionDamage",
    "detonatesOnImpact",
    "throwable",
    "throwDistanceMultiplier",
    "throwDeceleration",
    "laser",
    "laserWarmupMs",
    "cooldownMs",
    "penetrationBlocks",
    "bulletCollision",
    "bulletCount",
    "chain",
];

const ENEMY_ORDER = [
    "sizeBlocks",
    "speed",
    "hp",
    "color",
    "shootCooldown",
    "bulletSpeed",
    "bulletSpeedVariation",
    "bulletRadiusBlocks",
    "bulletRadiusVariation",
    "bulletColor",
    "bulletDamage",
    "bulletDamageVariation",
    "ai",
    "spread",
    "predictionVariationThreshold",
    "predictionVariation",
    "wallVelocityChangeThreshold",
    "wallGapSafetyFactor",
    "wallMaxDurationMs",
    "bulletExplosionRadiusBlocks",
    "bulletDetonationTimeMs",
    "bulletExplosionDurationMs",
    "bulletExplosionDamage",
    "bulletDetonatesOnImpact",
    "bulletPenetrationBlocks",
    "bulletCollision",
];

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setDefault(object, key, value) {
    if (object[key] === undefined) {
        object[key] = value;
    }
}

function reorderObject(object, preferredOrder) {
    if (!isPlainObject(object)) {
        return object;
    }

    const result = {};

    for (const key of preferredOrder) {
        if (Object.prototype.hasOwnProperty.call(object, key)) {
            result[key] = object[key];
        }
    }

    for (const [key, value] of Object.entries(object)) {
        if (!Object.prototype.hasOwnProperty.call(result, key)) {
            result[key] = value;
        }
    }

    return result;
}

function detectProjectSchemaVersion(projectRoot) {
    const configSourcePath = path.join(projectRoot, CONFIG_SOURCE_PATH);

    if (!fs.existsSync(configSourcePath)) {
        return MAX_SUPPORTED_SCHEMA_VERSION;
    }

    const source = fs.readFileSync(configSourcePath, "utf8");
    const match = source.match(/CONFIG_SCHEMA_VERSION\s*:\s*(\d+)/);

    if (!match) {
        throw new Error(
            `Could not detect CONFIG_SCHEMA_VERSION in ${configSourcePath}.`,
        );
    }

    const version = Number(match[1]);

    if (!Number.isInteger(version) || version < 0) {
        throw new Error(`Invalid project schema version: ${match[1]}`);
    }

    if (version > MAX_SUPPORTED_SCHEMA_VERSION) {
        throw new Error(
            `Project schema is v${version}, but this script only knows migrations through v${MAX_SUPPORTED_SCHEMA_VERSION}. ` +
            "Update format-config.mjs before using it so it cannot silently corrupt a newer config.",
        );
    }

    return version;
}

function migrateRendering(config, originalVersion, targetVersion) {
    if (targetVersion < 14) {
        return;
    }

    if (!isPlainObject(config.RENDERING)) {
        config.RENDERING = {};
    }

    // v14 moved these old top-level settings under RENDERING.
    if (originalVersion < 14) {
        if (config.RENDER_ZOOM !== undefined && config.RENDERING.ZOOM === undefined) {
            config.RENDERING.ZOOM = Math.max(
                0.01,
                Number(config.RENDER_ZOOM) || RENDERING_DEFAULTS.ZOOM,
            );
        }

        if (
            config.RENDER_DISTANCE_FRONT !== undefined &&
            config.RENDERING.DISTANCE_FRONT_BLOCKS === undefined
        ) {
            config.RENDERING.DISTANCE_FRONT_BLOCKS = Math.max(
                0,
                Number(config.RENDER_DISTANCE_FRONT) || 0,
            );
        }

        if (
            config.RENDER_DISTANCE_BACK !== undefined &&
            config.RENDERING.DISTANCE_BACK_BLOCKS === undefined
        ) {
            config.RENDERING.DISTANCE_BACK_BLOCKS = Math.max(
                0,
                Number(config.RENDER_DISTANCE_BACK) || 0,
            );
        }

        if (
            config.BLOCK_SIZE_PX !== undefined &&
            config.RENDERING.BLOCK_SIZE_PX === undefined
        ) {
            config.RENDERING.BLOCK_SIZE_PX = Math.max(
                1,
                Number(config.BLOCK_SIZE_PX) || RENDERING_DEFAULTS.BLOCK_SIZE_PX,
            );
        }
    }

    // v15 split the old trail setting into length + sampling detail.
    if (targetVersion >= 15 && originalVersion < 15) {
        const oldTrailFrames = Math.max(
            0,
            Math.round(Number(config.RENDERING.TRAILS_PERCENT ?? 0) || 0),
        );

        if (config.RENDERING.TRAIL_LENGTH_FRAMES === undefined) {
            config.RENDERING.TRAIL_LENGTH_FRAMES = oldTrailFrames;
        }

        if (config.RENDERING.TRAIL_DETAIL === undefined) {
            config.RENDERING.TRAIL_DETAIL = 60;
        }
    }

    delete config.RENDERING.TRAILS_PERCENT;
    delete config.RENDER_ZOOM;
    delete config.RENDER_DISTANCE_FRONT;
    delete config.RENDER_DISTANCE_BACK;
    delete config.BLOCK_SIZE_PX;

    for (const [key, value] of Object.entries(RENDERING_DEFAULTS)) {
        setDefault(config.RENDERING, key, value);
    }

    config.RENDERING = reorderObject(config.RENDERING, RENDERING_ORDER);
}

function migrateWeapon(weapon, originalVersion, targetVersion, oldGlobalCooldown) {
    if (!isPlainObject(weapon)) {
        return weapon;
    }

    if (targetVersion >= 9) {
        setDefault(weapon, "throwDistanceMultiplier", 1);
        setDefault(weapon, "throwDeceleration", 20);
        delete weapon.throwSpeed;
        delete weapon.throwDurationMs;
    }

    if (targetVersion >= 11 && originalVersion < 11) {
        const oldLaserCooldown = Math.max(
            0,
            Number(weapon.laserCooldownMs ?? 0) || 0,
        );

        if (weapon.cooldownMs === undefined) {
            weapon.cooldownMs =
                weapon.laser === true
                    ? oldLaserCooldown
                    : oldLaserCooldown > 0
                        ? oldLaserCooldown
                        : oldGlobalCooldown;
        }
    }

    delete weapon.laserCooldownMs;

    if (targetVersion >= 12 && originalVersion < 12) {
        if (weapon.spread === undefined) {
            weapon.spread = Math.max(
                0,
                Number(weapon.spreadOffset ?? 0) || 0,
            );
        }
    }

    delete weapon.spreadOffset;

    for (const [key, value] of Object.entries(WEAPON_CURRENT_DEFAULTS)) {
        setDefault(weapon, key, value);
    }

    if (targetVersion >= 16) {
        setDefault(weapon, "speedVariation", 0);
        setDefault(weapon, "radiusVariation", 0);
        setDefault(weapon, "damageVariation", 0);
    }

    if (targetVersion >= 17) {
        setDefault(weapon, "chain", 0);
    }

    return reorderObject(weapon, WEAPON_ORDER);
}

function migrateEnemyType(enemy, targetVersion) {
    if (!isPlainObject(enemy)) {
        return enemy;
    }

    for (const [key, value] of Object.entries(ENEMY_CURRENT_DEFAULTS)) {
        setDefault(enemy, key, value);
    }

    if (targetVersion >= 16) {
        setDefault(enemy, "bulletSpeedVariation", 0);
        setDefault(enemy, "bulletRadiusVariation", 0);
        setDefault(enemy, "bulletDamageVariation", 0);
    }

    if (targetVersion >= 18) {
        setDefault(enemy, "predictionVariationThreshold", 0.1);
        setDefault(enemy, "predictionVariation", 0.04);
    }

    if (targetVersion >= 19) {
        setDefault(enemy, "wallVelocityChangeThreshold", 0.1);
        setDefault(enemy, "wallGapSafetyFactor", 0.9);
    }

    if (targetVersion >= 20) {
        setDefault(enemy, "wallMaxDurationMs", 1500);
    }

    return reorderObject(enemy, ENEMY_ORDER);
}

function migrateConfig(config, targetVersion) {
    const originalVersion =
        Number.isFinite(Number(config.CONFIG_SCHEMA_VERSION))
            ? Math.max(0, Math.floor(Number(config.CONFIG_SCHEMA_VERSION)))
            : 0;

    if (originalVersion > targetVersion) {
        throw new Error(
            `config.json is schema v${originalVersion}, but this checkout expects v${targetVersion}. ` +
            "Refusing to downgrade it.",
        );
    }

    const oldGlobalCooldown = Math.max(
        0,
        Number(config.PLAYER_SHOOT_COOLDOWN ?? 0) || 0,
    );

    migrateRendering(config, originalVersion, targetVersion);

    if (Array.isArray(config.WEAPONS)) {
        config.WEAPONS = config.WEAPONS.map((weapon) =>
            migrateWeapon(
                weapon,
                originalVersion,
                targetVersion,
                oldGlobalCooldown,
            ),
        );
    }

    if (isPlainObject(config.ENEMY_TYPES)) {
        for (const [typeName, enemy] of Object.entries(config.ENEMY_TYPES)) {
            config.ENEMY_TYPES[typeName] = migrateEnemyType(
                enemy,
                targetVersion,
            );
        }
    }

    delete config.PLAYER_SHOOT_COOLDOWN;

    config.CONFIG_SCHEMA_VERSION = targetVersion;

    return reorderObject(config, TOP_LEVEL_ORDER);
}

const filePath = path.resolve(process.argv[2] ?? DEFAULT_CONFIG_PATH);
const projectRoot = path.dirname(filePath);

try {
    const source = fs.readFileSync(filePath, "utf8");
    const config = JSON.parse(source);

    if (!isPlainObject(config)) {
        throw new Error("Config root must be a JSON object.");
    }

    const oldVersion = Number(config.CONFIG_SCHEMA_VERSION) || 0;
    const targetVersion = detectProjectSchemaVersion(projectRoot);
    const updated = migrateConfig(config, targetVersion);
    const formatted = JSON.stringify(updated, null, 4) + "\n";

    fs.writeFileSync(filePath, formatted, "utf8");

    if (oldVersion === targetVersion) {
        console.log(
            `Updated and formatted ${filePath} (schema already v${targetVersion}).`,
        );
    } else {
        console.log(
            `Updated and formatted ${filePath}: schema v${oldVersion} -> v${targetVersion}.`,
        );
    }
} catch (error) {
    console.error(`Failed to update ${filePath}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
