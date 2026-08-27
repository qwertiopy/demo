import test from "node:test";
import assert from "node:assert/strict";

import {
	getMaximumStructureWidth,
	getMinimumStructureOriginXExclusive,
	getProceduralPlayerSpawn,
	getStructureTemplateSize,
	structureBoundsOverlap,
} from "../js/procgen.js";

test("template size never understates either declared or grid dimensions", () => {
	assert.deepEqual(
		getStructureTemplateSize({ widthBlocks: 2, heightBlocks: 1, grid: [[1, 1, 1], [1]] }),
		{ width: 3, height: 2 },
	);
	assert.deepEqual(
		getStructureTemplateSize({ widthBlocks: 5, heightBlocks: 4, grid: [[1]] }),
		{ width: 5, height: 4 },
	);
});

test("structure overlap uses half-open bounds and permits edge contact", () => {
	const first = { origin: { x: 0, y: 0 }, size: { width: 2, height: 2 } };
	const touching = { origin: { x: 2, y: 0 }, size: { width: 1, height: 1 } };
	const overlapping = { origin: { x: 1.999, y: 0 }, size: { width: 1, height: 1 } };
	assert.equal(structureBoundsOverlap(first, touching), false);
	assert.equal(structureBoundsOverlap(first, overlapping), true);
});

test("spawn clearance derives from the widest configured structure", () => {
	const library = [
		{ widthBlocks: 2, heightBlocks: 1, grid: [[1, 1]] },
		{ widthBlocks: 1, heightBlocks: 1, grid: [[1, 1, 1, 1]] },
	];
	assert.equal(getMaximumStructureWidth(library), 4);
	assert.equal(getMinimumStructureOriginXExclusive(library), 6);
});

test("procedural player spawn preserves current random-region endpoints", () => {
	const settings = { corridorCeilingYBlocks: 0, corridorWidthBlocks: 10 };
	assert.deepEqual(getProceduralPlayerSpawn(settings, 0.5, () => 0), { x: 1, y: 1 });
	assert.deepEqual(getProceduralPlayerSpawn(settings, 0.5, () => 1), { x: 1.5, y: 9.5 });
});
