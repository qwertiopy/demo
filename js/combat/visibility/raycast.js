// Exact ray intersection helpers shared by lasers, visibility, and homing.

import { GEOMETRY_EPSILON } from "./constants.js";
import { getWallBounds, getWallFromEntry } from "./geometry.js";

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

export function isRayClearToDistance(
	originX,
	originY,
	angle,
	maxDistance,
	projectileRadius,
	walls,
) {
	const dirX = Math.cos(angle);
	const dirY = Math.sin(angle);

	for (const wallEntry of walls) {
		const wall = getWallFromEntry(wallEntry);
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

export function getFirstRoundedWallHit(
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

	for (const wallEntry of walls) {
		const wall = getWallFromEntry(wallEntry);
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
