// Hitscan chained singular-laser resolution.

import { GameState, player, TEAM_PLAYER } from "../../state.js";
import { getCombatDefault } from "../defaults.js";
import {
	findChainTarget,
	getAngleToTarget,
} from "../targeting.js";
import { rayRectIntersection } from "../visibility.js";
import {
	consumeLaserCalculationBudget,
	getLaserLoadedRangeBlocks,
} from "./budget.js";
import { pushLaserBeamSegment } from "./beam.js";
import {
	createLaserExplosionAt,
	splitLaserAt,
} from "./effects.js";
import { getLaserWallStopWithPenetrationBudget } from "./wall-interaction.js";

export function findNearestLaserTargetHit(
	originX,
	originY,
	dirX,
	dirY,
	maxDistance,
	radius,
	hitTargets,
	targets,
) {
	let bestTarget = null;
	let bestHit = null;
	let bestDistance = Infinity;

	for (const target of targets) {
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
export function resolveChainedLaserBeamShot(shot, currentTime) {
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
	const isPlayerShot = shot.team === TEAM_PLAYER;
	const targets = isPlayerShot ? GameState.enemies : [player];
	const RAY_EPSILON = 1e-6;
	const MAX_SEGMENTS = Math.max(
		1,
		Math.floor(getCombatDefault("MAX_CHAINED_LASER_SEGMENTS")),
	);
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
			targets,
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
			if (isPlayerShot || !GameState.isInvincible) {
				hitTarget.hp -= stats.damage;
			}
			hitTargets.add(hitTarget);

			let nextTarget = null;
			if (chainsRemaining > 0) {
				chainsRemaining--;
				nextTarget = isPlayerShot ? findChainTarget(
					endX,
					endY,
					shot.chainReferenceAngle ?? Math.atan2(dirY, dirX),
					hitTargets,
					"distance",
					null,
					shot.chainMaximumRangeBlocks,
				) : null;
			}

			if (nextTarget) {
				const nextAngle = getAngleToTarget(endX, endY, nextTarget);
				dirX = Math.cos(nextAngle);
				dirY = Math.sin(nextAngle);
				if (stats.detonatesOnImpact) {
					createLaserExplosionAt(
						endX,
						endY,
						stats,
						shot.ownerId,
						shot.team,
						currentTime,
					);
				}
				if (stats.splitsOnImpact) {
					splitLaserAt(shot, endX, endY, nextAngle, currentTime);
				}
			}

			originX = endX + dirX * RAY_EPSILON;
			originY = endY + dirY * RAY_EPSILON;
			continue;
		}

		if (!wallStop.impactedWall) break;

		if (bounces < maxBounces) {
			if (stats.detonatesOnImpact) {
				createLaserExplosionAt(
					endX,
					endY,
					stats,
					shot.ownerId,
					shot.team,
					currentTime,
				);
			}

			const dot = dirX * wallStop.normalX + dirY * wallStop.normalY;
			dirX -= 2 * dot * wallStop.normalX;
			dirY -= 2 * dot * wallStop.normalY;
			const magnitude = Math.hypot(dirX, dirY) || 1;
			dirX /= magnitude;
			dirY /= magnitude;
			bounces++;
			if (stats.splitsOnImpact) {
				splitLaserAt(
					shot,
					endX,
					endY,
					Math.atan2(dirY, dirX),
					currentTime,
				);
			}

			originX = endX + dirX * RAY_EPSILON;
			originY = endY + dirY * RAY_EPSILON;
			continue;
		}

		if (stats.detonatesOnImpact) {
			createLaserExplosionAt(
				endX,
				endY,
				stats,
				shot.ownerId,
				shot.team,
				currentTime,
			);
		}
		if (stats.splitsOnImpact) {
			splitLaserAt(
				shot,
				endX,
				endY,
				Math.atan2(wallStop.normalY, wallStop.normalX),
				currentTime,
			);
		}
		break;
	}
}

