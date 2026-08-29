// Visible aim-interval construction and angle clamping.

import { queryWallsInAabb } from "../../spatial/wall-index.js";
import { DEFAULT_ANGLE_PROBE, GEOMETRY_EPSILON } from "./constants.js";
import { getWallBlockedAngleIntervals } from "./geometry.js";
import { getFirstRoundedWallHit, isRayClearToDistance } from "./raycast.js";
import { shortestAngleDelta } from "../weapon-utils.js";

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
