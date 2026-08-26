// Player weapon selection and bullet-stat lookup.

import { Config } from "./config.js";
import { GameState } from "./state.js";
import { resolveProjectileDefinition } from "./combat/projectile-schema.js";

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
    return resolveProjectileDefinition(Config.BASE_PROJECTILE, configured);
}

export function getActiveWeaponLabel() {
    return `Weapon ${getActiveWeaponIndex() + 1}`;
}
