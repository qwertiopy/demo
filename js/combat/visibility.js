// Shared wall-ray and critical-angle geometry for lasers and enemy aiming.

import { queryWallsInAabb } from "../spatial/wall-index.js";
import {
	normalizeSignedAngle,
	shortestAngleDelta,
} from "./weapon-utils.js";

const GEOMETRY_EPSILON = 1e-9;
const DEFAULT_ANGLE_PROBE = 1e-5;
const FULL_TURN = Math.PI * 2;

function getExpandedWallCorners(wall, padding = 0) {
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;
	const radius = Math.max(0, Number(padding) || 0);
	const left = wall.x - radius;
	const right = wall.x + width + radius;
	const top = wall.y - radius;
	const bottom = wall.y + height + radius;

	return [
		{ x: left, y: top },
		{ x: right, y: top },
		{ x: right, y: bottom },
		{ x: left, y: bottom },
	];
}

function getWallBounds(wall) {
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;

	return {
		left: wall.x,
		right: wall.x + width,
		top: wall.y,
		bottom: wall.y + height,
		width,
		height,
	};
}

function getRoundedWallJoinPoints(wall, radius) {
	const { left, right, top, bottom } = getWallBounds(wall);

	return [
		{ x: left - radius, y: top },
		{ x: left, y: top - radius },
		{ x: right, y: top - radius },
		{ x: right + radius, y: top },
		{ x: right + radius, y: bottom },
		{ x: right, y: bottom + radius },
		{ x: left, y: bottom + radius },
		{ x: left - radius, y: bottom },
	];
}

function getSegmentRangeCircleIntersections(
	originX,
	originY,
	range,
	axis,
	fixed,
	segmentMin,
	segmentMax,
) {
	const fixedDelta = fixed - (axis === "x" ? originX : originY);
	const remainingSquared = range * range - fixedDelta * fixedDelta;
	if (remainingSquared < -GEOMETRY_EPSILON) return [];

	const offset = Math.sqrt(Math.max(0, remainingSquared));
	const variableOrigin = axis === "x" ? originY : originX;
	const points = [];

	for (const variable of [variableOrigin - offset, variableOrigin + offset]) {
		if (
			variable < segmentMin - GEOMETRY_EPSILON ||
			variable > segmentMax + GEOMETRY_EPSILON
		) {
			continue;
		}

		points.push(
			axis === "x"
				? { x: fixed, y: variable }
				: { x: variable, y: fixed },
		);
	}

	return points;
}

function getCircleRangeIntersections(
	originX,
	originY,
	range,
	centerX,
	centerY,
	radius,
) {
	const dx = centerX - originX;
	const dy = centerY - originY;
	const distance = Math.hypot(dx, dy);
	if (
		distance <= GEOMETRY_EPSILON ||
		distance > range + radius + GEOMETRY_EPSILON ||
		distance < Math.abs(range - radius) - GEOMETRY_EPSILON
	) {
		return [];
	}

	const along =
		(range * range - radius * radius + distance * distance) /
		(2 * distance);
	const perpendicular = Math.sqrt(
		Math.max(0, range * range - along * along),
	);
	const unitX = dx / distance;
	const unitY = dy / distance;
	const baseX = originX + unitX * along;
	const baseY = originY + unitY * along;

	return [
		{
			x: baseX - unitY * perpendicular,
			y: baseY + unitX * perpendicular,
		},
		{
			x: baseX + unitY * perpendicular,
			y: baseY - unitX * perpendicular,
		},
	];
}

function getRoundedWallRangeIntersectionPoints(
	wall,
	originX,
	originY,
	maxDistance,
	radius,
) {
	if (!Number.isFinite(maxDistance) || maxDistance <= 0) return [];

	const { left, right, top, bottom } = getWallBounds(wall);
	const points = [
		...getSegmentRangeCircleIntersections(
			originX,
			originY,
			maxDistance,
			"x",
			left - radius,
			top,
			bottom,
		),
		...getSegmentRangeCircleIntersections(
			originX,
			originY,
			maxDistance,
			"x",
			right + radius,
			top,
			bottom,
		),
		...getSegmentRangeCircleIntersections(
			originX,
			originY,
			maxDistance,
			"y",
			top - radius,
			left,
			right,
		),
		...getSegmentRangeCircleIntersections(
			originX,
			originY,
			maxDistance,
			"y",
			bottom + radius,
			left,
			right,
		),
	];

	if (radius <= GEOMETRY_EPSILON) return points;

	for (const corner of [
		{ x: left, y: top, xSide: -1, ySide: -1 },
		{ x: right, y: top, xSide: 1, ySide: -1 },
		{ x: right, y: bottom, xSide: 1, ySide: 1 },
		{ x: left, y: bottom, xSide: -1, ySide: 1 },
	]) {
		for (const point of getCircleRangeIntersections(
			originX,
			originY,
			maxDistance,
			corner.x,
			corner.y,
			radius,
		)) {
			const onOuterX = corner.xSide < 0
				? point.x <= corner.x + GEOMETRY_EPSILON
				: point.x >= corner.x - GEOMETRY_EPSILON;
			const onOuterY = corner.ySide < 0
				? point.y <= corner.y + GEOMETRY_EPSILON
				: point.y >= corner.y - GEOMETRY_EPSILON;
			if (onOuterX && onOuterY) points.push(point);
		}
	}

	return points;
}

function dedupeSortedCriticalRays(rays, epsilon = 1e-7) {
	rays.sort((a, b) => a.localAngle - b.localAngle);
	const deduped = [];

	for (const ray of rays) {
		const previous = deduped[deduped.length - 1];
		if (!previous || Math.abs(ray.localAngle - previous.localAngle) > epsilon) {
			deduped.push(ray);
		} else if (!previous.source && ray.source) {
			previous.source = ray.source;
		}
	}

	return deduped;
}

// Ray/AABB slab intersection. Padding expands the rectangle so callers can
// conservatively test a projectile centerline with non-zero radius.
export function rayRectIntersection(
	originX,
	originY,
	dirX,
	dirY,
	rect,
	padding = 0,
) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const radius = Math.max(0, Number(padding) || 0);
	const minX = rect.x - radius;
	const maxX = rect.x + width + radius;
	const minY = rect.y - radius;
	const maxY = rect.y + height + radius;
	const EPSILON = 1e-12;

	let xNear = -Infinity;
	let xFar = Infinity;
	let yNear = -Infinity;
	let yFar = Infinity;

	if (Math.abs(dirX) < EPSILON) {
		if (originX < minX || originX > maxX) return null;
	} else {
		const tx1 = (minX - originX) / dirX;
		const tx2 = (maxX - originX) / dirX;
		xNear = Math.min(tx1, tx2);
		xFar = Math.max(tx1, tx2);
	}

	if (Math.abs(dirY) < EPSILON) {
		if (originY < minY || originY > maxY) return null;
	} else {
		const ty1 = (minY - originY) / dirY;
		const ty2 = (maxY - originY) / dirY;
		yNear = Math.min(ty1, ty2);
		yFar = Math.max(ty1, ty2);
	}

	const tMin = Math.max(xNear, yNear);
	const tMax = Math.min(xFar, yFar);
	if (tMax < tMin || tMax < 0) return null;

	let normalX = 0;
	let normalY = 0;
	if (tMin >= 0) {
		if (Math.abs(xNear - yNear) <= EPSILON) {
			normalX = dirX >= 0 ? -1 : 1;
			normalY = dirY >= 0 ? -1 : 1;
			const magnitude = Math.hypot(normalX, normalY) || 1;
			normalX /= magnitude;
			normalY /= magnitude;
		} else if (xNear > yNear) {
			normalX = dirX >= 0 ? -1 : 1;
		} else {
			normalY = dirY >= 0 ? -1 : 1;
		}
	}

	return {
		entryDistance: Math.max(0, tMin),
		exitDistance: tMax,
		normalX,
		normalY,
	};
}

function rayCircleIntersection(
	originX,
	originY,
	dirX,
	dirY,
	centerX,
	centerY,
	radius,
) {
	const relX = originX - centerX;
	const relY = originY - centerY;
	const projection = relX * dirX + relY * dirY;
	const c = relX * relX + relY * relY - radius * radius;

	if (c <= GEOMETRY_EPSILON) {
		return { entryDistance: 0, normalX: 0, normalY: 0 };
	}

	const discriminant = projection * projection - c;
	if (discriminant < -GEOMETRY_EPSILON) return null;

	const root = Math.sqrt(Math.max(0, discriminant));
	let entryDistance = -projection - root;
	if (entryDistance < 0) entryDistance = -projection + root;
	if (entryDistance < 0) return null;

	const hitX = originX + dirX * entryDistance;
	const hitY = originY + dirY * entryDistance;
	const normalLength = Math.hypot(hitX - centerX, hitY - centerY) || 1;

	return {
		entryDistance,
		normalX: (hitX - centerX) / normalLength,
		normalY: (hitY - centerY) / normalLength,
	};
}

// Exact ray against the rounded Minkowski boundary used by projectile wall
// collision: two offset face slabs plus a radius-circle at every wall corner.
// This intentionally differs from a square AABB expansion near corners.
export function rayRoundedRectIntersection(
	originX,
	originY,
	dirX,
	dirY,
	rect,
	padding = 0,
) {
	const radius = Math.max(0, Number(padding) || 0);
	if (radius <= GEOMETRY_EPSILON) {
		return rayRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			rect,
			0,
		);
	}

	const { left, right, top, bottom, width, height } = getWallBounds(rect);
	const candidates = [];
	const addCandidate = (hit) => {
		if (hit && Number.isFinite(hit.entryDistance)) candidates.push(hit);
	};

	addCandidate(
		rayRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			{
				x: left - radius,
				y: top,
				width: width + radius * 2,
				height,
			},
		),
	);
	addCandidate(
		rayRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			{
				x: left,
				y: top - radius,
				width,
				height: height + radius * 2,
			},
		),
	);

	for (const corner of [
		{ x: left, y: top },
		{ x: right, y: top },
		{ x: right, y: bottom },
		{ x: left, y: bottom },
	]) {
		addCandidate(
			rayCircleIntersection(
				originX,
				originY,
				dirX,
				dirY,
				corner.x,
				corner.y,
				radius,
			),
		);
	}

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.entryDistance - b.entryDistance);
	return candidates[0];
}

// Produces the corner +/- epsilon rays used by the laser visibility polygon.
// onWall lets the laser subsystem retain its shared calculation budget without
// coupling other visibility users to that budget.
export function getWallCornerCriticalAngles(
	originX,
	originY,
	centerAngle,
	halfAngle,
	walls,
	{
		angleProbe = DEFAULT_ANGLE_PROBE,
		padding = 0,
		maxDistance = Infinity,
		onWall = null,
	} = {},
) {
	const safeHalfAngle = Math.max(0, Number(halfAngle) || 0);
	const safePadding = Math.max(0, Number(padding) || 0);
	const fullCircle = safeHalfAngle >= Math.PI - GEOMETRY_EPSILON;
	const localRays = [];

	function addLocalRay(localAngle, source = null) {
		if (fullCircle) {
			localRays.push({
				localAngle: normalizeSignedAngle(localAngle),
				source,
			});
			return;
		}

		localRays.push({
			localAngle: Math.max(
				-safeHalfAngle,
				Math.min(safeHalfAngle, localAngle),
			),
			source,
		});
	}

	function addAbsoluteCriticalAngle(absoluteAngle, source = null) {
		const localAngle = shortestAngleDelta(centerAngle, absoluteAngle);

		if (
			!fullCircle &&
			(localAngle < -safeHalfAngle - angleProbe ||
				localAngle > safeHalfAngle + angleProbe)
		) {
			return;
		}

		addLocalRay(localAngle - angleProbe);
		addLocalRay(localAngle, source);
		addLocalRay(localAngle + angleProbe);
	}

	if (fullCircle) {
		for (let i = 0; i < 8; i++) {
			addLocalRay(-Math.PI + (i * Math.PI) / 4);
		}
	} else {
		addLocalRay(-safeHalfAngle);
		addLocalRay(safeHalfAngle);
	}

	for (const wall of walls || []) {
		if (typeof onWall === "function" && onWall(wall) === false) {
			return { angles: [], truncated: true };
		}

		for (const point of getRoundedWallRangeIntersectionPoints(
			wall,
			originX,
			originY,
			maxDistance,
			safePadding,
		)) {
			addAbsoluteCriticalAngle(
				Math.atan2(point.y - originY, point.x - originX),
				{ kind: "point", x: point.x, y: point.y },
			);
		}

		if (safePadding <= GEOMETRY_EPSILON) {
			for (const corner of getExpandedWallCorners(wall, 0)) {
				addAbsoluteCriticalAngle(
					Math.atan2(corner.y - originY, corner.x - originX),
					{
						kind: "point",
						x: corner.x,
						y: corner.y,
					},
				);
			}
			continue;
		}

		const { left, right, top, bottom } = getWallBounds(wall);
		for (const corner of [
			{ x: left, y: top },
			{ x: right, y: top },
			{ x: right, y: bottom },
			{ x: left, y: bottom },
		]) {
			const dx = corner.x - originX;
			const dy = corner.y - originY;
			const distance = Math.hypot(dx, dy);
			const centerDirection = Math.atan2(dy, dx);

			if (distance > safePadding + GEOMETRY_EPSILON) {
				const tangentOffset = Math.asin(
					Math.min(1, safePadding / distance),
				);

				for (const tangentSide of [-1, 1]) {
					addAbsoluteCriticalAngle(
						centerDirection + tangentSide * tangentOffset,
						{
							kind: "rounded-corner-tangent",
							x: corner.x,
							y: corner.y,
							radius: safePadding,
							tangentSide,
						},
					);
				}
			} else {
				addAbsoluteCriticalAngle(centerDirection, {
					kind: "rounded-corner-tangent",
					x: corner.x,
					y: corner.y,
					radius: safePadding,
					tangentSide: 0,
				});
			}
		}

		// Face/arc joins are harmless extra partitions and cover degenerate cases
		// where a tangent from an individual corner circle lies inside another
		// component of the rounded rectangle union.
		for (const point of getRoundedWallJoinPoints(wall, safePadding)) {
			addAbsoluteCriticalAngle(
				Math.atan2(point.y - originY, point.x - originX),
				{ kind: "point", x: point.x, y: point.y },
			);
		}
	}

	const criticalRays = dedupeSortedCriticalRays(localRays).map((ray) => ({
		angle: centerAngle + ray.localAngle,
		localAngle: ray.localAngle,
		source: ray.source,
	}));

	return {
		angles: criticalRays.map((ray) => ray.angle),
		rays: criticalRays,
		truncated: false,
	};
}

function isRayClearToDistance(
	originX,
	originY,
	angle,
	maxDistance,
	projectileRadius,
	walls,
) {
	const dirX = Math.cos(angle);
	const dirY = Math.sin(angle);

	for (const wall of walls) {
		const hit = rayRoundedRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			wall,
			projectileRadius,
		);

		if (hit && hit.entryDistance <= maxDistance + GEOMETRY_EPSILON) {
			return false;
		}
	}

	return true;
}

function getFirstRoundedWallHit(
	originX,
	originY,
	angle,
	maxDistance,
	projectileRadius,
	walls,
) {
	const dirX = Math.cos(angle);
	const dirY = Math.sin(angle);
	let closestHit = null;

	for (const wall of walls) {
		const hit = rayRoundedRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			wall,
			projectileRadius,
		);

		if (
			!hit ||
			hit.entryDistance > maxDistance + GEOMETRY_EPSILON ||
			(closestHit && hit.entryDistance >= closestHit.entryDistance)
		) {
			continue;
		}

		closestHit = hit;
	}

	if (!closestHit) return null;
	return {
		x: originX + dirX * closestHit.entryDistance,
		y: originY + dirY * closestHit.entryDistance,
		distance: closestHit.entryDistance,
	};
}

function isPointWithinRange(originX, originY, point, maxDistance) {
	if (!Number.isFinite(maxDistance)) return true;
	const tolerance = GEOMETRY_EPSILON * Math.max(1, maxDistance);
	const allowedDistance = maxDistance + tolerance;
	const dx = point.x - originX;
	const dy = point.y - originY;
	return dx * dx + dy * dy <= allowedDistance * allowedDistance;
}

function getExpandedWallDistance(originX, originY, wall, radius) {
	const { left, right, top, bottom } = getWallBounds(wall);
	const closestX = Math.max(left, Math.min(originX, right));
	const closestY = Math.max(top, Math.min(originY, bottom));
	const distanceToRect = Math.hypot(
		originX - closestX,
		originY - closestY,
	);

	return {
		containsOrigin: distanceToRect <= radius + GEOMETRY_EPSILON,
		distance: Math.max(0, distanceToRect - radius),
	};
}

function getWallAngularBoundaryCandidates(
	wall,
	originX,
	originY,
	maxDistance,
	radius,
) {
	const candidates = [];

	function addPoint(point, source) {
		if (
			!Number.isFinite(point?.x) ||
			!Number.isFinite(point?.y) ||
			!isPointWithinRange(originX, originY, point, maxDistance)
		) {
			return;
		}

		const dx = point.x - originX;
		const dy = point.y - originY;
		candidates.push({
			angle: Math.atan2(dy, dx),
			distanceSquared: dx * dx + dy * dy,
			point: { x: point.x, y: point.y },
			source,
		});
	}

	for (const point of getRoundedWallRangeIntersectionPoints(
		wall,
		originX,
		originY,
		maxDistance,
		radius,
	)) {
		addPoint(point, { kind: "point", x: point.x, y: point.y });
	}

	if (radius <= GEOMETRY_EPSILON) {
		for (const point of getExpandedWallCorners(wall, 0)) {
			addPoint(point, { kind: "point", x: point.x, y: point.y });
		}
		return candidates;
	}

	for (const point of getRoundedWallJoinPoints(wall, radius)) {
		addPoint(point, { kind: "point", x: point.x, y: point.y });
	}

	const { left, right, top, bottom } = getWallBounds(wall);
	for (const corner of [
		{ x: left, y: top, xSide: -1, ySide: -1 },
		{ x: right, y: top, xSide: 1, ySide: -1 },
		{ x: right, y: bottom, xSide: 1, ySide: 1 },
		{ x: left, y: bottom, xSide: -1, ySide: 1 },
	]) {
		const dx = corner.x - originX;
		const dy = corner.y - originY;
		const centerDistance = Math.hypot(dx, dy);
		if (centerDistance <= radius + GEOMETRY_EPSILON) continue;

		const centerDirection = Math.atan2(dy, dx);
		const tangentOffset = Math.asin(
			Math.min(1, radius / centerDistance),
		);
		const tangentDistance = Math.sqrt(
			Math.max(0, centerDistance * centerDistance - radius * radius),
		);

		for (const tangentSide of [-1, 1]) {
			const tangentAngle =
				centerDirection + tangentSide * tangentOffset;
			const point = {
				x: originX + Math.cos(tangentAngle) * tangentDistance,
				y: originY + Math.sin(tangentAngle) * tangentDistance,
			};
			const onOuterX = corner.xSide < 0
				? point.x <= corner.x + GEOMETRY_EPSILON
				: point.x >= corner.x - GEOMETRY_EPSILON;
			const onOuterY = corner.ySide < 0
				? point.y <= corner.y + GEOMETRY_EPSILON
				: point.y >= corner.y - GEOMETRY_EPSILON;
			if (!onOuterX || !onOuterY) continue;

			addPoint(point, {
				kind: "rounded-corner-tangent",
				x: corner.x,
				y: corner.y,
				radius,
				tangentSide,
			});
		}
	}

	return candidates;
}

function getCircularCandidateSpan(candidates) {
	if (candidates.length === 0) return null;

	const sorted = candidates
		.map((candidate) => ({
			...candidate,
			normalizedAngle:
				candidate.angle < 0
					? candidate.angle + FULL_TURN
					: candidate.angle,
		}))
		.sort((a, b) => a.normalizedAngle - b.normalizedAngle);

	let largestGap = -Infinity;
	let largestGapIndex = 0;
	for (let index = 0; index < sorted.length; index++) {
		const nextIndex = (index + 1) % sorted.length;
		const nextAngle =
			sorted[nextIndex].normalizedAngle +
			(nextIndex === 0 ? FULL_TURN : 0);
		const gap = nextAngle - sorted[index].normalizedAngle;
		if (gap > largestGap) {
			largestGap = gap;
			largestGapIndex = index;
		}
	}

	const startIndex = (largestGapIndex + 1) % sorted.length;
	const startCandidate = sorted[startIndex];
	const endCandidate = sorted[largestGapIndex];
	const startAngle = startCandidate.normalizedAngle;
	let endAngle = endCandidate.normalizedAngle;
	if (endAngle < startAngle) endAngle += FULL_TURN;

	return {
		startAngle,
		endAngle,
		startCandidate,
		endCandidate,
	};
}

function getWallBlockedAngleIntervals(
	wall,
	originX,
	originY,
	centerAngle,
	halfAngle,
	maxDistance,
	radius,
) {
	const expandedDistance = getExpandedWallDistance(
		originX,
		originY,
		wall,
		radius,
	);
	if (expandedDistance.containsOrigin) {
		return { fullyBlocked: true, intervals: [] };
	}
	if (
		Number.isFinite(maxDistance) &&
		expandedDistance.distance > maxDistance + GEOMETRY_EPSILON
	) {
		return { fullyBlocked: false, intervals: [] };
	}

	const candidates = getWallAngularBoundaryCandidates(
		wall,
		originX,
		originY,
		maxDistance,
		radius,
	);
	const span = getCircularCandidateSpan(candidates);
	if (!span) return { fullyBlocked: false, intervals: [] };
	if (span.endAngle - span.startAngle > Math.PI + 1e-7) {
		return { fullyBlocked: true, intervals: [] };
	}

	const baseStart = span.startAngle - centerAngle;
	const baseEnd = span.endAngle - centerAngle;
	const firstShift = Math.ceil((-halfAngle - baseEnd) / FULL_TURN);
	const lastShift = Math.floor((halfAngle - baseStart) / FULL_TURN);
	const intervals = [];

	for (let shift = firstShift; shift <= lastShift; shift++) {
		const shiftedStart = baseStart + shift * FULL_TURN;
		const shiftedEnd = baseEnd + shift * FULL_TURN;
		const minOffset = Math.max(-halfAngle, shiftedStart);
		const maxOffset = Math.min(halfAngle, shiftedEnd);
		if (maxOffset < minOffset - GEOMETRY_EPSILON) continue;

		intervals.push({
			minOffset,
			maxOffset,
			minBoundary:
				shiftedStart >= -halfAngle - GEOMETRY_EPSILON
					? span.startCandidate
					: null,
			maxBoundary:
				shiftedEnd <= halfAngle + GEOMETRY_EPSILON
					? span.endCandidate
					: null,
		});
	}

	return { fullyBlocked: false, intervals };
}

function chooseNearerBoundary(first, second) {
	if (!first) return second;
	if (!second) return first;
	return second.distanceSquared < first.distanceSquared ? second : first;
}

function mergeBlockedAngleIntervals(intervals) {
	if (intervals.length === 0) return [];

	intervals.sort((a, b) =>
		a.minOffset - b.minOffset || b.maxOffset - a.maxOffset,
	);
	const merged = [];

	for (const interval of intervals) {
		const previous = merged[merged.length - 1];
		if (
			!previous ||
			interval.minOffset > previous.maxOffset + GEOMETRY_EPSILON
		) {
			merged.push({ ...interval });
			continue;
		}

		if (
			Math.abs(interval.minOffset - previous.minOffset) <=
			GEOMETRY_EPSILON
		) {
			previous.minBoundary = chooseNearerBoundary(
				previous.minBoundary,
				interval.minBoundary,
			);
		}

		if (interval.maxOffset > previous.maxOffset + GEOMETRY_EPSILON) {
			previous.maxOffset = interval.maxOffset;
			previous.maxBoundary = interval.maxBoundary;
		} else if (
			Math.abs(interval.maxOffset - previous.maxOffset) <=
			GEOMETRY_EPSILON
		) {
			previous.maxBoundary = chooseNearerBoundary(
				previous.maxBoundary,
				interval.maxBoundary,
			);
		}
	}

	return merged;
}

function getClearAngleIntervals(blockedIntervals, halfAngle) {
	const clearIntervals = [];
	let cursor = -halfAngle;
	let cursorBoundary = null;

	for (const blocked of blockedIntervals) {
		if (blocked.minOffset > cursor + GEOMETRY_EPSILON) {
			clearIntervals.push({
				minOffset: cursor,
				maxOffset: blocked.minOffset,
				minBoundary: cursorBoundary,
				maxBoundary: blocked.minBoundary,
			});
		}

		if (blocked.maxOffset >= cursor - GEOMETRY_EPSILON) {
			cursor = Math.max(cursor, blocked.maxOffset);
			cursorBoundary = blocked.maxBoundary;
		}
	}

	if (cursor < halfAngle - GEOMETRY_EPSILON) {
		clearIntervals.push({
			minOffset: cursor,
			maxOffset: halfAngle,
			minBoundary: cursorBoundary,
			maxBoundary: null,
		});
	}

	return clearIntervals;
}

// Returns the wall-clear angular component nearest preferredAngle. Every
// projectile-expanded wall is convex and therefore contributes one continuous
// blocked angular interval. Merging those intervals and taking their complement
// avoids the former raycast-per-critical-partition visibility sweep.
export function getVisibleAimInterval(
	originX,
	originY,
	centerAngle,
	halfAngle,
	maxDistance,
	projectileRadius = 0,
	walls = null,
	preferredAngle = centerAngle,
) {
	const safeHalfAngle = Math.max(
		0,
		Math.min(Math.PI, Number(halfAngle) || 0),
	);
	const safeDistance = Math.max(0, Number(maxDistance) || 0);
	const safeRadius = Math.max(0, Number(projectileRadius) || 0);
	const suppliedWalls = Array.isArray(walls);
	const candidateWalls = suppliedWalls
		? walls
		: queryWallsInAabb(
			originX - safeDistance - safeRadius,
			originY - safeDistance - safeRadius,
			originX + safeDistance + safeRadius,
			originY + safeDistance + safeRadius,
		);
	const isLocalAngleClear = (localAngle) =>
		isRayClearToDistance(
			originX,
			originY,
			centerAngle + localAngle,
			safeDistance,
			safeRadius,
			candidateWalls,
		);

	if (candidateWalls.length === 0) {
		return {
			originX,
			originY,
			centerAngle,
			minOffset: -safeHalfAngle,
			maxOffset: safeHalfAngle,
			minAngle: centerAngle - safeHalfAngle,
			maxAngle: centerAngle + safeHalfAngle,
			minBoundary: null,
			maxBoundary: null,
		};
	}

	if (safeHalfAngle <= GEOMETRY_EPSILON) {
		if (!isLocalAngleClear(0)) return null;
		return {
			originX,
			originY,
			centerAngle,
			minOffset: 0,
			maxOffset: 0,
			minAngle: centerAngle,
			maxAngle: centerAngle,
			minBoundary: null,
			maxBoundary: null,
		};
	}

	const blockedIntervals = [];
	for (const wall of candidateWalls) {
		const blocked = getWallBlockedAngleIntervals(
			wall,
			originX,
			originY,
			centerAngle,
			safeHalfAngle,
			safeDistance,
			safeRadius,
		);
		if (blocked.fullyBlocked) return null;
		blockedIntervals.push(...blocked.intervals);
	}

	if (blockedIntervals.length === 0) {
		return {
			originX,
			originY,
			centerAngle,
			minOffset: -safeHalfAngle,
			maxOffset: safeHalfAngle,
			minAngle: centerAngle - safeHalfAngle,
			maxAngle: centerAngle + safeHalfAngle,
			minBoundary: null,
			maxBoundary: null,
		};
	}

	const clearRanges = getClearAngleIntervals(
		mergeBlockedAngleIntervals(blockedIntervals),
		safeHalfAngle,
	);

	if (clearRanges.length === 0) return null;

	const preferredOffset = Math.max(
		-safeHalfAngle,
		Math.min(
			safeHalfAngle,
			shortestAngleDelta(centerAngle, preferredAngle),
		),
	);
	const distanceToRange = (range) => {
		if (preferredOffset < range.minOffset) {
			return range.minOffset - preferredOffset;
		}
		if (preferredOffset > range.maxOffset) {
			return preferredOffset - range.maxOffset;
		}
		return 0;
	};
	const selectedRange = clearRanges.reduce((best, range) => {
		if (!best) return range;

		const rangeDistance = distanceToRange(range);
		const bestDistance = distanceToRange(best);
		if (rangeDistance < bestDistance - GEOMETRY_EPSILON) return range;
		if (rangeDistance > bestDistance + GEOMETRY_EPSILON) return best;

		const rangeCenter = (range.minOffset + range.maxOffset) / 2;
		const bestCenter = (best.minOffset + best.maxOffset) / 2;
		return Math.abs(rangeCenter - preferredOffset) <
			Math.abs(bestCenter - preferredOffset)
			? range
			: best;
	}, null);

	const rawMinOffset = selectedRange.minOffset;
	const rawMaxOffset = selectedRange.maxOffset;
	let minOffset = rawMinOffset;
	let maxOffset = rawMaxOffset;
	const internalMin = rawMinOffset > -safeHalfAngle + GEOMETRY_EPSILON;
	const internalMax = rawMaxOffset < safeHalfAngle - GEOMETRY_EPSILON;
	const rangeWidth = rawMaxOffset - rawMinOffset;
	const insetBudget = rangeWidth / (internalMin && internalMax ? 3 : 2);
	const angularInset = Math.min(DEFAULT_ANGLE_PROBE, insetBudget);

	// Internal range endpoints are wall-corner discontinuities. Always move
	// them onto the clear side: an exact tangent can flip classification with
	// floating-point rounding and a real projectile must not graze the corner.
	if (internalMin) {
		minOffset += angularInset;
	}
	if (internalMax) {
		maxOffset -= angularInset;
	}

	if (
		minOffset > maxOffset + GEOMETRY_EPSILON ||
		!isLocalAngleClear(minOffset) ||
		!isLocalAngleClear((minOffset + maxOffset) / 2) ||
		!isLocalAngleClear(maxOffset)
	) {
		return null;
	}

	function makeBoundary(
		boundaryCandidate,
		tangentOffset,
		safeOffset,
		inwardSign,
		internal,
	) {
		if (!internal) return null;

		const tangentAngle = centerAngle + tangentOffset;
		const firstHit = getFirstRoundedWallHit(
			originX,
			originY,
			tangentAngle,
			safeDistance,
			safeRadius,
			candidateWalls,
		);

		return {
			angle: centerAngle + safeOffset,
			tangentAngle,
			inwardSign,
			angularInset: Math.abs(safeOffset - tangentOffset),
			point:
				(boundaryCandidate?.point
					? { ...boundaryCandidate.point }
					: null) ||
				(firstHit
					? { x: firstHit.x, y: firstHit.y }
					: null),
			source: boundaryCandidate?.source
				? { ...boundaryCandidate.source }
				: null,
		};
	}

	return {
		originX,
		originY,
		centerAngle,
		minOffset,
		maxOffset,
		minAngle: centerAngle + minOffset,
		maxAngle: centerAngle + maxOffset,
		minBoundary: makeBoundary(
			selectedRange.minBoundary,
			rawMinOffset,
			minOffset,
			1,
			internalMin,
		),
		maxBoundary: makeBoundary(
			selectedRange.maxBoundary,
			rawMaxOffset,
			maxOffset,
			-1,
			internalMax,
		),
	};
}

export function clampAngleToInterval(angle, interval) {
	if (!interval) return angle;

	const localAngle = shortestAngleDelta(interval.centerAngle, angle);
	const clampedOffset = Math.max(
		interval.minOffset,
		Math.min(interval.maxOffset, localAngle),
	);

	return interval.centerAngle + clampedOffset;
}
