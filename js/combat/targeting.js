// Shared target acquisition helpers for chained projectiles and singular lasers.

import { GameState } from "../state.js";
import { hasLineOfSight } from "./collision.js";
import { shortestAngleDelta } from "./weapon-utils.js";

const AIM_EPSILON = 1e-10;

function clampUnit(value) {
	return Math.max(-1, Math.min(1, value));
}

// Maximum constant-velocity intercept offset either side of direct line of
// sight. When the target is at least as fast as the projectile, clamp the
// ratio so callers still receive a finite +/- PI/2 fallback envelope.
export function calculateMaximumLeadHalfAngle(
	targetSpeed,
	projectileSpeed,
) {
	const speed = Math.max(0, Number(targetSpeed) || 0);
	const bulletSpeed = Math.max(0, Number(projectileSpeed) || 0);

	if (bulletSpeed <= AIM_EPSILON) return 0;
	return Math.asin(clampUnit(speed / bulletSpeed));
}

// Farthest constant-speed interception distance: the target spends the whole
// flight moving directly away from the shooter. Unlike predictive lead, this
// envelope depends only on current separation and the two maximum speeds.
export function calculateMaximumFleeInterceptDistance(
	distance,
	targetSpeed,
	projectileSpeed,
) {
	const currentDistance = Math.max(0, Number(distance) || 0);
	const speed = Math.max(0, Number(targetSpeed) || 0);
	const bulletSpeed = Math.max(0, Number(projectileSpeed) || 0);

	if (currentDistance <= AIM_EPSILON) return 0;
	if (bulletSpeed <= speed + AIM_EPSILON) return Infinity;

	return (currentDistance * bulletSpeed) / (bulletSpeed - speed);
}

// Returns the largest angular advance that keeps consecutive wall shots from
// skipping over a player moving adversarially between firing events. The
// encounter distance assumes the player flees directly away at targetSpeed.
// A safety factor below one leaves a deliberate overlap between shots.
export function calculateGapSafeWallAngle(
	distance,
	targetSpeed,
	projectileSpeed,
	shotIntervalSeconds,
	combinedHitRadius,
	safetyFactor = 1,
) {
	const currentDistance = Math.max(0, Number(distance) || 0);
	const speed = Math.max(0, Number(targetSpeed) || 0);
	const bulletSpeed = Math.max(0, Number(projectileSpeed) || 0);
	const shotInterval = Math.max(0, Number(shotIntervalSeconds) || 0);
	const hitRadius = Math.max(0, Number(combinedHitRadius) || 0);
	const overlapFactor = Math.max(0, Math.min(2, Number(safetyFactor) || 0));

	if (
		currentDistance <= AIM_EPSILON ||
		bulletSpeed <= speed + AIM_EPSILON ||
		hitRadius <= AIM_EPSILON ||
		overlapFactor <= 0
	) {
		return 0;
	}

	const encounterDistance =
		(currentDistance * bulletSpeed) / (bulletSpeed - speed);
	if (!Number.isFinite(encounterDistance) || encounterDistance <= AIM_EPSILON) {
		return 0;
	}

	const projectileCoverage =
		2 * Math.asin(clampUnit(hitRadius / encounterDistance));
	const targetAngularMovement = Math.asin(
		clampUnit((speed * shotInterval) / encounterDistance),
	);
	const safeAngle = projectileCoverage - targetAngularMovement;

	return Math.max(0, safeAngle) * overlapFactor;
}

export function getTargetCenter(target) {
	const width = target.width ?? target.size ?? 0;
	const height = target.height ?? target.size ?? 0;

	return {
		x: target.x + width / 2,
		y: target.y + height / 2,
	};
}

export function getAngleToTarget(originX, originY, target) {
	const center = getTargetCenter(target);
	return Math.atan2(center.y - originY, center.x - originX);
}

export function hasTargetLineOfSight(originX, originY, target) {
	const center = getTargetCenter(target);
	return hasLineOfSight(originX, originY, center.x, center.y);
}

// Solves the constant-velocity interception problem for a projectile with a
// fixed speed. The caller should pass the configured/base projectile speed,
// not a randomized per-shot speed, so prediction only uses information the
// shooter can actually know. Returns null when no future intercept exists.
export function calculateInterceptAim(
	originX,
	originY,
	targetX,
	targetY,
	targetVx,
	targetVy,
	projectileSpeed,
) {
	const rx = Number(targetX) - Number(originX);
	const ry = Number(targetY) - Number(originY);
	const vx = Number(targetVx) || 0;
	const vy = Number(targetVy) || 0;
	const speed = Math.max(0, Number(projectileSpeed) || 0);
	const EPSILON = 1e-10;

	if (![rx, ry, vx, vy, speed].every(Number.isFinite) || speed <= EPSILON) {
		return null;
	}

	const a = vx * vx + vy * vy - speed * speed;
	const b = 2 * (rx * vx + ry * vy);
	const c = rx * rx + ry * ry;
	let time = null;

	if (Math.abs(a) <= EPSILON) {
		if (Math.abs(b) > EPSILON) {
			const linearTime = -c / b;
			if (linearTime > EPSILON) time = linearTime;
		}
	} else {
		const discriminant = b * b - 4 * a * c;
		if (discriminant >= -EPSILON) {
			const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
			const denominator = 2 * a;
			const firstTime = (-b - sqrtDiscriminant) / denominator;
			const secondTime = (-b + sqrtDiscriminant) / denominator;

			for (const candidate of [firstTime, secondTime]) {
				if (
					Number.isFinite(candidate) &&
					candidate > EPSILON &&
					(time === null || candidate < time)
				) {
					time = candidate;
				}
			}
		}
	}

	if (time === null) return null;

	const x = Number(targetX) + vx * time;
	const y = Number(targetY) + vy * time;

	return {
		x,
		y,
		time,
		angle: Math.atan2(y - originY, x - originX),
	};
}

// Candidates must be alive, not already hit by this chain, and pass either the
// default centerline line-of-sight test or a caller-supplied path-clearance test.
// Initial acquisition uses angle-first ordering; every reacquisition
// after a hit uses distance-first ordering. The alternate metric breaks ties so
// selection stays deterministic instead of depending on enemy array order.
export function findChainTarget(
	originX,
	originY,
	referenceAngle,
	excludedTargets = new Set(),
	priority = "angle",
	isPathClear = null,
) {
	let bestTarget = null;
	let bestAngleDelta = Infinity;
	let bestDistance = Infinity;
	const tieEpsilon = 1e-9;

	for (const target of GameState.enemies) {
		if (
			!target ||
			(Number(target.hp) || 0) <= 0 ||
			excludedTargets.has(target)
		) {
			continue;
		}

		const center = getTargetCenter(target);
		const pathIsClear = typeof isPathClear === "function"
			? isPathClear(target, center)
			: hasLineOfSight(originX, originY, center.x, center.y);
		if (!pathIsClear) continue;

		const dx = center.x - originX;
		const dy = center.y - originY;
		const distance = Math.hypot(dx, dy);
		const targetAngle = Math.atan2(dy, dx);
		const angleDelta = Math.abs(
			shortestAngleDelta(referenceAngle, targetAngle),
		);

		const isBetterTarget = priority === "distance"
			? (
				distance < bestDistance - tieEpsilon ||
				(
					Math.abs(distance - bestDistance) <= tieEpsilon &&
					angleDelta < bestAngleDelta
				)
			)
			: (
				angleDelta < bestAngleDelta - tieEpsilon ||
				(
					Math.abs(angleDelta - bestAngleDelta) <= tieEpsilon &&
					distance < bestDistance
				)
			);

		if (isBetterTarget) {
			bestTarget = target;
			bestAngleDelta = angleDelta;
			bestDistance = distance;
		}
	}

	return bestTarget;
}
