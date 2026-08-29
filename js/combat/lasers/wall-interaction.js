// Laser wall traversal and cumulative penetration handling.

import {
	consumeLaserCalculationBudget,
	getLaserLoadedRangeBlocks,
	queryLaserWallsAlongRay,
} from "./budget.js";
import { rayRectIntersection } from "../visibility.js";

// Finds the next laser wall action along one ray segment while consuming one
// cumulative penetration budget. A bouncy laser that spends its last
// penetration inside a wall finishes that wall and only bounces on the next
// wall contact, matching the moving-projectile penetration rule.
export function getLaserWallStopWithPenetrationBudget(
	originX,
	originY,
	dirX,
	dirY,
	radius,
	penetrationBlocks,
	maxRangeBlocks = null,
	bouncy = false,
) {
	let remainingPenetrationBlocks = Math.max(
		0,
		Number(penetrationBlocks) || 0,
	);
	const maxRange = maxRangeBlocks === null || maxRangeBlocks === undefined
		? getLaserLoadedRangeBlocks(originX, originY, dirX, dirY)
		: Math.max(0, Number(maxRangeBlocks) || 0);
	const wallIntervals = [];
	const rayWalls = queryLaserWallsAlongRay(
		originX,
		originY,
		dirX,
		dirY,
		maxRange,
		radius,
	);

	if (rayWalls.truncated) {
		return {
			distance: 0,
			impactedWall: false,
			remainingPenetrationBlocks,
			normalX: 0,
			normalY: 0,
			truncated: true,
		};
	}

	for (const wall of rayWalls.walls) {
		if (!consumeLaserCalculationBudget()) {
			return {
				distance: 0,
				impactedWall: false,
				remainingPenetrationBlocks,
				normalX: 0,
				normalY: 0,
				truncated: true,
			};
		}

		const hit = rayRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			wall,
			radius,
		);
		if (!hit || hit.entryDistance > maxRange) continue;

		const entryDistance = Math.max(0, hit.entryDistance);
		const exitDistance = Math.min(maxRange, hit.exitDistance);
		if (exitDistance <= entryDistance) continue;

		wallIntervals.push({
			entryDistance,
			exitDistance,
			normalX: hit.normalX,
			normalY: hit.normalY,
		});
	}

	wallIntervals.sort((a, b) => a.entryDistance - b.entryDistance);

	const mergedIntervals = [];
	for (const interval of wallIntervals) {
		const previous = mergedIntervals[mergedIntervals.length - 1];
		if (previous && interval.entryDistance <= previous.exitDistance + 1e-9) {
			previous.exitDistance = Math.max(
				previous.exitDistance,
				interval.exitDistance,
			);
		} else {
			mergedIntervals.push({ ...interval });
		}
	}

	for (const interval of mergedIntervals) {
		const wallTravelBlocks = interval.exitDistance - interval.entryDistance;

		if (remainingPenetrationBlocks >= wallTravelBlocks - 1e-12) {
			remainingPenetrationBlocks = Math.max(
				0,
				remainingPenetrationBlocks - wallTravelBlocks,
			);
			continue;
		}

		if (bouncy && remainingPenetrationBlocks > 0) {
			// Consume the rest of the budget, but finish this final wall before the
			// next collision is allowed to reflect the beam.
			remainingPenetrationBlocks = 0;
			continue;
		}

		const stopDistance = interval.entryDistance + remainingPenetrationBlocks;

		return {
			distance: Math.min(maxRange, stopDistance),
			impactedWall: true,
			remainingPenetrationBlocks: 0,
			normalX: interval.normalX,
			normalY: interval.normalY,
			truncated: false,
		};
	}

	return {
		distance: maxRange,
		impactedWall: false,
		remainingPenetrationBlocks,
		normalX: 0,
		normalY: 0,
		truncated: false,
	};
}

