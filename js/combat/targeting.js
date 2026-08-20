// Shared target acquisition helpers for chained projectiles and singular lasers.

import { GameState } from "../state.js";
import { hasLineOfSight } from "./collision.js";
import { shortestAngleDelta } from "./weapon-utils.js";

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

// Candidates must be alive, not already hit by this chain, and visible from
// the origin. Initial acquisition uses angle-first ordering; every reacquisition
// after a hit uses distance-first ordering. The alternate metric breaks ties so
// selection stays deterministic instead of depending on enemy array order.
export function findChainTarget(
	originX,
	originY,
	referenceAngle,
	excludedTargets = new Set(),
	priority = "angle",
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
		if (!hasLineOfSight(originX, originY, center.x, center.y)) continue;

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
