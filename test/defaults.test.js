import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { validateCombatDefaults } from "../js/combat/defaults.js";

const factory = JSON.parse(fs.readFileSync(
	new URL("../js/combat/defaults.json", import.meta.url),
	"utf8",
));

test("factory algorithm defaults pass strict schema validation", () => {
	assert.equal(validateCombatDefaults(factory), factory);
});

test("algorithm defaults reject zero geometry and non-integer budgets", () => {
	assert.throws(
		() => validateCombatDefaults({ ...factory, GEOMETRY_EPSILON: 0 }),
		/greater than zero/,
	);
	assert.throws(
		() => validateCombatDefaults({
			...factory,
			LASER_CALCULATION_BUDGET_PER_FRAME: 1.5,
		}),
		/must be an integer/,
	);
});
