import test from "node:test";
import assert from "node:assert/strict";

import { applyCombatDamage } from "../js/combat/damage.js";
import { GameState, player } from "../js/state.js";
import {
	resetTeamRelations,
	setTeamRelationship,
} from "../js/combat/team-relations.js";

test("damage follows relationships and deactivates lethal targets immediately", () => {
	resetTeamRelations();
	setTeamRelationship("alpha", "beta", "hostile");
	const target = { team: "beta", hp: 2, active: true };
	assert.deepEqual(applyCombatDamage("alpha", target, 2), {
		eligible: true,
		applied: true,
		killed: true,
	});
	assert.equal(target.active, false);
	assert.equal(applyCombatDamage("alpha", target, 1).eligible, false);
});

test("invincibility belongs to the player target, not an attacker team", () => {
	resetTeamRelations();
	setTeamRelationship("hazard", player.team, "hostile");
	const priorHp = player.hp;
	const priorActive = player.active;
	GameState.isInvincible = true;
	player.active = true;
	player.hp = 10;
	assert.equal(applyCombatDamage("hazard", player, 5).applied, false);
	assert.equal(player.hp, 10);
	GameState.isInvincible = false;
	player.hp = priorHp;
	player.active = priorActive;
});
