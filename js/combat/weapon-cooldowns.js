import { GameState } from "../state.js";

function ownerSlots(ownerId, create = false) {
	let slots = GameState.weaponCooldownUntilByOwner.get(ownerId);
	if (!slots && create) {
		slots = new Map();
		GameState.weaponCooldownUntilByOwner.set(ownerId, slots);
	}
	return slots ?? null;
}

export function getWeaponCooldownUntil(ownerId, weaponSlot) {
	return ownerSlots(ownerId)?.get(weaponSlot) ?? 0;
}

export function setWeaponCooldownUntil(ownerId, weaponSlot, timeMs) {
	ownerSlots(ownerId, true).set(weaponSlot, Math.max(0, Number(timeMs) || 0));
}

export function isWeaponReady(ownerId, weaponSlot, timeMs) {
	return Number(timeMs) >= getWeaponCooldownUntil(ownerId, weaponSlot);
}

export function clearOwnerWeaponCooldowns(ownerId) {
	GameState.weaponCooldownUntilByOwner.delete(ownerId);
}

export function resetWeaponCooldowns() {
	GameState.weaponCooldownUntilByOwner.clear();
}
