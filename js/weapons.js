// Player weapon selection and bullet-stat lookup.

import { Config } from "./config.js";
import { GameState } from "./state.js";

const FALLBACK_BULLET_STATS = {
    speed: 10,
    radiusBlocks: 0.08,
    color: "crimson",
    damage: 1,
    maxBounces: 1,
    spreadOffset: 0,
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
    laserCooldownMs: 0,
    penetrationBlocks: 0,
};

export function getWeaponCount() {
    return Array.isArray(Config.WEAPONS) ? Config.WEAPONS.length : 0;
}

export function selectWeapon(index) {
    const count = getWeaponCount();
    if (count === 0) return false;
    if (!Number.isInteger(index) || index < 0 || index >= count) return false;

    GameState.activeWeaponIndex = index;
    return true;
}

export function getActiveWeaponIndex() {
    const count = getWeaponCount();

    if (count === 0) return 0;

    GameState.activeWeaponIndex = Math.min(
        Math.max(GameState.activeWeaponIndex, 0),
        count - 1,
    );

    return GameState.activeWeaponIndex;
}

export function getActiveWeaponStats() {
    const index = getActiveWeaponIndex();
    const configured = Config.WEAPONS?.[index] || {};

    return {
        ...FALLBACK_BULLET_STATS,
        speed: Config.PLAYER_BULLET_SPEED || FALLBACK_BULLET_STATS.speed,
        ...configured,
    };
}

export function getActiveWeaponLabel() {
    return `Weapon ${getActiveWeaponIndex() + 1}`;
}
