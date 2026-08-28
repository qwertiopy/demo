import test from "node:test";
import assert from "node:assert/strict";

import { GameState } from "../js/state.js";
import {
	clearOwnerWeaponCooldowns,
	isWeaponReady,
	resetWeaponCooldowns,
	setWeaponCooldownUntil,
} from "../js/combat/weapon-cooldowns.js";

test("all owners and weapon slots share exact simulation-clock boundaries", () => {
	resetWeaponCooldowns();
	setWeaponCooldownUntil(10, 0, 250);
	setWeaponCooldownUntil(10, 1, 500);
	setWeaponCooldownUntil(11, 0, 100);
	assert.equal(isWeaponReady(10, 0, 249.999), false);
	assert.equal(isWeaponReady(10, 0, 250), true);
	assert.equal(isWeaponReady(10, 1, 250), false);
	assert.equal(isWeaponReady(11, 0, 250), true);
	clearOwnerWeaponCooldowns(10);
	assert.equal(GameState.weaponCooldownUntilByOwner.has(10), false);
	resetWeaponCooldowns();
});
