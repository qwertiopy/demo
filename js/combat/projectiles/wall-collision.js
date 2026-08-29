import { queryWallsInAabb } from "../../spatial/wall-index.js";
import { getCombatDefault } from "../defaults.js";

export function getBulletMaxStepBlocks() {
	return getCombatDefault("PROJECTILE_MAX_STEP_BLOCKS");
}

// Returns whether a projectile has bounce behaviour available. Throwables are
// always wall-bouncy; their configured maxBounces is reserved for boomerang
// endpoint reversals rather than wall impacts.
export function isBouncyProjectile(bullet) {
	return bullet.throwable === true || Math.max(0, bullet.maxBounces ?? 0) > 0;
}

// Wall collision uses the projectile's rendered circular hitbox.
function projectileCircleOverlapsWall(bullet, wall) {
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;
	const closestX = Math.max(wall.x, Math.min(bullet.x, wall.x + width));
	const closestY = Math.max(wall.y, Math.min(bullet.y, wall.y + height));
	const dx = bullet.x - closestX;
	const dy = bullet.y - closestY;
	const radius = Math.max(0, Number(bullet.radius) || 0);

	// Tangency is a resolved contact rather than overlap. This lets a bounced
	// projectile move away from or along a wall without immediately re-hitting.
	return dx * dx + dy * dy < radius * radius - 1e-10;
}

function getProjectileWallCandidates(bullet, moveX = 0, moveY = 0) {
	const radius = Math.max(0, Number(bullet.radius) || 0);
	const endX = bullet.x + moveX;
	const endY = bullet.y + moveY;

	return queryWallsInAabb(
		Math.min(bullet.x, endX) - radius,
		Math.min(bullet.y, endY) - radius,
		Math.max(bullet.x, endX) + radius,
		Math.max(bullet.y, endY) + radius,
	);
}

export function projectileOverlapsAnyWall(bullet) {
	return getProjectileWallCandidates(bullet).some((wall) =>
		projectileCircleOverlapsWall(bullet, wall)
	);
}

function dynamicCombatDefault(key) {
	return { valueOf: () => getCombatDefault(key) };
}

const WALL_TOI_EPSILON = dynamicCombatDefault("WALL_TOI_EPSILON");
export const WALL_APPROACH_EPSILON = dynamicCombatDefault("WALL_APPROACH_EPSILON");
export const WALL_CONTACT_NUDGE = dynamicCombatDefault("WALL_CONTACT_NUDGE");
export const MAX_WALL_IMPACTS_PER_SUBSTEP = dynamicCombatDefault(
	"MAX_WALL_IMPACTS_PER_SUBSTEP",
);
export const BULLET_MAX_STEP_BLOCKS = dynamicCombatDefault("PROJECTILE_MAX_STEP_BLOCKS");

export function reflectVector(x, y, normalX, normalY) {
	const dot = x * normalX + y * normalY;
	return {
		x: x - 2 * dot * normalX,
		y: y - 2 * dot * normalY,
	};
}

function getOverlapNormal(bullet, wall, moveX, moveY) {
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;
	const left = wall.x;
	const right = wall.x + width;
	const top = wall.y;
	const bottom = wall.y + height;
	const closestX = Math.max(left, Math.min(bullet.x, right));
	const closestY = Math.max(top, Math.min(bullet.y, bottom));
	const dx = bullet.x - closestX;
	const dy = bullet.y - closestY;
	const distance = Math.hypot(dx, dy);

	if (distance > WALL_APPROACH_EPSILON) {
		return { normalX: dx / distance, normalY: dy / distance };
	}

	// This fallback is only expected when a projectile begins a non-penetrating
	// step already inside wall material. Push against the incoming motion rather
	// than choosing an arbitrary wall face.
	if (Math.abs(moveX) >= Math.abs(moveY)) {
		return { normalX: moveX >= 0 ? -1 : 1, normalY: 0 };
	}

	return { normalX: 0, normalY: moveY >= 0 ? -1 : 1 };
}

function firstRayCircleHit(
	startX,
	startY,
	moveX,
	moveY,
	centerX,
	centerY,
	radius,
) {
	const a = moveX * moveX + moveY * moveY;
	if (a <= WALL_APPROACH_EPSILON) return null;

	const relX = startX - centerX;
	const relY = startY - centerY;
	const b = 2 * (relX * moveX + relY * moveY);
	const c = relX * relX + relY * relY - radius * radius;
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) return null;

	const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
	const denominator = 2 * a;
	const first = (-b - sqrtDiscriminant) / denominator;
	const second = (-b + sqrtDiscriminant) / denominator;

	if (first >= -WALL_TOI_EPSILON && first <= 1 + WALL_TOI_EPSILON) {
		return Math.max(0, Math.min(1, first));
	}
	if (second >= -WALL_TOI_EPSILON && second <= 1 + WALL_TOI_EPSILON) {
		return Math.max(0, Math.min(1, second));
	}

	return null;
}

// Exact swept-circle vs axis-aligned rectangle collision for one movement
// segment. Faces are tested as offset line segments and corners as circles,
// which preserves the true rounded Minkowski boundary instead of treating the
// projectile as a square-expanded AABB.
function sweptCircleWallHit(bullet, moveX, moveY, wall) {
	if (projectileCircleOverlapsWall(bullet, wall)) {
		const normal = getOverlapNormal(bullet, wall, moveX, moveY);
		return { time: 0, ...normal };
	}

	const radius = Math.max(0, Number(bullet.radius) || 0);
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;
	const left = wall.x;
	const right = wall.x + width;
	const top = wall.y;
	const bottom = wall.y + height;
	const startX = bullet.x;
	const startY = bullet.y;
	const candidates = [];

	const addCandidate = (time, normalX, normalY) => {
		if (!Number.isFinite(time)) return;
		if (time < -WALL_TOI_EPSILON || time > 1 + WALL_TOI_EPSILON) return;
		if (moveX * normalX + moveY * normalY >= -WALL_APPROACH_EPSILON) {
			return;
		}
		candidates.push({
			time: Math.max(0, Math.min(1, time)),
			normalX,
			normalY,
		});
	};

	if (moveX > WALL_APPROACH_EPSILON) {
		const time = (left - radius - startX) / moveX;
		const y = startY + moveY * time;
		if (y >= top - WALL_TOI_EPSILON && y <= bottom + WALL_TOI_EPSILON) {
			addCandidate(time, -1, 0);
		}
	} else if (moveX < -WALL_APPROACH_EPSILON) {
		const time = (right + radius - startX) / moveX;
		const y = startY + moveY * time;
		if (y >= top - WALL_TOI_EPSILON && y <= bottom + WALL_TOI_EPSILON) {
			addCandidate(time, 1, 0);
		}
	}

	if (moveY > WALL_APPROACH_EPSILON) {
		const time = (top - radius - startY) / moveY;
		const x = startX + moveX * time;
		if (x >= left - WALL_TOI_EPSILON && x <= right + WALL_TOI_EPSILON) {
			addCandidate(time, 0, -1);
		}
	} else if (moveY < -WALL_APPROACH_EPSILON) {
		const time = (bottom + radius - startY) / moveY;
		const x = startX + moveX * time;
		if (x >= left - WALL_TOI_EPSILON && x <= right + WALL_TOI_EPSILON) {
			addCandidate(time, 0, 1);
		}
	}

	const corners = [
		{ x: left, y: top, xSide: -1, ySide: -1 },
		{ x: right, y: top, xSide: 1, ySide: -1 },
		{ x: right, y: bottom, xSide: 1, ySide: 1 },
		{ x: left, y: bottom, xSide: -1, ySide: 1 },
	];

	for (const corner of corners) {
		const time = firstRayCircleHit(
			startX,
			startY,
			moveX,
			moveY,
			corner.x,
			corner.y,
			radius,
		);
		if (time === null) continue;

		const hitX = startX + moveX * time;
		const hitY = startY + moveY * time;
		const inCornerRegionX = corner.xSide < 0
			? hitX <= left + WALL_TOI_EPSILON
			: hitX >= right - WALL_TOI_EPSILON;
		const inCornerRegionY = corner.ySide < 0
			? hitY <= top + WALL_TOI_EPSILON
			: hitY >= bottom - WALL_TOI_EPSILON;
		if (!inCornerRegionX || !inCornerRegionY) continue;

		const normalDx = hitX - corner.x;
		const normalDy = hitY - corner.y;
		const normalLength = Math.hypot(normalDx, normalDy);
		if (normalLength <= WALL_APPROACH_EPSILON) continue;

		addCandidate(
			time,
			normalDx / normalLength,
			normalDy / normalLength,
		);
	}

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.time - b.time);
	return candidates[0];
}

// Find the earliest collision against the UNION of all wall rectangles. When
// multiple connected wall tiles are reached at the same time, combine their
// normals into one contact manifold. This is what prevents an internal seam or
// shared vertex from being mistaken for the side of whichever candidate wall
// happened to appear first. The spatial index only narrows the broad phase; the
// exact swept-circle manifold calculation below is unchanged.
export function findEarliestProjectileWallHit(bullet, moveX, moveY) {
	let earliestTime = Infinity;
	const simultaneousHits = [];
	const candidateWalls = getProjectileWallCandidates(bullet, moveX, moveY);

	for (const wall of candidateWalls) {
		const hit = sweptCircleWallHit(bullet, moveX, moveY, wall);
		if (!hit) continue;

		if (hit.time < earliestTime - WALL_TOI_EPSILON) {
			earliestTime = hit.time;
			simultaneousHits.length = 0;
			simultaneousHits.push(hit);
		} else if (Math.abs(hit.time - earliestTime) <= WALL_TOI_EPSILON) {
			simultaneousHits.push(hit);
		}
	}

	if (simultaneousHits.length === 0) return null;

	let normalX = 0;
	let normalY = 0;
	let mostOpposing = simultaneousHits[0];
	let mostOpposingDot = Infinity;

	for (const hit of simultaneousHits) {
		const approachDot = moveX * hit.normalX + moveY * hit.normalY;
		if (approachDot >= -WALL_APPROACH_EPSILON) continue;

		normalX += hit.normalX;
		normalY += hit.normalY;
		if (approachDot < mostOpposingDot) {
			mostOpposingDot = approachDot;
			mostOpposing = hit;
		}
	}

	const normalLength = Math.hypot(normalX, normalY);
	if (normalLength <= WALL_APPROACH_EPSILON) {
		normalX = mostOpposing.normalX;
		normalY = mostOpposing.normalY;
	} else {
		normalX /= normalLength;
		normalY /= normalLength;
	}

	return {
		time: earliestTime,
		normalX,
		normalY,
	};
}

