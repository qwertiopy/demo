import test from "node:test";
import assert from "node:assert/strict";

import { circleIntersectsRect, lineIntersects } from "../js/combat/collision.js";

test("lineIntersects preserves strict interior-only crossings", () => {
	assert.equal(lineIntersects(0, 0, 2, 0, 1, -1, 1, 1), true);
	assert.equal(lineIntersects(0, 0, 1, 0, 1, 0, 1, 1), false);
	assert.equal(lineIntersects(0, 0, 2, 0, 1, 0, 3, 0), false);
});

test("circleIntersectsRect includes exact tangency", () => {
	const rect = { x: 1, y: 1, width: 2, height: 2 };
	assert.equal(circleIntersectsRect(0, 2, 1, rect), true);
	assert.equal(circleIntersectsRect(-0.001, 2, 1, rect), false);
	assert.equal(circleIntersectsRect(2, 2, 0, rect), true);
});
