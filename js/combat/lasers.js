// Singular laser beams plus continuous visibility-polygon laser cones.

import { Config } from "../config.js";
import { GameState } from "../state.js";
import {
	getWallIndexBounds,
	queryWallsAlongRayDda,
} from "../spatial/wall-index.js";
import { detonateBullet } from "./explosions.js";
import { findChainTarget, getAngleToTarget } from "./targeting.js";
import {
	getWallCornerCriticalAngles,
	rayRectIntersection,
} from "./visibility.js";
import {
	getBulletCount,
	getLaserConeHalfAngleFromCount,
	getRandomSpreadOffset,
	getVariedStat,
} from "./weapon-utils.js";

export { rayRectIntersection } from "./visibility.js";

// Laser range is no longer capped by an arbitrary gameplay distance. Rays extend
// to the edge of the currently loaded world, while a shared per-frame calculation
// budget limits worst-case CPU work. One budget unit represents one potentially
// expensive laser/world or laser/entity geometry check.
export const DEFAULT_LASER_CALCULATION_BUDGET_PER_FRAME = 100000;

let laserCalculationBudgetRemaining = DEFAULT_LASER_CALCULATION_BUDGET_PER_FRAME;
let laserLoadedWorldBoundsCached = false;
let cachedLaserLoadedWorldBounds = null;

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
	cachedLaserLoadedWorldBounds = getWallIndexBounds();
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
	if (!bounds) return getLaserFallbackLoadedRangeBlocks();

	const hit = rayRectIntersection(originX, originY, dirX, dirY, bounds, 0);
	if (!hit) return 0;
	return Math.max(0, hit.exitDistance);
}

function getLaserLoadedWorldRadiusBlocks(originX, originY) {
	const bounds = getLaserLoadedWorldBounds();
	if (!bounds) return getLaserFallbackLoadedRangeBlocks();

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

function queryLaserWallsAlongRay(
	originX,
	originY,
	dirX,
	dirY,
	maxRangeBlocks,
	radius = 0,
) {
	return queryWallsAlongRayDda(
		originX,
		originY,
		dirX,
		dirY,
		maxRangeBlocks,
		radius,
		() => consumeLaserCalculationBudget(),
	);
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

function pushLaserBeamSegment(x1, y1, x2, y2, stats, radius, currentTime) {
	GameState.laserBeams.push({
		type: "beam",
		x1,
		y1,
		x2,
		y2,
		color: stats.color ?? "white",
		radius,
		createdAt: currentTime,
		durationMs: Math.max(
			0,
			Number(Config.RENDERING.LASER_FLASH_DURATION_MS) || 0,
		),
	});
}

function findNearestLaserTargetHit(
	originX,
	originY,
	dirX,
	dirY,
	maxDistance,
	radius,
	hitTargets,
) {
	let bestTarget = null;
	let bestHit = null;
	let bestDistance = Infinity;

	for (const target of GameState.enemies) {
		if (target.hp <= 0 || hitTargets.has(target)) continue;
		if (!consumeLaserCalculationBudget()) {
			return { target: null, hit: null, truncated: true };
		}

		const hit = rayRectIntersection(
			originX,
			originY,
			dirX,
			dirY,
			target,
			radius,
		);
		if (!hit || hit.entryDistance > maxDistance + 1e-9) continue;

		if (hit.entryDistance < bestDistance) {
			bestTarget = target;
			bestHit = hit;
			bestDistance = hit.entryDistance;
		}
	}

	return { target: bestTarget, hit: bestHit, truncated: false };
}

// A chained singular laser behaves like the moving-projectile chain rule, but
// resolves the whole path immediately because lasers are hitscan. Every enemy
// contact ends the current rendered segment. If another chain redirect remains,
// the next segment aims at the best visible, unvisited enemy using the original
// mouse angle as the tie-break reference; otherwise the beam continues straight.
function resolveChainedLaserBeamShot(shot, currentTime) {
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
	let chainsRemaining = Math.max(
		0,
		Math.floor(Number(shot.chainsRemaining ?? 0) || 0),
	);
	const hitTargets = new Set();
	const RAY_EPSILON = 1e-6;
	const MAX_SEGMENTS = 10000;
	let segmentCount = 0;

	while (segmentCount++ < MAX_SEGMENTS) {
		const segmentRange = getLaserLoadedRangeBlocks(
			originX,
			originY,
			dirX,
			dirY,
		);
		if (segmentRange <= RAY_EPSILON) break;

		const targetHit = findNearestLaserTargetHit(
			originX,
			originY,
			dirX,
			dirY,
			segmentRange,
			radius,
			hitTargets,
		);
		if (targetHit.truncated) break;

		// Only ask the wall resolver to advance as far as the next enemy contact.
		// This keeps the cumulative wall-penetration budget exact across the extra
		// visual segments rather than spending penetration on geometry past a target.
		const requestedDistance = targetHit.target
			? Math.max(0, targetHit.hit.entryDistance)
			: segmentRange;
		const wallStop = getLaserWallStopWithPenetrationBudget(
			originX,
			originY,
			dirX,
			dirY,
			radius,
			remainingPenetrationBlocks,
			requestedDistance,
			maxBounces > 0,
		);
		if (wallStop.truncated) break;

		const beamDistance = wallStop.distance;
		remainingPenetrationBlocks = wallStop.remainingPenetrationBlocks;
		const endX = originX + dirX * beamDistance;
		const endY = originY + dirY * beamDistance;

		pushLaserBeamSegment(
			originX,
			originY,
			endX,
			endY,
			stats,
			radius,
			currentTime,
		);

		const reachedTarget = Boolean(
			targetHit.target &&
			!wallStop.impactedWall &&
			beamDistance >= targetHit.hit.entryDistance - 1e-9,
		);

		if (reachedTarget) {
			const hitTarget = targetHit.target;
			hitTarget.hp -= stats.damage ?? 1;
			hitTargets.add(hitTarget);

			let nextTarget = null;
			if (chainsRemaining > 0) {
				chainsRemaining--;
				nextTarget = findChainTarget(
					endX,
					endY,
					shot.chainReferenceAngle ?? Math.atan2(dirY, dirX),
					hitTargets,
					"distance",
				);
			}

			if (nextTarget) {
				const nextAngle = getAngleToTarget(endX, endY, nextTarget);
				dirX = Math.cos(nextAngle);
				dirY = Math.sin(nextAngle);
			}

			originX = endX + dirX * RAY_EPSILON;
			originY = endY + dirY * RAY_EPSILON;
			continue;
		}

		if (!wallStop.impactedWall) break;

		if (bounces < maxBounces) {
			if (stats.detonatesOnImpact) {
				createLaserExplosionAt(endX, endY, stats, currentTime);
			}

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

		pushLaserBeamSegment(
			originX,
			originY,
			endX,
			endY,
			stats,
			radius,
			currentTime,
		);

		if (!wallStop.impactedWall) break;

		if (bounces < maxBounces) {
			// Match projectile bounce semantics: explosive bounces only detonate
			// when the weapon explicitly opts into impact detonation.
			if (stats.detonatesOnImpact) {
				createLaserExplosionAt(endX, endY, stats, currentTime);
			}

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

	if ((shot.chain ?? 0) > 0) {
		resolveChainedLaserBeamShot(shot, currentTime);
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
	// Chaining is singular-beam-only. Cone lasers keep their existing cone/spread
	// behavior even if the weapon config has chain > 0.
	const chain = bulletCount === 1
		? Math.max(0, Math.floor(Number(variedStats.chain ?? 0) || 0))
		: 0;
	const initialChainTarget = chain > 0
		? findChainTarget(centerX, centerY, baseAngle)
		: null;
	const centerAngle = initialChainTarget
		? getAngleToTarget(centerX, centerY, initialChainTarget)
		: baseAngle + getRandomSpreadOffset(variedStats.spread ?? 0);
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
		chain,
		chainsRemaining: Math.max(0, chain - 1),
		chainReferenceAngle: baseAngle,
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
