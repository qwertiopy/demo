// Continuous visibility-polygon laser cones.

import { Config } from "../../config.js";
import { GameState, player, TEAM_PLAYER } from "../../state.js";
import {
	consumeLaserCalculationBudget,
	getLaserLoadedRangeBlocks,
	queryLaserWallsAlongRay,
} from "./budget.js";
import {
	getWallCornerCriticalAngles,
	rayRectIntersection,
} from "../visibility.js";

function getLaserConeWallStop(originX, originY, dirX, dirY, maxRangeBlocks) {
	let closestDistance = Math.max(0, Number(maxRangeBlocks) || 0);
	const rayWalls = queryLaserWallsAlongRay(
		originX,
		originY,
		dirX,
		dirY,
		closestDistance,
		0,
	);

	if (rayWalls.truncated) {
		return { distance: 0, truncated: true };
	}

	for (const wall of rayWalls.walls) {
		if (!consumeLaserCalculationBudget()) {
			return { distance: 0, truncated: true };
		}

		const hit = rayRectIntersection(originX, originY, dirX, dirY, wall, 0);
		if (!hit || hit.entryDistance > closestDistance) continue;
		closestDistance = Math.max(0, hit.entryDistance);
	}

	return { distance: closestDistance, truncated: false };
}

function getLaserConeCriticalAngles(originX, originY, centerAngle, halfAngle) {
	return getWallCornerCriticalAngles(
		originX,
		originY,
		centerAngle,
		halfAngle,
		GameState.walls,
		{
			onWall: () => consumeLaserCalculationBudget(),
		},
	);
}

function buildLaserConeVisibilityPolygon(originX, originY, centerAngle, halfAngle) {
	const fullCircle = halfAngle >= Math.PI - 1e-9;
	const critical = getLaserConeCriticalAngles(
		originX,
		originY,
		centerAngle,
		halfAngle,
	);

	if (critical.truncated) {
		return { polygon: [], truncated: true };
	}

	const edgePoints = [];
	for (const angle of critical.angles) {
		const dirX = Math.cos(angle);
		const dirY = Math.sin(angle);
		const maxRangeBlocks = getLaserLoadedRangeBlocks(
			originX,
			originY,
			dirX,
			dirY,
		);
		const wallStop = getLaserConeWallStop(
			originX,
			originY,
			dirX,
			dirY,
			maxRangeBlocks,
		);

		if (wallStop.truncated) {
			return { polygon: [], truncated: true };
		}

		edgePoints.push({
			x: originX + dirX * wallStop.distance,
			y: originY + dirY * wallStop.distance,
		});
	}

	return {
		polygon: fullCircle
			? edgePoints
			: [{ x: originX, y: originY }, ...edgePoints],
		truncated: false,
	};
}

function pointInPolygon(pointX, pointY, polygon) {
	let inside = false;

	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		const crossesY = (a.y > pointY) !== (b.y > pointY);
		if (!crossesY) continue;

		const edgeX =
			((b.x - a.x) * (pointY - a.y)) / (b.y - a.y) + a.x;
		if (pointX < edgeX) inside = !inside;
	}

	return inside;
}

function pointInRect(point, rect) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	return (
		point.x >= rect.x &&
		point.x <= rect.x + width &&
		point.y >= rect.y &&
		point.y <= rect.y + height
	);
}

function orientation(a, b, c) {
	return (b.x - a.x) * (c.y - a.y) -
		(b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(a, b, point) {
	const EPSILON = 1e-9;
	return (
		Math.abs(orientation(a, b, point)) <= EPSILON &&
		point.x >= Math.min(a.x, b.x) - EPSILON &&
		point.x <= Math.max(a.x, b.x) + EPSILON &&
		point.y >= Math.min(a.y, b.y) - EPSILON &&
		point.y <= Math.max(a.y, b.y) + EPSILON
	);
}

function segmentsIntersectInclusive(a, b, c, d) {
	const EPSILON = 1e-9;
	const o1 = orientation(a, b, c);
	const o2 = orientation(a, b, d);
	const o3 = orientation(c, d, a);
	const o4 = orientation(c, d, b);

	if (
		((o1 > EPSILON && o2 < -EPSILON) ||
			(o1 < -EPSILON && o2 > EPSILON)) &&
		((o3 > EPSILON && o4 < -EPSILON) ||
			(o3 < -EPSILON && o4 > EPSILON))
	) {
		return true;
	}

	return (
		pointOnSegment(a, b, c) ||
		pointOnSegment(a, b, d) ||
		pointOnSegment(c, d, a) ||
		pointOnSegment(c, d, b)
	);
}

function rectIntersectsPolygon(rect, polygon) {
	if (!Array.isArray(polygon) || polygon.length < 3) return false;

	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const rectPoints = [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + width, y: rect.y },
		{ x: rect.x + width, y: rect.y + height },
		{ x: rect.x, y: rect.y + height },
	];

	if (rectPoints.some((point) => pointInPolygon(point.x, point.y, polygon))) {
		return true;
	}

	if (polygon.some((point) => pointInRect(point, rect))) {
		return true;
	}

	const rectEdges = [
		[rectPoints[0], rectPoints[1]],
		[rectPoints[1], rectPoints[2]],
		[rectPoints[2], rectPoints[3]],
		[rectPoints[3], rectPoints[0]],
	];

	for (let i = 0; i < polygon.length; i++) {
		const polygonEdgeStart = polygon[i];
		const polygonEdgeEnd = polygon[(i + 1) % polygon.length];

		for (const [rectEdgeStart, rectEdgeEnd] of rectEdges) {
			if (
				segmentsIntersectInclusive(
					polygonEdgeStart,
					polygonEdgeEnd,
					rectEdgeStart,
					rectEdgeEnd,
				)
			) {
				return true;
			}
		}
	}

	return false;
}

export function resolveLaserConeShot(shot, currentTime) {
	const originX = shot.shooter.x + shot.shooter.size / 2;
	const originY = shot.shooter.y + shot.shooter.size / 2;
	const visibility = buildLaserConeVisibilityPolygon(
		originX,
		originY,
		shot.centerAngle,
		shot.coneHalfAngle,
	);

	// If the shared frame budget is exhausted, fail conservatively rather than
	// drawing or damaging through wall geometry we did not finish checking.
	if (visibility.truncated || visibility.polygon.length < 3) return;

	const isPlayerShot = shot.team === TEAM_PLAYER;
	const targets = isPlayerShot ? GameState.enemies : [player];
	for (const target of targets) {
		if (target.hp <= 0) continue;
		if (!consumeLaserCalculationBudget()) break;
		if (rectIntersectsPolygon(target, visibility.polygon)) {
			if (isPlayerShot || !GameState.isInvincible) {
				target.hp -= shot.stats.damage;
			}
		}
	}

	GameState.laserBeams.push({
		type: "cone",
		points: visibility.polygon,
		color: shot.stats.color ?? "white",
		createdAt: currentTime,
		durationMs: Math.max(
			0,
			Number(Config.RENDERING.LASER_FLASH_DURATION_MS) || 0,
		),
	});
}

