import test from "node:test";
import assert from "node:assert/strict";

import {
	clearActorIndex,
	queryActorsInAabb,
	rebuildActorIndex,
} from "../js/spatial/entity-index.js";

test("actor queries preserve registration order and avoid duplicate cells", () => {
	const first = { x: 0, y: 0, size: 5, hp: 1, active: true };
	const second = { x: 4, y: 0, size: 1, hp: 1, active: true };
	rebuildActorIndex([first, second]);
	assert.deepEqual(queryActorsInAabb(3.5, -1, 5.5, 2), [first, second]);
	clearActorIndex();
});

test("actor index understands rendered circle and polygon bounds", () => {
	const circle = {
		x: 10,
		y: 10,
		size: 2,
		hp: 1,
		active: true,
		shape: { type: "circle", radius: 1 },
	};
	const triangle = {
		x: 20,
		y: 20,
		size: 2,
		hp: 1,
		active: true,
		shape: {
			type: "polygon",
			points: [{ x: -1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }],
		},
	};
	rebuildActorIndex([circle, triangle]);
	assert.deepEqual(queryActorsInAabb(10, 10, 10.25, 11), [circle]);
	assert.deepEqual(queryActorsInAabb(19, 20, 19.1, 20.1), [triangle]);
	clearActorIndex();
});
