// Singular non-chained laser beam resolution.

import { Config } from "../../config.js";
import { GameState, player, TEAM_PLAYER } from "../../state.js";
import {
	consumeLaserCalculationBudget,
	getLaserLoadedRangeBlocks,
} from "./budget.js";
import {
	createLaserExplosionAt,
	splitLaserAt,
} from "./effects.js";
import { getLaserWallStopWithPenetrationBudget } from "./wall-interaction.js";
import { rayRectIntersection } from "../visibility.js";

export function pushLaserBeamSegment(x1, y1, x2, y2, stats, radius, currentTime) {
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

export function resolveLaserBeamShot(shot, currentTime) {
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
	const isPlayerShot = shot.team === TEAM_PLAYER;
	const targets = isPlayerShot ? GameState.enemies : [player];
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

		for (const target of targets) {
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
				if (isPlayerShot || !GameState.isInvincible) {
					target.hp -= stats.damage;
				}
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

