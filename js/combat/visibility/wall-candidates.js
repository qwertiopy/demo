// Broad-phase wall collection and reusable aim corner records.

import { queryWallsInAabb } from "../../spatial/wall-index.js";
import { GEOMETRY_EPSILON } from "./constants.js";
import {
	createWallCornerRecord,
	getExpandedWallDistance,
	getWallBlockedAngleIntervals,
	isWallCornerRecordCurrent,
	updateWallCornerRecordAngles,
} from "./geometry.js";
import { shortestAngleDelta } from "../weapon-utils.js";

function getAimConeQueryBounds(
	originX,
	originY,
	centerAngle,
	halfAngle,
	maxDistance,
	padding,
) {
	const points = [{ x: originX, y: originY }];
	const addOuterPoint = (angle) => {
		points.push({
			x: originX + Math.cos(angle) * maxDistance,
			y: originY + Math.sin(angle) * maxDistance,
		});
	};

	if (halfAngle >= Math.PI - GEOMETRY_EPSILON) {
		for (let index = 0; index < 4; index++) {
			addOuterPoint(index * Math.PI / 2);
		}
	} else {
		addOuterPoint(centerAngle - halfAngle);
		addOuterPoint(centerAngle + halfAngle);
		for (let index = 0; index < 4; index++) {
			const cardinalAngle = index * Math.PI / 2;
			if (
				Math.abs(shortestAngleDelta(centerAngle, cardinalAngle)) <=
				halfAngle + GEOMETRY_EPSILON
			) {
				addOuterPoint(cardinalAngle);
			}
		}
	}

	return {
		minX: Math.min(...points.map((point) => point.x)) - padding,
		minY: Math.min(...points.map((point) => point.y)) - padding,
		maxX: Math.max(...points.map((point) => point.x)) + padding,
		maxY: Math.max(...points.map((point) => point.y)) + padding,
	};
}

export function getAimConeWallScanCandidates(
	originX,
	originY,
	centerAngle,
	halfAngle,
	maxDistance,
	projectileRadius = 0,
) {
	const safeHalfAngle = Math.max(
		0,
		Math.min(Math.PI, Number(halfAngle) || 0),
	);
	const safeDistance = Math.max(0, Number(maxDistance) || 0);
	const safeRadius = Math.max(0, Number(projectileRadius) || 0);
	const queryBounds = getAimConeQueryBounds(
		originX,
		originY,
		centerAngle,
		safeHalfAngle,
		safeDistance,
		safeRadius,
	);

	return queryWallsInAabb(
		queryBounds.minX,
		queryBounds.minY,
		queryBounds.maxX,
		queryBounds.maxY,
	)
		.map((wall) => ({
			wall,
			...getExpandedWallDistance(originX, originY, wall, safeRadius),
		}))
		.filter(
			(candidate) =>
				candidate.distance <= safeDistance + GEOMETRY_EPSILON,
		)
		.sort((first, second) => first.distance - second.distance)
		.map((candidate) => candidate.wall);
}

export function getAimWallCornerRecord(
	wall,
	projectileRadius,
	cornerCache,
	originX,
	originY,
) {
	const safeRadius = Math.max(0, Number(projectileRadius) || 0);
	let record = cornerCache?.get(wall) || null;
	if (!isWallCornerRecordCurrent(record, wall, safeRadius)) {
		record = createWallCornerRecord(wall, safeRadius);
		cornerCache?.set(wall, record);
	}

	return updateWallCornerRecordAngles(record, originX, originY);
}

export function getAimConeWallCandidates(
	originX,
	originY,
	centerAngle,
	halfAngle,
	maxDistance,
	projectileRadius = 0,
	{
		cornerCache = null,
		onWall = null,
	} = {},
) {
	const safeHalfAngle = Math.max(
		0,
		Math.min(Math.PI, Number(halfAngle) || 0),
	);
	const safeDistance = Math.max(0, Number(maxDistance) || 0);
	const safeRadius = Math.max(0, Number(projectileRadius) || 0);
	const nearbyWalls = getAimConeWallScanCandidates(
		originX,
		originY,
		centerAngle,
		safeHalfAngle,
		safeDistance,
		safeRadius,
	).map((wall) => ({
		wall,
		...getExpandedWallDistance(originX, originY, wall, safeRadius),
	}));
	const walls = [];
	let scannedCount = 0;
	let truncated = false;

	for (const candidate of nearbyWalls) {
		if (
			typeof onWall === "function" &&
			onWall(candidate.wall, candidate.distance) === false
		) {
			truncated = true;
			break;
		}
		scannedCount++;

		const record = getAimWallCornerRecord(
			candidate.wall,
			safeRadius,
			cornerCache,
			originX,
			originY,
		);

		const blocked = getWallBlockedAngleIntervals(
			record,
			originX,
			originY,
			centerAngle,
			safeHalfAngle,
			safeDistance,
			safeRadius,
		);
		if (!blocked.fullyBlocked && blocked.intervals.length === 0) continue;

		walls.push(record);
		if (blocked.fullyBlocked) break;
	}

	return {
		walls,
		truncated,
		scannedCount,
		candidateCount: nearbyWalls.length,
	};
}
