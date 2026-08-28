import { GEOMETRY_TOLERANCE, rectPolygon, rectSize } from "./geometry.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function rejectShapeKeys(value, allowed, path) {
	for (const key of Object.keys(value || {})) {
		if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
			throw new Error(`${path}.${key} is not a recognised shape field.`);
		}
	}
}

function finiteNumber(value, path) {
	if (!Number.isFinite(Number(value))) throw new Error(`${path} must be finite.`);
	return Number(value);
}

export function validateRenderedShapeDefinition(shape, path = "shape") {
	if (shape === null || shape === undefined) return null;
	if (typeof shape !== "object" || Array.isArray(shape)) {
		throw new Error(`${path} must be an object.`);
	}
	if (shape.type === "circle") {
		rejectShapeKeys(
			shape,
			new Set(["type", "radius", "centerX", "centerY"]),
			path,
		);
		if (shape.radius !== undefined && finiteNumber(shape.radius, `${path}.radius`) < 0) {
			throw new Error(`${path}.radius must be >= 0.`);
		}
		if (shape.centerX !== undefined) finiteNumber(shape.centerX, `${path}.centerX`);
		if (shape.centerY !== undefined) finiteNumber(shape.centerY, `${path}.centerY`);
		return shape;
	}
	if (shape.type === "polygon") {
		rejectShapeKeys(shape, new Set(["type", "points"]), path);
		if (!Array.isArray(shape.points) || shape.points.length < 3) {
			throw new Error(`${path}.points must contain at least three points.`);
		}
		const points = shape.points.map((point, index) => {
			if (!point || typeof point !== "object" || Array.isArray(point)) {
				throw new Error(`${path}.points[${index}] must be an object.`);
			}
			rejectShapeKeys(point, new Set(["x", "y"]), `${path}.points[${index}]`);
			return {
				x: finiteNumber(point.x, `${path}.points[${index}].x`),
				y: finiteNumber(point.y, `${path}.points[${index}].y`),
			};
		});
		let doubledArea = 0;
		for (let index = 0; index < points.length; index++) {
			const point = points[index];
			const next = points[(index + 1) % points.length];
			doubledArea += point.x * next.y - point.y * next.x;
		}
		if (Math.abs(doubledArea) <= GEOMETRY_TOLERANCE) {
			throw new Error(`${path} polygon must have non-zero area.`);
		}
		return shape;
	}
	throw new Error(`${path}.type must be circle or polygon.`);
}

function localPolygon(actor) {
	const points = actor?.shape?.points;
	if (!Array.isArray(points) || points.length < 3) return null;
	return points.map((point) => ({
		x: Number(actor.x) + Number(point.x),
		y: Number(actor.y) + Number(point.y),
	}));
}

export function getRenderedShape(actor) {
	if (actor?.shape?.type === "circle") {
		const { width, height } = rectSize(actor);
		const radius = Math.max(
			0,
			Number(actor.shape.radius ?? Math.min(width, height) / 2) || 0,
		);
		return {
			type: "circle",
			x: Number(actor.x) + Number(actor.shape.centerX ?? width / 2),
			y: Number(actor.y) + Number(actor.shape.centerY ?? height / 2),
			radius,
		};
	}
	return {
		type: "polygon",
		points: localPolygon(actor) ?? rectPolygon(actor),
	};
}

function pointOnSegment(point, first, second) {
	const cross = (point.x - first.x) * (second.y - first.y) -
		(point.y - first.y) * (second.x - first.x);
	if (Math.abs(cross) > GEOMETRY_TOLERANCE) return false;
	const dot = (point.x - first.x) * (second.x - first.x) +
		(point.y - first.y) * (second.y - first.y);
	const lengthSquared = (second.x - first.x) ** 2 +
		(second.y - first.y) ** 2;
	return dot >= -GEOMETRY_TOLERANCE && dot <= lengthSquared + GEOMETRY_TOLERANCE;
}

function pointInsidePolygonStrict(point, points) {
	let inside = false;
	for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
		const first = points[previous];
		const second = points[index];
		if (pointOnSegment(point, first, second)) return false;
		const crosses = (first.y > point.y) !== (second.y > point.y) &&
			point.x < (second.x - first.x) * (point.y - first.y) /
				(second.y - first.y) + first.x;
		if (crosses) inside = !inside;
	}
	return inside;
}

function distanceSquaredToSegment(point, first, second) {
	const dx = second.x - first.x;
	const dy = second.y - first.y;
	const lengthSquared = dx * dx + dy * dy;
	const progress = lengthSquared <= GEOMETRY_TOLERANCE
		? 0
		: Math.max(0, Math.min(1,
			((point.x - first.x) * dx + (point.y - first.y) * dy) /
				lengthSquared,
		));
	const closestX = first.x + dx * progress;
	const closestY = first.y + dy * progress;
	return (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
}

function segmentsCrossStrict(firstA, firstB, secondA, secondB) {
	const cross = (ax, ay, bx, by) => ax * by - ay * bx;
	const firstDx = firstB.x - firstA.x;
	const firstDy = firstB.y - firstA.y;
	const secondDx = secondB.x - secondA.x;
	const secondDy = secondB.y - secondA.y;
	const denominator = cross(firstDx, firstDy, secondDx, secondDy);
	if (Math.abs(denominator) <= GEOMETRY_TOLERANCE) return false;
	const offsetX = secondA.x - firstA.x;
	const offsetY = secondA.y - firstA.y;
	const firstProgress = cross(offsetX, offsetY, secondDx, secondDy) / denominator;
	const secondProgress = cross(offsetX, offsetY, firstDx, firstDy) / denominator;
	return (
		firstProgress > GEOMETRY_TOLERANCE &&
		firstProgress < 1 - GEOMETRY_TOLERANCE &&
		secondProgress > GEOMETRY_TOLERANCE &&
		secondProgress < 1 - GEOMETRY_TOLERANCE
	);
}

export function circleOverlapsRenderedShape(circleX, circleY, radius, actor) {
	const shape = getRenderedShape(actor);
	const safeRadius = Math.max(0, Number(radius) || 0);
	if (shape.type === "circle") {
		const combinedRadius = safeRadius + shape.radius;
		const distanceSquared = (circleX - shape.x) ** 2 + (circleY - shape.y) ** 2;
		return distanceSquared < combinedRadius ** 2 - GEOMETRY_TOLERANCE;
	}

	const point = { x: circleX, y: circleY };
	if (pointInsidePolygonStrict(point, shape.points)) return true;
	if (safeRadius <= 0) return false;
	for (let index = 0; index < shape.points.length; index++) {
		const first = shape.points[index];
		const second = shape.points[(index + 1) % shape.points.length];
		if (
			distanceSquaredToSegment(point, first, second) <
			safeRadius ** 2 - GEOMETRY_TOLERANCE
		) return true;
	}
	return false;
}

export function renderedShapeIntersectsPolygon(actor, polygon) {
	if (!Array.isArray(polygon) || polygon.length < 3) return false;
	const shape = getRenderedShape(actor);
	if (shape.type === "circle") {
		const center = { x: shape.x, y: shape.y };
		if (pointInsidePolygonStrict(center, polygon)) return true;
		for (let index = 0; index < polygon.length; index++) {
			if (
				distanceSquaredToSegment(
					center,
					polygon[index],
					polygon[(index + 1) % polygon.length],
				) < shape.radius ** 2 - GEOMETRY_TOLERANCE
			) return true;
		}
		return false;
	}

	if (shape.points.some((point) => pointInsidePolygonStrict(point, polygon))) {
		return true;
	}
	if (polygon.some((point) => pointInsidePolygonStrict(point, shape.points))) {
		return true;
	}
	for (let firstIndex = 0; firstIndex < shape.points.length; firstIndex++) {
		const firstA = shape.points[firstIndex];
		const firstB = shape.points[(firstIndex + 1) % shape.points.length];
		for (let secondIndex = 0; secondIndex < polygon.length; secondIndex++) {
			if (segmentsCrossStrict(
				firstA,
				firstB,
				polygon[secondIndex],
				polygon[(secondIndex + 1) % polygon.length],
			)) return true;
		}
	}
	return false;
}

function rayCircleEntry(origin, direction, center, radius) {
	const relX = origin.x - center.x;
	const relY = origin.y - center.y;
	const combined = Math.max(0, Number(radius) || 0);
	const c = relX * relX + relY * relY - combined * combined;
	if (c < -GEOMETRY_TOLERANCE) return 0;
	const projection = relX * direction.x + relY * direction.y;
	const discriminant = projection * projection - c;
	if (discriminant <= GEOMETRY_TOLERANCE) return null;
	const entry = -projection - Math.sqrt(discriminant);
	if (entry >= -GEOMETRY_TOLERANCE) return Math.max(0, entry);
	return null;
}

function raySegmentCandidates(origin, direction, first, second) {
	const edgeX = second.x - first.x;
	const edgeY = second.y - first.y;
	const denominator = direction.x * edgeY - direction.y * edgeX;
	if (Math.abs(denominator) <= GEOMETRY_TOLERANCE) return [];
	const offsetX = first.x - origin.x;
	const offsetY = first.y - origin.y;
	const distance = (offsetX * edgeY - offsetY * edgeX) / denominator;
	const progress = (offsetX * direction.y - offsetY * direction.x) / denominator;
	return distance >= -GEOMETRY_TOLERANCE &&
		progress >= -GEOMETRY_TOLERANCE &&
		progress <= 1 + GEOMETRY_TOLERANCE
		? [Math.max(0, distance)]
		: [];
}

function rayCapsuleCandidates(origin, direction, first, second, radius) {
	if (radius <= 0) return [];
	const edgeX = second.x - first.x;
	const edgeY = second.y - first.y;
	const length = Math.hypot(edgeX, edgeY);
	if (length <= GEOMETRY_TOLERANCE) {
		const entry = rayCircleEntry(origin, direction, first, radius);
		return entry === null ? [] : [entry];
	}
	const unitX = edgeX / length;
	const unitY = edgeY / length;
	const normalX = -unitY;
	const normalY = unitX;
	const relX = origin.x - first.x;
	const relY = origin.y - first.y;
	const along = relX * unitX + relY * unitY;
	const across = relX * normalX + relY * normalY;
	const directionAlong = direction.x * unitX + direction.y * unitY;
	const directionAcross = direction.x * normalX + direction.y * normalY;
	const candidates = [];
	if (Math.abs(directionAcross) > GEOMETRY_TOLERANCE) {
		for (const boundary of [-radius, radius]) {
			const distance = (boundary - across) / directionAcross;
			const at = along + distance * directionAlong;
			if (
				distance >= -GEOMETRY_TOLERANCE &&
				at > GEOMETRY_TOLERANCE &&
				at < length - GEOMETRY_TOLERANCE
			) candidates.push(Math.max(0, distance));
		}
	}
	for (const endpoint of [first, second]) {
		const entry = rayCircleEntry(origin, direction, endpoint, radius);
		if (entry !== null) candidates.push(entry);
	}
	return candidates;
}

// Earliest distance at which a ray's circular cross-section strictly overlaps
// the rendered actor. Sampling immediately after analytic boundary candidates
// distinguishes an entering corner crossing from exact tangency.
export function rayIntersectsRenderedShape(
	originX,
	originY,
	dirX,
	dirY,
	actor,
	radius = 0,
	maxDistance = Infinity,
) {
	const magnitude = Math.hypot(dirX, dirY);
	if (magnitude <= GEOMETRY_TOLERANCE) return null;
	const origin = { x: Number(originX), y: Number(originY) };
	const direction = { x: dirX / magnitude, y: dirY / magnitude };
	const safeRadius = Math.max(0, Number(radius) || 0);
	const shape = getRenderedShape(actor);
	if (circleOverlapsRenderedShape(origin.x, origin.y, safeRadius, actor)) {
		return { entryDistance: 0 };
	}

	if (shape.type === "circle") {
		const entry = rayCircleEntry(
			origin,
			direction,
			{ x: shape.x, y: shape.y },
			shape.radius + safeRadius,
		);
		return entry !== null && entry <= maxDistance + GEOMETRY_TOLERANCE
			? { entryDistance: entry }
			: null;
	}

	const candidates = [];
	for (let index = 0; index < shape.points.length; index++) {
		const first = shape.points[index];
		const second = shape.points[(index + 1) % shape.points.length];
		candidates.push(...raySegmentCandidates(origin, direction, first, second));
		candidates.push(...rayCapsuleCandidates(
			origin,
			direction,
			first,
			second,
			safeRadius,
		));
	}
	candidates.sort((first, second) => first - second);
	const sampleDistance = 1e-7;
	for (const candidate of candidates) {
		if (candidate > maxDistance + GEOMETRY_TOLERANCE) break;
		const after = candidate + sampleDistance;
		if (circleOverlapsRenderedShape(
			origin.x + direction.x * after,
			origin.y + direction.y * after,
			safeRadius,
			actor,
		)) return { entryDistance: Math.max(0, candidate) };
	}
	return null;
}
