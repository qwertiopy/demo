import test from "node:test";
import assert from "node:assert/strict";

import { getProceduralWindow } from "../js/procgen.js";

const rendering = {
	DISTANCE_BACK_BLOCKS: 20,
	DISTANCE_FRONT_BLOCKS: 35,
	CLEANUP_BUFFER_BLOCKS: 3,
};

test("procedural window uses the floored player column for integer and fractional X", () => {
	assert.deepEqual(getProceduralWindow(100, rendering), {
		playerColumn: 100,
		generationStartX: 80,
		generationEndX: 135,
		cleanupStartX: 77,
		cleanupEndX: 138,
	});

	assert.deepEqual(getProceduralWindow(100.99, rendering), {
		playerColumn: 100,
		generationStartX: 80,
		generationEndX: 135,
		cleanupStartX: 77,
		cleanupEndX: 138,
	});
});

test("procedural generation start clamps at world origin while cleanup buffer remains symmetric", () => {
	assert.deepEqual(getProceduralWindow(2.75, rendering), {
		playerColumn: 2,
		generationStartX: 0,
		generationEndX: 37,
		cleanupStartX: -3,
		cleanupEndX: 40,
	});
});

test("negative or invalid cleanup buffers preserve the existing zero-buffer behavior", () => {
	for (const cleanupBuffer of [-5, Number.NaN, undefined]) {
		const window = getProceduralWindow(50.5, {
			...rendering,
			CLEANUP_BUFFER_BLOCKS: cleanupBuffer,
		});
		assert.equal(window.cleanupStartX, window.generationStartX);
		assert.equal(window.cleanupEndX, window.generationEndX);
	}
});
