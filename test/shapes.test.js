import test from "node:test";
import assert from "node:assert/strict";

import {
	circleOverlapsRenderedShape,
	rayIntersectsRenderedShape,
	renderedShapeIntersectsPolygon,
	validateRenderedShapeDefinition,
} from "../js/combat/shapes.js";

test("projectile circles use exact rendered triangle geometry", () => {
	const triangle = {
		x: 0,
		y: 0,
		size: 2,
		shape: {
			type: "polygon",
			points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }],
		},
	};
	assert.equal(circleOverlapsRenderedShape(1, 1, 0, triangle), true);
	assert.equal(circleOverlapsRenderedShape(0, 2, 0.1, triangle), false);
});

test("laser ray uses rendered triangle and ignores tangent corners", () => {
	const triangle = {
		x: 2,
		y: 0,
		size: 2,
		shape: {
			type: "polygon",
			points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }],
		},
	};
	assert.equal(
		rayIntersectsRenderedShape(0, 1, 1, 0, triangle, 0)?.entryDistance,
		2.5,
	);
	assert.equal(rayIntersectsRenderedShape(0, 2, 1, 0, triangle, 0), null);
});

test("cone polygon tests exact rendered circle clearance", () => {
	const circle = {
		x: 1,
		y: 1,
		size: 2,
		shape: { type: "circle", radius: 1 },
	};
	const tangentBox = [
		{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 4 }, { x: 0, y: 4 },
	];
	assert.equal(renderedShapeIntersectsPolygon(circle, tangentBox), false);
	const overlappingBox = tangentBox.map((point) => ({
		x: point.x + 0.001,
		y: point.y,
	}));
	assert.equal(renderedShapeIntersectsPolygon(circle, overlappingBox), true);
});

test("circle-versus-circle tangency is not collision", () => {
	const actor = {
		x: 1,
		y: 1,
		size: 2,
		shape: { type: "circle", radius: 1 },
	};
	assert.equal(circleOverlapsRenderedShape(0, 2, 1, actor), false);
	assert.equal(circleOverlapsRenderedShape(0.001, 2, 1, actor), true);
});

test("rendered shape definitions reject malformed geometry", () => {
	assert.throws(
		() => validateRenderedShapeDefinition({ type: "polygon", points: [] }),
		/at least three/,
	);
	assert.throws(
		() => validateRenderedShapeDefinition({
			type: "polygon",
			points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
		}),
		/non-zero area/,
	);
	assert.equal(validateRenderedShapeDefinition({
		type: "circle",
		radius: 1,
		centerX: 1,
		centerY: 1,
	}).type, "circle");
});
