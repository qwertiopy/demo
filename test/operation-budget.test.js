import test from "node:test";
import assert from "node:assert/strict";

import { SoftOperationBudget } from "../js/combat/operation-budget.js";

test("soft budget records overrun without refusing work", () => {
	const budget = new SoftOperationBudget(2);
	assert.equal(budget.consume(), true);
	assert.equal(budget.consume(5), true);
	assert.equal(budget.remaining, -4);
	assert.equal(budget.overrun, 4);
});
