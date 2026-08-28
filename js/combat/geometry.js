// Canonical collision helpers shared by gameplay, LOS, and aiming. Rendered
// actors currently use axis-aligned polygons; projectiles use circles.

import { getCombatDefaultOr } from "./defaults.js";

export const GEOMETRY_TOLERANCE = Object.freeze({
	[Symbol.toPrimitive]: () => getCombatDefaultOr("GEOMETRY_EPSILON", 1e-9),
});

export function rectSize(rect) {
	return {
		width: Number(rect?.width ?? rect?.size ?? 0) || 0,
		height: Number(rect?.height ?? rect?.size ?? 0) || 0,
	};
}

export function rectPolygon(rect) {
	const { width, height } = rectSize(rect);
	return [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + width, y: rect.y },
		{ x: rect.x + width, y: rect.y + height },
		{ x: rect.x, y: rect.y + height },
	];
}

// Exact tangency is intentionally clear. Callers that require overlap use a
// strict comparison after allowing only a tiny floating-point tolerance.
export function circleOverlapsRectStrict(circleX, circleY, radius, rect) {
	const { width, height } = rectSize(rect);
	const closestX = Math.max(rect.x, Math.min(circleX, rect.x + width));
	const closestY = Math.max(rect.y, Math.min(circleY, rect.y + height));
	const dx = circleX - closestX;
	const dy = circleY - closestY;
	const radiusSquared = Math.max(0, Number(radius) || 0) ** 2;
	const distanceSquared = dx * dx + dy * dy;
	return distanceSquared < radiusSquared - GEOMETRY_TOLERANCE;
}

export function pointInsideRectStrict(x, y, rect) {
	const { width, height } = rectSize(rect);
	return (
		x > rect.x + GEOMETRY_TOLERANCE &&
		x < rect.x + width - GEOMETRY_TOLERANCE &&
		y > rect.y + GEOMETRY_TOLERANCE &&
		y < rect.y + height - GEOMETRY_TOLERANCE
	);
}

// Radius-aware segment clearance against an axis-aligned rendered polygon.
// It is a slab test against the rectangle expanded by the projectile radius.
// Merely touching the expanded boundary remains clear.
export function segmentHasRadiusClearanceAgainstRect(
	x1,
	y1,
	x2,
	y2,
	radius,
	rect,
) {
	const { width, height } = rectSize(rect);
	const padding = Math.max(0, Number(radius) || 0);
	const minX = rect.x - padding;
	const maxX = rect.x + width + padding;
	const minY = rect.y - padding;
	const maxY = rect.y + height + padding;
	const dx = x2 - x1;
	const dy = y2 - y1;
	let enter = 0;
	let exit = 1;

	for (const [origin, delta, minimum, maximum] of [
		[x1, dx, minX, maxX],
		[y1, dy, minY, maxY],
	]) {
		if (Math.abs(delta) <= GEOMETRY_TOLERANCE) {
			if (origin <= minimum + GEOMETRY_TOLERANCE || origin >= maximum - GEOMETRY_TOLERANCE) {
				return true;
			}
			continue;
		}
		let near = (minimum - origin) / delta;
		let far = (maximum - origin) / delta;
		if (near > far) [near, far] = [far, near];
		enter = Math.max(enter, near);
		exit = Math.min(exit, far);
		if (enter >= exit - GEOMETRY_TOLERANCE) return true;
	}

	// Strict interior intersection blocks; one-point/tangent contact is clear.
	return !(enter < exit - GEOMETRY_TOLERANCE && exit > 0 && enter < 1);
}
