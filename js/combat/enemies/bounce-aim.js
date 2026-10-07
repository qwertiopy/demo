// One-reflection aiming against the same swept-circle geometry as live bullets.
import { queryWallsInAabb } from "../../spatial/wall-index.js";
import { findEarliestProjectileWallHit, projectileOverlapsAnyWall, WALL_CONTACT_NUDGE } from "../projectiles/wall-collision.js";

const EPSILON = 1e-6;
const MAX_SEARCH_DISTANCE = 50;
const MAX_SEARCH_WALLS = 128;

export function canAimBounce(weapon) {
	return Number(weapon?.maxBounces) > 1;
}

export function findEnemyShotPaths(origin, target, weapon) {
	if (!canAimBounce(weapon)) return [];
	const radius = Math.max(0, Number(weapon.radiusBlocks) || 0);
	const bullet = { ...origin, radius };
	if (projectileOverlapsAnyWall(bullet)) return [];
	const dx = target.x - origin.x;
	const dy = target.y - origin.y;
	const directDistance = Math.hypot(dx, dy);
	const range = weapon.laser ? MAX_SEARCH_DISTANCE : Math.max(0,
		(Number(weapon.speed) - (Number(weapon.speedVariation) || 0)) * Number(weapon.lifetimeMs) / 1000);
	const paths = [];
	if (directDistance > EPSILON && directDistance <= range &&
		!findEarliestProjectileWallHit(bullet, dx, dy)) {
		paths.push({ angle: Math.atan2(dy, dx), origin: { ...origin }, target: { ...target }, bounce: null });
	}
	// Bound candidate work in dense/generated maps. Collision validation still
	// queries all walls along both legs, including walls outside this subset.
	const searchDistance = Math.min(MAX_SEARCH_DISTANCE, range);
	if (directDistance > range || directDistance > searchDistance * 2) return paths;
	const walls = queryWallsInAabb(origin.x - searchDistance, origin.y - searchDistance,
		origin.x + searchDistance, origin.y + searchDistance)
		.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))
		.slice(0, MAX_SEARCH_WALLS);
	for (const wall of walls) {
		const right = wall.x + (wall.width ?? wall.size);
		const bottom = wall.y + (wall.height ?? wall.size);
		const faces = [
			{ axis: 'x', plane: wall.x - radius, min: wall.y, max: bottom, nx: -1, ny: 0 },
			{ axis: 'x', plane: right + radius, min: wall.y, max: bottom, nx: 1, ny: 0 },
			{ axis: 'y', plane: wall.y - radius, min: wall.x, max: right, nx: 0, ny: -1 },
			{ axis: 'y', plane: bottom + radius, min: wall.x, max: right, nx: 0, ny: 1 },
		];
		for (const face of faces) {
			const axis = face.axis;
			const other = axis === 'x' ? 'y' : 'x';
			const normal = axis === 'x' ? face.nx : face.ny;
			if ((origin[axis] - face.plane) * normal <= EPSILON ||
				(target[axis] - face.plane) * normal <= EPSILON) continue;
			const mirrored = 2 * face.plane - target[axis];
			const t = (face.plane - origin[axis]) / (mirrored - origin[axis]);
			const along = origin[other] + t * (target[other] - origin[other]);
			// Rounded corners are not planar reflectors.
			if (along < face.min - EPSILON || along > face.max + EPSILON) continue;
			const bounce = { [axis]: face.plane, [other]: along };
			const mx = bounce.x - origin.x, my = bounce.y - origin.y;
			const length = Math.hypot(mx, my) + Math.hypot(target.x - bounce.x, target.y - bounce.y);
			if (length > range) continue;
			const hit = findEarliestProjectileWallHit(bullet, mx * (1 + EPSILON), my * (1 + EPSILON));
			if (!hit || Math.abs(hit.time * (1 + EPSILON) - 1) > EPSILON ||
				Math.abs(hit.normalX - face.nx) > EPSILON || Math.abs(hit.normalY - face.ny) > EPSILON) continue;
			const outgoing = { x: bounce.x + face.nx * Number(WALL_CONTACT_NUDGE),
				y: bounce.y + face.ny * Number(WALL_CONTACT_NUDGE), radius };
			if (projectileOverlapsAnyWall(outgoing) || findEarliestProjectileWallHit(outgoing,
				target.x - outgoing.x, target.y - outgoing.y)) continue;
			const angle = Math.atan2(my, mx);
			if (paths.some(path => Math.abs(path.angle - angle) < EPSILON)) continue;
			paths.push({ angle, origin: { ...origin }, bounce, target: { ...target } });
		}
	}
	return paths;
}

// Priority prefers a route type, falling back when that type is unavailable.
export function chooseEnemyShotPath(paths, priority = 0, random = Math.random) {
	const preferred = priority === -1 ? paths.filter(path => !path.bounce)
		: priority === 1 ? paths.filter(path => path.bounce) : paths;
	const choices = preferred.length ? preferred : paths;
	return choices.length ? choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] : null;
}
