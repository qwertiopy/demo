import test from "node:test";
import assert from "node:assert/strict";

import {
	canDamageTeam,
	isDamageableTarget,
	resetTeamRelations,
	setTeamRelationship,
} from "../js/combat/team-relations.js";

test("default relationships preserve player versus enemy hostility", () => {
	resetTeamRelations();
	assert.equal(canDamageTeam("player", "enemy"), true);
	assert.equal(canDamageTeam("enemy", "player"), true);
	assert.equal(canDamageTeam("enemy", "enemy"), false);
	assert.equal(canDamageTeam("unknown", "enemy"), false);
});

test("dead or inactive targets are immediately ineligible", () => {
	resetTeamRelations();
	assert.equal(isDamageableTarget("player", { team: "enemy", hp: 1 }), true);
	assert.equal(isDamageableTarget("player", { team: "enemy", hp: 0 }), false);
	assert.equal(isDamageableTarget("player", { team: "enemy", hp: 1, active: false }), false);
});

test("custom teams use the general relationship system", () => {
	resetTeamRelations();
	setTeamRelationship("hazard", "player", "hostile");
	assert.equal(canDamageTeam("hazard", "player"), true);
});
