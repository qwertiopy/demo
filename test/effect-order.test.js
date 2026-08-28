import test from "node:test";
import assert from "node:assert/strict";

import {
	PROJECTILE_EFFECT_ORDER,
	runProjectileEffectOrder,
} from "../js/combat/effect-order.js";

test("simultaneous projectile effects use the locked lifecycle order", () => {
	assert.deepEqual(PROJECTILE_EFFECT_ORDER, [
		"bounce",
		"chain",
		"explosion",
		"split",
		"terminal-impact",
	]);
	const observed = [];
	runProjectileEffectOrder(Object.fromEntries(
		[...PROJECTILE_EFFECT_ORDER].reverse().map((stage) => [
			stage,
			() => observed.push(stage),
		]),
	));
	assert.deepEqual(observed, PROJECTILE_EFFECT_ORDER);
});
