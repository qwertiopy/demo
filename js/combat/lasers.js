// Singular laser beams plus continuous visibility-polygon laser cones.

import { Config } from "../config.js";
import { GameState } from "../state.js";
import { detonateBullet } from "./explosions.js";
import {
	getBulletCount,
	getLaserConeHalfAngleFromCount,
	getRandomSpreadOffset,
	getVariedStat,
	normalizeSignedAngle,
	shortestAngleDelta,
} from "./weapon-utils.js";

// Laser range is no longer capped by an arbitrary gameplay distance. Rays extend
// to the edge of the currently loaded world, while a shared per-frame calculation
// budget limits worst-case CPU work. One budget unit represents one potentially
// expensive laser/world or laser/entity geometry check.
export const DEFAULT_LASER_CALCULATION_BUDGET_PER_FRAME = 100000;

let laserCalculationBudgetRemaining = DEFAULT_LASER_CALCULATION_BUDGET_PER_FRAME;
let laserLoadedWorldBoundsCached = false;
let cachedLaserLoadedWorldBounds = null;
let laserLoadedWorldBoundsTruncated = false;

export function getLaserCalculationBudgetPerFrame() {
	return Math.max(
		1,
		Math.floor(
			Number(
				Config.RENDERING?.LASER_CALCULATION_BUDGET_PER_FRAME ??
					DEFAULT_LASER_CALCULATION_BUDGET_PER_FRAME,
			) || DEFAULT_LASER_CALCULATION_BUDGET_PER_FRAME,
		),
	);
}

export function resetLaserCalculationBudget() {
	laserCalculationBudgetRemaining = getLaserCalculationBudgetPerFrame();
	laserLoadedWorldBoundsCached = false;
	cachedLaserLoadedWorldBounds = null;
	laserLoadedWorldBoundsTruncated = false;
}

export function getLaserCalculationBudgetRemaining() {
	return laserCalculationBudgetRemaining;
}

function consumeLaserCalculationBudget(units = 1) {
	const cost = Math.max(1, Math.floor(Number(units) || 1));
	if (laserCalculationBudgetRemaining < cost) return false;
	laserCalculationBudgetRemaining -= cost;
	return true;
}

function getLaserLoadedWorldBounds() {
	if (laserLoadedWorldBoundsCached) return cachedLaserLoadedWorldBounds;

	laserLoadedWorldBoundsCached = true;
	laserLoadedWorldBoundsTruncated = false;

	if (GameState.walls.length > 0) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		for (const wall of GameState.walls) {
			if (!consumeLaserCalculationBudget()) {
				laserLoadedWorldBoundsTruncated = true;
				cachedLaserLoadedWorldBounds = null;
				return null;
			}

			const width = wall.width ?? wall.size ?? 0;
			const height = wall.height ?? wall.size ?? 0;
			minX = Math.min(minX, wall.x);
			minY = Math.min(minY, wall.y);
			maxX = Math.max(maxX, wall.x + width);
			maxY = Math.max(maxY, wall.y + height);
		}

		if (Number.isFinite(minX) && Number.isFinite(maxX)) {
			cachedLaserLoadedWorldBounds = {
				x: minX,
				y: minY,
				width: maxX - minX,
				height: maxY - minY,
			};
		}
	}

	return cachedLaserLoadedWorldBounds;
}

function getLaserFallbackLoadedRangeBlocks() {
	const rendering = Config.RENDERING || {};
	return Math.max(
		1,
		Number(rendering.DISTANCE_FRONT_BLOCKS ?? 35) +
			Number(rendering.DISTANCE_BACK_BLOCKS ?? 20) +
			Number(rendering.CLEANUP_BUFFER_BLOCKS ?? 0),
	);
}

function getLaserLoadedRangeBlocks(originX, originY, dirX, dirY) {
	const bounds = getLaserLoadedWorldBounds();
	if (!bounds) {
		return laserLoadedWorldBoundsTruncated
			? 0
			: getLaserFallbackLoadedRangeBlocks();
	}

	const hit = rayRectIntersection(originX, originY, dirX, dirY, bounds, 0);
	if (!hit) return 0;
	return Math.max(0, hit.exitDistance);
}

function getLaserLoadedWorldRadiusBlocks(originX, originY) {
	const bounds = getLaserLoadedWorldBounds();
	if (!bounds) {
		return laserLoadedWorldBoundsTruncated
			? 0
			: getLaserFallbackLoadedRangeBlocks();
	}

	const corners = [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		{ x: bounds.x, y: bounds.y + bounds.height },
	];

	return Math.max(
		1,
		...corners.map((corner) =>
			Math.hypot(corner.x - originX, corner.y - originY),
		),
	);
}

// Ray/AABB slab intersection. The optional radius expands the rectangle so a
// laser with a visible thickness also gets a matching collision thickness.
export function rayRectIntersection(
	originX,
	originY,
	dirX,
	dirY,
	rect,
	radius = 0,
) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const r = Math.max(0, Number(radius) || 0);
	const minX = rect.x - r;
	const maxX = rect.x + width + r;
	const minY = rect.y - r;
	const maxY = rect.y + height + r;
	const EPSILON = 1e-12;

	let xNear = -Infinity;
	let xFar = Infinity;
	let yNear = -Infinity;
	let yFar = Infinity;

	if (Math.abs(dirX) < EPSILON) {
		if (originX < minX || originX > maxX) return null;
	} else {
		const tx1 = (minX - originX) / dirX;
		const tx2 = (maxX - originX) / dirX;
		xNear = Math.min(tx1, tx2);
		xFar = Math.max(tx1, tx2);
	}

	if (Math.abs(dirY) < EPSILON) {
		if (originY < minY || originY > maxY) return null;
	} else {
		const ty1 = (minY - originY) / dirY;
		const ty2 = (maxY - originY) / dirY;
		yNear = Math.min(ty1, ty2);
		yFar = Math.max(ty1, ty2);
	}

	const tMin = Math.max(xNear, yNear);
	const tMax = Math.min(xFar, yFar);
	if (tMax < tMin || tMax < 0) return null;

	let normalX = 0;
	let normalY = 0;
	if (tMin >= 0) {
		if (Math.abs(xNear - yNear) <= EPSILON) {
			normalX = dirX >= 0 ? -1 : 1;
			normalY = dirY >= 0 ? -1 : 1;
			const magnitude = Math.hypot(normalX, normalY) || 1;
			normalX /= magnitude;
			normalY /= magnitude;
		} else if (xNear > yNear) {
			normalX = dirX >= 0 ? -1 : 1;
		} else {
			normalY = dirY >= 0 ? -1 : 1;
		}
	}

	return {
		entryDistance: Math.max(0, tMin),
		exitDistance: tMax,
		normalX,
		normalY,
	};
}

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

	for (const wall of GameState.walls) {
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

function createLaserExplosionAt(x, y, stats, currentTime) {
	return detonateBullet(
		{
			x,
			y,
			color: stats.color ?? "white",
			explosionRadiusBlocks: stats.explosionRadiusBlocks ?? 0,
			explosionDurationMs: stats.explosionDurationMs ?? 0,
			explosionDamage: stats.explosionDamage ?? 0,
		},
		true,
		currentTime,
	);
}

// Cone lasers deliberately use first-wall visibility only. Bounce and
// penetration remain available for singular beams and are ignored for cones.
function getLaserConeWallStop(originX, originY, dirX, dirY, maxRangeBlocks) {
	let closestDistance = Math.max(0, Number(maxRangeBlocks) || 0);

	for (const wall of GameState.walls) {
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
	const fullCircle = halfAngle >= Math.PI - 1e-9;
	const ANGLE_EPSILON = 1e-5;
	const localAngles = [];

	function addLocalAngle(localAngle) {
		if (fullCircle) {
			localAngles.push(normalizeSignedAngle(localAngle));
			return;
		}

		localAngles.push(Math.max(-halfAngle, Math.min(halfAngle, localAngle)));
	}

	if (fullCircle) {
		// A few world-boundary anchors keep an unobstructed full-circle cone well formed.
		for (let i = 0; i < 8; i++) {
			addLocalAngle(-Math.PI + (i * Math.PI) / 4);
		}
	} else {
		addLocalAngle(-halfAngle);
		addLocalAngle(halfAngle);
	}

	for (const wall of GameState.walls) {
		if (!consumeLaserCalculationBudget()) {
			return { angles: [], truncated: true };
		}

		const width = wall.width ?? wall.size ?? 0;
		const height = wall.height ?? wall.size ?? 0;
		const corners = [
			{ x: wall.x, y: wall.y },
			{ x: wall.x + width, y: wall.y },
			{ x: wall.x + width, y: wall.y + height },
			{ x: wall.x, y: wall.y + height },
		];

		for (const corner of corners) {
			const absoluteAngle = Math.atan2(
				corner.y - originY,
				corner.x - originX,
			);
			const localAngle = shortestAngleDelta(centerAngle, absoluteAngle);

			if (
				!fullCircle &&
				(localAngle < -halfAngle - ANGLE_EPSILON ||
					localAngle > halfAngle + ANGLE_EPSILON)
			) {
				continue;
			}

			// The rays immediately either side of a corner capture the visibility
			// discontinuity without brute-force sampling the whole cone.
			addLocalAngle(localAngle - ANGLE_EPSILON);
			addLocalAngle(localAngle);
			addLocalAngle(localAngle + ANGLE_EPSILON);
		}
	}

	localAngles.sort((a, b) => a - b);
	const deduped = [];
	for (const angle of localAngles) {
		if (
			deduped.length === 0 ||
			Math.abs(angle - deduped[deduped.length - 1]) > 1e-7
		) {
			deduped.push(angle);
		}
	}

	return {
		angles: deduped.map((localAngle) => centerAngle + localAngle),
		truncated: false,
	};
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

function resolveLaserConeShot(shot, currentTime) {
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

	for (const target of GameState.enemies) {
		if (target.hp <= 0) continue;
		if (!consumeLaserCalculationBudget()) break;
		if (rectIntersectsPolygon(target, visibility.polygon)) {
			target.hp -= shot.stats.damage ?? 1;
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

function resolveLaserBeamShot(shot, currentTime) {
	const shooter = shot.shooter;
	let originX = shooter.x + shooter.size / 2;
	let originY = shooter.y + shooter.size / 2;
	let dirX = shot.dirX;
	let dirY = shot.dirY;
	const { stats } = shot;
	const radius = Math.max(0, Number(stats.radiusBlocks ?? 0.03) || 0);
	let remainingPenetrationBlocks = Math.max(
		0,
		Number(stats.penetrationBlocks ?? 0) || 0,
	);
	const maxBounces = Math.max(0, Math.floor(Number(stats.maxBounces ?? 0) || 0));
	let bounces = 0;
	const hitTargets = new Set();
	const RAY_EPSILON = 1e-6;

	while (true) {
		const segmentRange = getLaserLoadedRangeBlocks(
			originX,
			originY,
			dirX,
			dirY,
		);
		if (segmentRange <= RAY_EPSILON) break;

		const wallStop = getLaserWallStopWithPenetrationBudget(
			originX,
			originY,
			dirX,
			dirY,
			radius,
			remainingPenetrationBlocks,
			segmentRange,
			maxBounces > 0,
		);
		if (wallStop.truncated) break;

		const beamDistance = wallStop.distance;
		remainingPenetrationBlocks = wallStop.remainingPenetrationBlocks;

		for (const target of GameState.enemies) {
			if (target.hp <= 0 || hitTargets.has(target)) continue;
			if (!consumeLaserCalculationBudget()) break;

			const hit = rayRectIntersection(
				originX,
				originY,
				dirX,
				dirY,
				target,
				radius,
			);

			if (hit && hit.entryDistance <= beamDistance + 1e-9) {
				target.hp -= stats.damage ?? 1;
				hitTargets.add(target);
			}
		}

		const endX = originX + dirX * beamDistance;
		const endY = originY + dirY * beamDistance;

		GameState.laserBeams.push({
			type: "beam",
			x1: originX,
			y1: originY,
			x2: endX,
			y2: endY,
			color: stats.color ?? "white",
			radius,
			createdAt: currentTime,
			durationMs: Math.max(
				0,
				Number(Config.RENDERING.LASER_FLASH_DURATION_MS) || 0,
			),
		});

		if (!wallStop.impactedWall) break;

		if (bounces < maxBounces) {
			// Every successful bounce of an explosive weapon creates its explosion
			// without consuming/removing the laser shot.
			createLaserExplosionAt(endX, endY, stats, currentTime);

			const dot = dirX * wallStop.normalX + dirY * wallStop.normalY;
			dirX -= 2 * dot * wallStop.normalX;
			dirY -= 2 * dot * wallStop.normalY;
			const magnitude = Math.hypot(dirX, dirY) || 1;
			dirX /= magnitude;
			dirY /= magnitude;
			bounces++;

			originX = endX + dirX * RAY_EPSILON;
			originY = endY + dirY * RAY_EPSILON;
			continue;
		}

		if (stats.detonatesOnImpact) {
			createLaserExplosionAt(endX, endY, stats, currentTime);
		}
		break;
	}
}

function resolveLaserShot(shot, currentTime) {
	if ((shot.coneHalfAngle ?? 0) > 0) {
		resolveLaserConeShot(shot, currentTime);
		return;
	}

	resolveLaserBeamShot(shot, currentTime);
}

// Starts a player laser shot. Aim direction is locked at trigger time. Warmup
// is a delayed state transition, while the beam itself is resolved as hitscan.
// Cooldown begins at the exact scheduled end of warmup (shot.fireAt), so the
// short rendered firing flash overlaps cooldown instead of extending it.
export function requestLaserShot(
	shooter,
	targetX,
	targetY,
	stats,
	weaponIndex,
	currentTime = performance.now(),
) {
	const index = Math.max(0, Number(weaponIndex) || 0);
	const cooldownUntil = GameState.weaponCooldownUntilByWeapon[index] || 0;

	if (currentTime < cooldownUntil) return false;
	if (GameState.laserWarmups.some((shot) => shot.weaponIndex === index)) {
		return false;
	}

	const centerX = shooter.x + shooter.size / 2;
	const centerY = shooter.y + shooter.size / 2;
	const variedStats = {
		...stats,
		radiusBlocks: getVariedStat(
			stats.radiusBlocks ?? 0.03,
			stats.radiusVariation ?? 0,
			0,
		),
		damage: getVariedStat(
			stats.damage ?? 1,
			stats.damageVariation ?? 0,
			0,
		),
	};
	const bulletCount = getBulletCount(variedStats);
	const baseAngle = Math.atan2(targetY - centerY, targetX - centerX);
	const centerAngle = baseAngle + getRandomSpreadOffset(variedStats.spread ?? 0);
	const coneHalfAngle = bulletCount > 1
		? getLaserConeHalfAngleFromCount(bulletCount)
		: 0;
	const warmupMs = Math.max(0, Number(variedStats.laserWarmupMs ?? 0) || 0);
	const dirX = Math.cos(centerAngle);
	const dirY = Math.sin(centerAngle);
	const telegraphRangeBlocks = coneHalfAngle > 0
		? getLaserLoadedWorldRadiusBlocks(centerX, centerY)
		: getLaserLoadedRangeBlocks(centerX, centerY, dirX, dirY);
	const shot = {
		shooter,
		weaponIndex: index,
		dirX,
		dirY,
		centerAngle,
		coneHalfAngle,
		telegraphRangeBlocks,
		stats: variedStats,
		startedAt: currentTime,
		fireAt: currentTime + warmupMs,
	};

	if (warmupMs <= 0) {
		resolveLaserShot(shot, currentTime);
		GameState.weaponCooldownUntilByWeapon[index] =
			currentTime + Math.max(0, Number(variedStats.cooldownMs ?? 0) || 0);
		return true;
	}

	GameState.laserWarmups.push(shot);
	return true;
}

// Advances pending laser warmups and short-lived rendered beam flashes.
export function processLasers(currentTime) {
	for (let i = GameState.laserWarmups.length - 1; i >= 0; i--) {
		const shot = GameState.laserWarmups[i];

		if (currentTime < shot.fireAt) continue;

		resolveLaserShot(shot, currentTime);
		GameState.weaponCooldownUntilByWeapon[shot.weaponIndex] =
			shot.fireAt +
			Math.max(0, Number(shot.stats.cooldownMs ?? 0) || 0);
		GameState.laserWarmups.splice(i, 1);
	}

	GameState.laserBeams = GameState.laserBeams.filter(
		(beam) => currentTime - beam.createdAt < beam.durationMs,
	);
}
