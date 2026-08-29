// Shared wall-shape and angular-interval geometry.

import { FULL_TURN, GEOMETRY_EPSILON } from "./constants.js";

export function getWallFromEntry(wallEntry) {
	return wallEntry?.wall || wallEntry;
}

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

export function getWallBounds(wall) {
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

export function createWallCornerRecord(wall, radius) {
	const bounds = getWallBounds(wall);

	return {
		wall,
		radius,
		x: wall.x,
		y: wall.y,
		width: bounds.width,
		height: bounds.height,
		bounds,
		corners: getExpandedWallCorners(wall, 0),
		roundedJoinPoints: getRoundedWallJoinPoints(wall, radius),
		angleOriginX: null,
		angleOriginY: null,
		cornerAngles: [],
		roundedJoinAngles: [],
	};
}

export function isWallCornerRecordCurrent(record, wall, radius) {
	const bounds = getWallBounds(wall);
	return Boolean(
		record &&
			record.wall === wall &&
			Math.abs(record.radius - radius) <= GEOMETRY_EPSILON &&
			record.x === wall.x &&
			record.y === wall.y &&
			record.width === bounds.width &&
			record.height === bounds.height,
	);
}

export function getWallCornerGeometry(wallEntry, radius) {
	const wall = getWallFromEntry(wallEntry);
	if (isWallCornerRecordCurrent(wallEntry, wall, radius)) {
		return wallEntry;
	}

	return createWallCornerRecord(wall, radius);
}

export function updateWallCornerRecordAngles(record, originX, originY) {
	if (
		record.angleOriginX === originX &&
		record.angleOriginY === originY
	) {
		return record;
	}

	record.angleOriginX = originX;
	record.angleOriginY = originY;
	record.cornerAngles = record.corners.map((point) =>
		Math.atan2(point.y - originY, point.x - originX),
	);
	record.roundedJoinAngles = record.roundedJoinPoints.map((point) =>
		Math.atan2(point.y - originY, point.x - originX),
	);
	return record;
}

export function updateAimWallCornerAngles(
	cornerCache,
	originX,
	originY,
) {
	if (!(cornerCache instanceof Map)) return;
	for (const record of cornerCache.values()) {
		updateWallCornerRecordAngles(record, originX, originY);
	}
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

export function getRoundedWallRangeIntersectionPoints(
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

export function dedupeSortedCriticalRays(rays, epsilon = 1e-7) {
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

function isPointWithinRange(originX, originY, point, maxDistance) {
	if (!Number.isFinite(maxDistance)) return true;
	const tolerance = GEOMETRY_EPSILON * Math.max(1, maxDistance);
	const allowedDistance = maxDistance + tolerance;
	const dx = point.x - originX;
	const dy = point.y - originY;
	return dx * dx + dy * dy <= allowedDistance * allowedDistance;
}

export function getExpandedWallDistance(originX, originY, wallEntry, radius) {
	const wall = getWallFromEntry(wallEntry);
	const { left, right, top, bottom } = isWallCornerRecordCurrent(
		wallEntry,
		wall,
		radius,
	)
		? wallEntry.bounds
		: getWallBounds(wall);
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
	wallEntry,
	originX,
	originY,
	maxDistance,
	radius,
) {
	const wall = getWallFromEntry(wallEntry);
	const geometry = updateWallCornerRecordAngles(
		getWallCornerGeometry(wallEntry, radius),
		originX,
		originY,
	);
	const candidates = [];

	function addPoint(point, source, knownAngle = null) {
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
			angle: Number.isFinite(knownAngle)
				? knownAngle
				: Math.atan2(dy, dx),
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
		for (let index = 0; index < geometry.corners.length; index++) {
			const point = geometry.corners[index];
			addPoint(
				point,
				{ kind: "point", x: point.x, y: point.y },
				geometry.cornerAngles[index],
			);
		}
		return candidates;
	}

	for (let index = 0; index < geometry.roundedJoinPoints.length; index++) {
		const point = geometry.roundedJoinPoints[index];
		addPoint(
			point,
			{ kind: "point", x: point.x, y: point.y },
			geometry.roundedJoinAngles[index],
		);
	}

	const { left, right, top, bottom } = geometry.bounds;
	const roundedCorners = [
		{ x: left, y: top, xSide: -1, ySide: -1 },
		{ x: right, y: top, xSide: 1, ySide: -1 },
		{ x: right, y: bottom, xSide: 1, ySide: 1 },
		{ x: left, y: bottom, xSide: -1, ySide: 1 },
	];
	for (
		let cornerIndex = 0;
		cornerIndex < roundedCorners.length;
		cornerIndex++
	) {
		const corner = roundedCorners[cornerIndex];
		const dx = corner.x - originX;
		const dy = corner.y - originY;
		const centerDistance = Math.hypot(dx, dy);
		if (centerDistance <= radius + GEOMETRY_EPSILON) continue;

		const centerDirection = geometry.cornerAngles[cornerIndex];
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

export function getWallBlockedAngleIntervals(
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
