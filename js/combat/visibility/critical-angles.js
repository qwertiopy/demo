// Critical wall-angle generation for laser and aiming visibility work.

import { DEFAULT_ANGLE_PROBE, GEOMETRY_EPSILON } from "./constants.js";
import {
	dedupeSortedCriticalRays,
	getRoundedWallRangeIntersectionPoints,
	getWallCornerGeometry,
	getWallFromEntry,
	updateWallCornerRecordAngles,
} from "./geometry.js";
import { normalizeSignedAngle, shortestAngleDelta } from "../weapon-utils.js";

export function getWallCornerCriticalAngles(
	originX,
	originY,
	centerAngle,
	halfAngle,
	walls,
	{
		angleProbe = DEFAULT_ANGLE_PROBE,
		padding = 0,
		maxDistance = Infinity,
		onWall = null,
	} = {},
) {
	const safeHalfAngle = Math.max(0, Number(halfAngle) || 0);
	const safePadding = Math.max(0, Number(padding) || 0);
	const fullCircle = safeHalfAngle >= Math.PI - GEOMETRY_EPSILON;
	const localRays = [];

	function addLocalRay(localAngle, source = null) {
		if (fullCircle) {
			localRays.push({
				localAngle: normalizeSignedAngle(localAngle),
				source,
			});
			return;
		}

		localRays.push({
			localAngle: Math.max(
				-safeHalfAngle,
				Math.min(safeHalfAngle, localAngle),
			),
			source,
		});
	}

	function addAbsoluteCriticalAngle(absoluteAngle, source = null) {
		const localAngle = shortestAngleDelta(centerAngle, absoluteAngle);

		if (
			!fullCircle &&
			(localAngle < -safeHalfAngle - angleProbe ||
				localAngle > safeHalfAngle + angleProbe)
		) {
			return;
		}

		addLocalRay(localAngle - angleProbe);
		addLocalRay(localAngle, source);
		addLocalRay(localAngle + angleProbe);
	}

	if (fullCircle) {
		for (let i = 0; i < 8; i++) {
			addLocalRay(-Math.PI + (i * Math.PI) / 4);
		}
	} else {
		addLocalRay(-safeHalfAngle);
		addLocalRay(safeHalfAngle);
	}

	for (const wallEntry of walls || []) {
		const wall = getWallFromEntry(wallEntry);
		const geometry = updateWallCornerRecordAngles(
			getWallCornerGeometry(wallEntry, safePadding),
			originX,
			originY,
		);
		if (typeof onWall === "function" && onWall(wall) === false) {
			return { angles: [], truncated: true };
		}

		for (const point of getRoundedWallRangeIntersectionPoints(
			wall,
			originX,
			originY,
			maxDistance,
			safePadding,
		)) {
			addAbsoluteCriticalAngle(
				Math.atan2(point.y - originY, point.x - originX),
				{ kind: "point", x: point.x, y: point.y },
			);
		}

		if (safePadding <= GEOMETRY_EPSILON) {
			for (let index = 0; index < geometry.corners.length; index++) {
				const corner = geometry.corners[index];
				addAbsoluteCriticalAngle(
					geometry.cornerAngles[index],
					{
						kind: "point",
						x: corner.x,
						y: corner.y,
					},
				);
			}
			continue;
		}

		const { left, right, top, bottom } = geometry.bounds;
		const roundedCorners = [
			{ x: left, y: top },
			{ x: right, y: top },
			{ x: right, y: bottom },
			{ x: left, y: bottom },
		];
		for (
			let cornerIndex = 0;
			cornerIndex < roundedCorners.length;
			cornerIndex++
		) {
			const corner = roundedCorners[cornerIndex];
			const dx = corner.x - originX;
			const dy = corner.y - originY;
			const distance = Math.hypot(dx, dy);
			const centerDirection = geometry.cornerAngles[cornerIndex];

			if (distance > safePadding + GEOMETRY_EPSILON) {
				const tangentOffset = Math.asin(
					Math.min(1, safePadding / distance),
				);

				for (const tangentSide of [-1, 1]) {
					addAbsoluteCriticalAngle(
						centerDirection + tangentSide * tangentOffset,
						{
							kind: "rounded-corner-tangent",
							x: corner.x,
							y: corner.y,
							radius: safePadding,
							tangentSide,
						},
					);
				}
			} else {
				addAbsoluteCriticalAngle(centerDirection, {
					kind: "rounded-corner-tangent",
					x: corner.x,
					y: corner.y,
					radius: safePadding,
					tangentSide: 0,
				});
			}
		}

		// Face/arc joins are harmless extra partitions and cover degenerate cases
		// where a tangent from an individual corner circle lies inside another
		// component of the rounded rectangle union.
		for (let index = 0; index < geometry.roundedJoinPoints.length; index++) {
			const point = geometry.roundedJoinPoints[index];
			addAbsoluteCriticalAngle(
				geometry.roundedJoinAngles[index],
				{ kind: "point", x: point.x, y: point.y },
			);
		}
	}

	const criticalRays = dedupeSortedCriticalRays(localRays).map((ray) => ({
		angle: centerAngle + ray.localAngle,
		localAngle: ray.localAngle,
		source: ray.source,
	}));

	return {
		angles: criticalRays.map((ray) => ray.angle),
		rays: criticalRays,
		truncated: false,
	};
}
