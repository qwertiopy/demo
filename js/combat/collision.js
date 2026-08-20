// General combat geometry and line-of-sight helpers.

import { queryWallsAlongSegment } from "../spatial/wall-index.js";

// Tests whether two line segments intersect; used to determine whether a wall edge blocks a shot or enemy vision
export function lineIntersects(a, b, c, d, p, q, r, s) {
	const det = (c - a) * (s - q) - (r - p) * (d - b);

	if (det === 0) return false;

	const lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det;

	const gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det;

	return 0 < lambda && lambda < 1 && 0 < gamma && gamma < 1;
}

// Returns false when any nearby wall edge intersects the line between two
// world-space points. The spatial query is broad-phase only; the original
// edge-intersection test remains the narrow phase.
export function hasLineOfSight(x1, y1, x2, y2) {
	const candidateWalls = queryWallsAlongSegment(x1, y1, x2, y2);

	return !candidateWalls.some(
		(w) =>
			lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x + w.width, w.y) ||
			lineIntersects(
				x1,
				y1,
				x2,
				y2,
				w.x,
				w.y + w.height,
				w.x + w.width,
				w.y + w.height,
			) ||
			lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x, w.y + w.height) ||
			lineIntersects(
				x1,
				y1,
				x2,
				y2,
				w.x + w.width,
				w.y,
				w.x + w.width,
				w.y + w.height,
			),
	);
}

// Returns true when a circle overlaps an axis-aligned rectangle. Explosion
// hitboxes use this instead of the square projectile collision approximation.
export function circleIntersectsRect(circleX, circleY, radius, rect) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const closestX = Math.max(rect.x, Math.min(circleX, rect.x + width));
	const closestY = Math.max(rect.y, Math.min(circleY, rect.y + height));
	const dx = circleX - closestX;
	const dy = circleY - closestY;

	return dx * dx + dy * dy <= radius * radius;
}
