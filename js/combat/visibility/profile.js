// Polar visibility profile construction for debug and aiming consumers.

import { queryWallsInAabb } from "../../spatial/wall-index.js";
import { DEFAULT_ANGLE_PROBE, GEOMETRY_EPSILON } from "./constants.js";
import { getWallCornerCriticalAngles } from "./critical-angles.js";
import { dedupeSortedCriticalRays, getWallBlockedAngleIntervals } from "./geometry.js";
import { getFirstRoundedWallHit } from "./raycast.js";

export function getAimVisibilityProfile(
	originX,
	originY,
	centerAngle,
	halfAngle,
	maxDistance,
	projectileRadius = 0,
	walls = null,
) {
	const safeHalfAngle = Math.max(
		0,
		Math.min(Math.PI, Number(halfAngle) || 0),
	);
	const safeDistance = Math.max(0, Number(maxDistance) || 0);
	const safeRadius = Math.max(0, Number(projectileRadius) || 0);
	const candidateWalls = Array.isArray(walls)
		? walls
		: queryWallsInAabb(
			originX - safeDistance - safeRadius,
			originY - safeDistance - safeRadius,
			originX + safeDistance + safeRadius,
			originY + safeDistance + safeRadius,
		);
	const shadows = [];
	let containsOrigin = false;

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
		if (blocked.fullyBlocked) {
			containsOrigin = true;
			break;
		}
		for (const interval of blocked.intervals) {
			shadows.push({
				minOffset: interval.minOffset,
				maxOffset: interval.maxOffset,
				wall,
			});
		}
	}

	const sharedCritical = getWallCornerCriticalAngles(
		originX,
		originY,
		centerAngle,
		safeHalfAngle,
		candidateWalls,
		{
			angleProbe: DEFAULT_ANGLE_PROBE,
			padding: safeRadius,
			maxDistance: safeDistance,
		},
	);
	const profileRays = [
		{ localAngle: -safeHalfAngle },
		{ localAngle: 0 },
		{ localAngle: safeHalfAngle },
		...(sharedCritical.rays || []).map((ray) => ({
			localAngle: ray.localAngle,
		})),
	];

	for (const shadow of shadows) {
		for (const boundary of [shadow.minOffset, shadow.maxOffset]) {
			for (const offset of [
				boundary - DEFAULT_ANGLE_PROBE,
				boundary,
				boundary + DEFAULT_ANGLE_PROBE,
			]) {
				profileRays.push({
					localAngle: Math.max(
						-safeHalfAngle,
						Math.min(safeHalfAngle, offset),
					),
				});
			}
		}
	}

	const rays = dedupeSortedCriticalRays(profileRays).map((ray) => {
		const angle = centerAngle + ray.localAngle;
		if (containsOrigin) {
			return {
				angle,
				localAngle: ray.localAngle,
				distance: 0,
				blocked: true,
			};
		}

		const activeWalls = [];
		const seenWalls = new Set();
		for (const shadow of shadows) {
			if (
				ray.localAngle < shadow.minOffset - GEOMETRY_EPSILON ||
				ray.localAngle > shadow.maxOffset + GEOMETRY_EPSILON ||
				seenWalls.has(shadow.wall)
			) {
				continue;
			}
			seenWalls.add(shadow.wall);
			activeWalls.push(shadow.wall);
		}

		const hit = getFirstRoundedWallHit(
			originX,
			originY,
			angle,
			safeDistance,
			safeRadius,
			activeWalls,
		);

		return {
			angle,
			localAngle: ray.localAngle,
			distance: hit?.distance ?? safeDistance,
			blocked: hit !== null,
		};
	});

	return {
		originX,
		originY,
		centerAngle,
		halfAngle: safeHalfAngle,
		maxDistance: safeDistance,
		rays,
	};
}
