// Player weapon selection and bullet-stat lookup.

import { Config } from "./config.js";
import { GameState } from "./state.js";
import { resolveProjectileDefinition } from "./combat/projectile-schema.js";

let compiledBase = null;
let compiledSource = null;
let compiledWeapons = [];

function getCompiledWeapons() {
	if (compiledBase !== Config.BASE_PROJECTILE || compiledSource !== Config.WEAPONS) {
		compiledBase = Config.BASE_PROJECTILE;
		compiledSource = Config.WEAPONS;
		compiledWeapons = Array.isArray(Config.WEAPONS)
			? Config.WEAPONS.map((weapon) =>
				resolveProjectileDefinition(Config.BASE_PROJECTILE, weapon),
			)
			: [];
	}
	return compiledWeapons;
}
export function getWeaponCount() {
	return getCompiledWeapons().length;
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
	return getCompiledWeapons()[index] ??
		resolveProjectileDefinition(Config.BASE_PROJECTILE, {});
}

export function getActiveWeaponLabel() {
    return `Weapon ${getActiveWeaponIndex() + 1}`;
}
