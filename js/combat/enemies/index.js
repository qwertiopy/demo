// Enemy spawning, aiming/firing orchestration, and movement updates.

import { Config } from "../../config.js";
import { GameState, player } from "../../state.js";
import { calculateInterceptAim, calculateMaximumFleeInterceptDistance, calculateMaximumLeadHalfAngle } from "../targeting.js";
import { clampAngleToInterval } from "../visibility.js";
import { shortestAngleDelta } from "../weapon-utils.js";
import {
	WALL_ANGLE_EPSILON,
	getEnemyAimVisibilityProfile,
	getEnemyBudgetFallbackAim,
	getEnemyPlayerContactDistance,
	getEnemyVisibleAimInterval,
	getIntervalBoundaryTowardAngle,
	getMaximumAimInterval,
	getRememberedBoundaryAngle,
	getSingleAngleInterval,
	getWallShotGeometry,
	rememberVisibleAimInterval,
	resetEnemyAimCalculationBudget,
	resetWallAttack,
	scheduleEnemyAimCalculations,
} from "./aiming.js";
import { fireEnemyProjectile, getVariedLeadFiringAngle } from "./firing.js";
import { getMaximumPlayerMovementSpeed } from "./helpers.js";
import { updateAggressiveEnemyMovement } from "./movement.js";
import { processEnemySpawning } from "./spawn.js";
export { resolveEnemyVectorCollisions } from "./separation.js";

export function updateEnemies(currentTime, dt) {
	resetEnemyAimCalculationBudget();

	processEnemySpawning(currentTime);
	const aimSchedule = scheduleEnemyAimCalculations();

	// enemy processing loop
	GameState.enemies = GameState.enemies.filter((e) => {
		if (e.hp <= 0) return false;

		// enemy center
		const eCenterX = e.x + e.size / 2;
		const eCenterY = e.y + e.size / 2;

		// player center
		const pCenterX = player.x + player.size / 2;
		const pCenterY = player.y + player.size / 2;

		// LOS was evaluated once while building the shared aiming schedule.
		const los = aimSchedule.losByEnemy.get(e) === true;
		const hasAimTarget = aimSchedule.hasTargetByEnemy.get(e) === true;
		const scheduledAimScan = aimSchedule.scanResultByEnemy.get(e) || null;

		// reset velocity before calculating
		e.vx = 0;
		e.vy = 0;
		if (!hasAimTarget) return true;

		e.debugAimOriginX = eCenterX;
		e.debugAimOriginY = eCenterY;

		const shotIntervalSeconds = (currentTime - e.lastShot) / 1000;
		const hasPreviousShotSample =
			Number.isFinite(e.playerXAtLastShot) &&
			Number.isFinite(e.playerYAtLastShot) &&
			Number.isFinite(shotIntervalSeconds) &&
			shotIntervalSeconds > 0;
		const averagePlayerVx = hasPreviousShotSample
			? (pCenterX - e.playerXAtLastShot) / shotIntervalSeconds
			: player.vx;
		const averagePlayerVy = hasPreviousShotSample
			? (pCenterY - e.playerYAtLastShot) / shotIntervalSeconds
			: player.vy;
		const baseBulletSpeed = Math.max(
			0,
			Number(e.typeStats.bulletSpeed) || 0,
		);
		const directAngle = Math.atan2(
			pCenterY - eCenterY,
			pCenterX - eCenterX,
		);
		const intercept = calculateInterceptAim(
			eCenterX,
			eCenterY,
			pCenterX,
			pCenterY,
			averagePlayerVx,
			averagePlayerVy,
			baseBulletSpeed,
		);
		const predictedAngle = intercept?.angle ?? directAngle;
		const spread = Math.max(
			0,
			Number(e.typeStats.spread ?? 0) || 0,
		);
		const distanceToPlayer = Math.hypot(
			pCenterX - eCenterX,
			pCenterY - eCenterY,
		);
		const maximumPlayerSpeed = getMaximumPlayerMovementSpeed();
		const maxLeadHalfAngle = calculateMaximumLeadHalfAngle(
			maximumPlayerSpeed,
			baseBulletSpeed,
		);
		const maximumLeadDistance = calculateMaximumFleeInterceptDistance(
			distanceToPlayer,
			maximumPlayerSpeed,
			baseBulletSpeed,
		);
		const interceptDistance = intercept
			? Math.hypot(
				intercept.x - eCenterX,
				intercept.y - eCenterY,
			)
			: distanceToPlayer;
		const trackingWallGeometry = e.aimMode === "wall"
			? getWallShotGeometry(e, distanceToPlayer)
			: null;
		const trackingHalfAngle = trackingWallGeometry
			? e.wallMaxHalfAngle
			: maxLeadHalfAngle;
		// The cone's outer radius always assumes maximum-speed flight directly
		// away from the enemy. The separate clamp radius ends at the candidate
		// player's projectile-expanded contact surface, so walls only exclude
		// firing angles when their shadow begins before that contact.
		const trackingMaximumDistance = trackingWallGeometry
			? trackingWallGeometry.encounterDistance
			: maximumLeadDistance;
		const trackingTargetDistance = trackingWallGeometry
			? trackingWallGeometry.encounterDistance
			: interceptDistance;
		const trackingClampDistance = getEnemyPlayerContactDistance(
			e,
			trackingTargetDistance,
		);
		const trackingPreferredAngle = trackingWallGeometry &&
			Number.isFinite(e.wallFrontierAngle)
			? e.wallFrontierAngle
			: predictedAngle;
		const trackedMaximumAimInterval = getMaximumAimInterval(
			eCenterX,
			eCenterY,
			directAngle,
			trackingHalfAngle,
		);
		const trackedAimWalls = scheduledAimScan?.walls || [];
		const trackedAimGeometryComplete = hasAimTarget &&
			Boolean(scheduledAimScan) &&
			scheduledAimScan.truncated !== true;
		e.debugAimWallScanTruncated = hasAimTarget &&
			!trackedAimGeometryComplete;
		const trackedAimVisibilityProfile =
			trackedAimGeometryComplete &&
			GameState.showEditorHelpers &&
			Number(Config.DEBUG?.MAX_DRAWS_PER_FRAME ?? 1000) > 0 &&
			Config.DEBUG?.DRAW_ENEMY_AIM_VISIBILITY_REGION !== false
			? getEnemyAimVisibilityProfile(
				e,
				eCenterX,
				eCenterY,
				directAngle,
				trackingHalfAngle,
				trackingMaximumDistance,
				trackedAimWalls,
			)
			: null;
		const trackedVisibleInterval = los && trackedAimGeometryComplete
			? getEnemyVisibleAimInterval(
				e,
				eCenterX,
				eCenterY,
				directAngle,
				trackingHalfAngle,
				trackingClampDistance,
				trackingPreferredAngle,
				trackedAimWalls,
			)
			: null;

		// Prediction is deliberately refreshed every frame, not merely when the
		// cooldown expires. A committed wall tracks it but never reacts to it.
		e.currentPredictedShotAngle = predictedAngle;
		e.debugUsingCachedCorner = false;

		if (los) {
			if (trackedAimGeometryComplete) {
				e.lostLosCorner = null;
				e.lostLosCornerAngle = null;
			} else {
				e.lostLosCornerAngle = getRememberedBoundaryAngle(
					eCenterX,
					eCenterY,
					e.lostLosCorner,
				);
			}
			e.debugVisibleAimInterval = trackedVisibleInterval;
			e.debugAimVisibilityProfile = trackedAimVisibilityProfile;
			e.debugAimDistance = trackingMaximumDistance;
			rememberVisibleAimInterval(
				e,
				trackedVisibleInterval,
				trackingMaximumDistance,
				trackedMaximumAimInterval,
				trackedAimVisibilityProfile,
			);
		} else {
			if (
				!e.lostLosCorner &&
				e.lastVisibleAimInterval
			) {
				e.lostLosCorner = getIntervalBoundaryTowardAngle(
					e.lastVisibleAimInterval,
					directAngle,
				);
			}
			e.lostLosCornerAngle = getRememberedBoundaryAngle(
				eCenterX,
				eCenterY,
				e.lostLosCorner,
			);

			e.debugVisibleAimInterval = e.lastVisibleAimInterval;
			e.debugMaximumAimInterval = trackedMaximumAimInterval;
			e.debugAimVisibilityProfile = trackedAimVisibilityProfile;
			e.debugAimDistance = trackingMaximumDistance;
			e.debugUsingCachedCorner = Number.isFinite(e.lostLosCornerAngle);
		}
		e.lastAimLos = los;

		if (los) {
			e.hasAimTarget = true;
			e.lastSeenX = pCenterX;
			e.lastSeenY = pCenterY;
		}

		const readyToShoot = currentTime - e.lastShot > e.shootCooldown;
		let firedBudgetFallback = false;

		// An unfinished or unvisited budget job must not suppress shooting. Prefer
		// the last real world-space wall corner, then fall back to the player world
		// position captured on the frame LOS was gained.
		if (readyToShoot && !trackedAimGeometryComplete) {
			const fallbackAim = getEnemyBudgetFallbackAim(
				e,
				eCenterX,
				eCenterY,
				directAngle,
			);
			if (fallbackAim) {
				if (fallbackAim.boundary) {
					e.lostLosCorner = fallbackAim.boundary;
					e.lostLosCornerAngle = fallbackAim.angle;
					e.debugUsingCachedCorner = true;
				}

				fireEnemyProjectile(
					e,
					eCenterX,
					eCenterY,
					pCenterX,
					pCenterY,
					currentTime,
					fallbackAim.angle,
					spread,
					getSingleAngleInterval(fallbackAim.angle),
				);
				firedBudgetFallback = true;
			}
		}

		// Once the player crosses behind a wall, keep suppressing the exact
		// projectile-safe corner found on the final visible frame. A zero-width
		// bound also prevents spread or multi-projectile volleys from entering the
		// wall. Regaining LOS immediately returns control to normal aiming.
		if (
			!firedBudgetFallback &&
			!los &&
			readyToShoot &&
			Number.isFinite(e.lostLosCornerAngle)
		) {
			const cornerInterval = getSingleAngleInterval(e.lostLosCornerAngle);

			fireEnemyProjectile(
				e,
				eCenterX,
				eCenterY,
				pCenterX,
				pCenterY,
				currentTime,
				e.lostLosCornerAngle,
				spread,
				cornerInterval,
			);
		}

		// Live visibility gates lead and sweep progression. Corner suppression
		// above fires during LOS loss without advancing a committed wall frontier.
		if (los && readyToShoot && trackedAimGeometryComplete) {
			let firedThisFrame = false;

			if (e.aimMode === "wall") {
				const startSide = e.wallStartSide === -1 ? -1 : 1;
				const sweepDirection = -startSide;
				const frontierAngle = Number.isFinite(e.wallFrontierAngle)
					? e.wallFrontierAngle
					: directAngle + startSide * e.wallMaxHalfAngle;
				const wallGeometry = getWallShotGeometry(e, distanceToPlayer);
				const wallAimDistance = getEnemyPlayerContactDistance(
					e,
					wallGeometry.encounterDistance,
				);
				const visibleInterval = getEnemyVisibleAimInterval(
					e,
					eCenterX,
					eCenterY,
					directAngle,
					e.wallMaxHalfAngle,
					wallAimDistance,
					frontierAngle,
					trackedAimWalls,
				);
				rememberVisibleAimInterval(
					e,
					visibleInterval,
					wallGeometry.encounterDistance,
					trackedMaximumAimInterval,
					trackedAimVisibilityProfile,
				);

				// A committed wall pauses when projectile-width-safe visibility has
				// collapsed. Its deadline remains active so it catches up when visible.
				if (visibleInterval) {
					const boundedFrontierAngle = clampAngleToInterval(
						frontierAngle,
						visibleInterval,
					);
					const opposingAngle = startSide > 0
						? visibleInterval.minAngle
						: visibleInterval.maxAngle;
					const remainingAngle = sweepDirection * shortestAngleDelta(
						boundedFrontierAngle,
						opposingAngle,
					);

					if (remainingAngle <= WALL_ANGLE_EPSILON) {
						// The moving opposing boundary has already reached the frontier.
						// Reset and use this still-available opportunity for step 1.
						resetWallAttack(e, true);
					} else {
						if (wallGeometry.safeStep > WALL_ANGLE_EPSILON) {
							e.wallLastSafeStep = wallGeometry.safeStep;
						}

						const wallMaxDurationMs = Math.max(
							1,
							Number(e.typeStats.wallMaxDurationMs ?? 1500) || 0,
						);
						if (!Number.isFinite(e.wallDeadline) || e.wallDeadline <= 0) {
							e.wallDeadline = currentTime + wallMaxDurationMs;
						}

						// Prefer gap-safe spacing, but impose a completion floor so a
						// wall reaches its visible opposite boundary by the deadline.
						const cooldownMs = Math.max(
							1,
							Number(e.shootCooldown) || 0,
						);
						const remainingDurationMs = Math.max(
							0,
							e.wallDeadline - currentTime,
						);
						const remainingShots = Math.max(
							1,
							Math.ceil(remainingDurationMs / cooldownMs),
						);
						const completionStep = remainingAngle / remainingShots;
						const safeStep = Math.max(
							WALL_ANGLE_EPSILON,
							e.wallLastSafeStep,
						);
						const step = Math.min(
							remainingAngle,
							Math.max(safeStep, completionStep),
						);
						const firingAngle = clampAngleToInterval(
							boundedFrontierAngle + sweepDirection * step,
							visibleInterval,
						);

						fireEnemyProjectile(
							e,
							eCenterX,
							eCenterY,
							pCenterX,
							pCenterY,
							currentTime,
							firingAngle,
							0,
							visibleInterval,
						);
						e.wallFrontierAngle = firingAngle;
						firedThisFrame = true;

						if (remainingAngle - step <= WALL_ANGLE_EPSILON) {
							resetWallAttack(e, true);
						}
					}
				}
			}

			if (!firedThisFrame && e.aimMode !== "wall") {
				const velocityChangeThreshold = Math.max(
					0,
					Number(
						e.typeStats.wallVelocityChangeThreshold ?? 0.1,
					) || 0,
				);
				const hasPreviousLeadVector =
					Number.isFinite(e.lastLeadPlayerVx) &&
					Number.isFinite(e.lastLeadPlayerVy);
				const playerVectorChanged =
					!hasPreviousLeadVector ||
					Math.hypot(
						player.vx - e.lastLeadPlayerVx,
						player.vy - e.lastLeadPlayerVy,
					) > velocityChangeThreshold;

				if (!playerVectorChanged) {
					const wallGeometry = getWallShotGeometry(e, distanceToPlayer);
					const wallAimDistance = getEnemyPlayerContactDistance(
						e,
						wallGeometry.encounterDistance,
					);
					const wallMaximumAimInterval = getMaximumAimInterval(
						eCenterX,
						eCenterY,
						directAngle,
						wallGeometry.maxHalfAngle,
					);
					const wallAimWalls = trackedAimWalls;
					const wallAimGeometryComplete = trackedAimGeometryComplete;
					const wallAimVisibilityProfile =
						wallGeometry.canStart &&
						wallAimGeometryComplete &&
						GameState.showEditorHelpers &&
						Number(Config.DEBUG?.MAX_DRAWS_PER_FRAME ?? 1000) > 0 &&
						Config.DEBUG?.DRAW_ENEMY_AIM_VISIBILITY_REGION !== false
							? getEnemyAimVisibilityProfile(
								e,
								eCenterX,
								eCenterY,
								directAngle,
								wallGeometry.maxHalfAngle,
								wallGeometry.encounterDistance,
								wallAimWalls,
							)
							: null;
					const visibleInterval =
						wallGeometry.canStart && wallAimGeometryComplete
							? getEnemyVisibleAimInterval(
								e,
								eCenterX,
								eCenterY,
								directAngle,
								wallGeometry.maxHalfAngle,
								wallAimDistance,
								predictedAngle,
								wallAimWalls,
							)
							: null;
					rememberVisibleAimInterval(
						e,
						visibleInterval,
						wallGeometry.encounterDistance,
						wallMaximumAimInterval,
						wallAimVisibilityProfile,
					);
					const visibleWidth = visibleInterval
						? visibleInterval.maxOffset - visibleInterval.minOffset
						: 0;

					if (
						wallGeometry.canStart &&
						visibleInterval &&
						visibleWidth > WALL_ANGLE_EPSILON
					) {
						const leadOffset = shortestAngleDelta(
							directAngle,
							predictedAngle,
						);
						const fallbackSide = e.nextWallStartSide === -1 ? -1 : 1;
						const startSide = Math.abs(leadOffset) > WALL_ANGLE_EPSILON
							? Math.sign(leadOffset)
							: fallbackSide;
						const firingAngle = clampAngleToInterval(
							directAngle + startSide * wallGeometry.maxHalfAngle,
							visibleInterval,
						);

						e.aimMode = "wall";
						e.wallStartSide = startSide;
						e.wallSweepDirection = -startSide;
						e.wallFrontierAngle = firingAngle;
						e.wallMaxHalfAngle = wallGeometry.maxHalfAngle;
						e.wallLastSafeStep = wallGeometry.safeStep;
						e.wallDeadline =
							currentTime + Math.max(
								1,
								Number(e.typeStats.wallMaxDurationMs ?? 1500) || 0,
							);
						e.nextWallStartSide = -startSide;

						fireEnemyProjectile(
							e,
							eCenterX,
							eCenterY,
							pCenterX,
							pCenterY,
							currentTime,
							firingAngle,
							0,
							visibleInterval,
						);
						firedThisFrame = true;
					}
				}

				if (!firedThisFrame) {
					const leadAimDistance = getEnemyPlayerContactDistance(
						e,
						interceptDistance,
					);
					const visibleInterval = getEnemyVisibleAimInterval(
						e,
						eCenterX,
						eCenterY,
						directAngle,
						maxLeadHalfAngle,
						leadAimDistance,
						predictedAngle,
						trackedAimWalls,
					);
					rememberVisibleAimInterval(
						e,
						visibleInterval,
						maximumLeadDistance,
						trackedMaximumAimInterval,
						trackedAimVisibilityProfile,
					);

					if (visibleInterval) {
						const firingAngle = getVariedLeadFiringAngle(
							e,
							predictedAngle,
							directAngle,
							baseBulletSpeed,
							spread,
							visibleInterval,
						);

						fireEnemyProjectile(
							e,
							eCenterX,
							eCenterY,
							pCenterX,
							pCenterY,
							currentTime,
							firingAngle,
							spread,
							visibleInterval,
						);
						e.lastLeadPlayerVx = player.vx;
						e.lastLeadPlayerVy = player.vy;
					}
				}
			}
		}

		updateAggressiveEnemyMovement(
			e,
			los,
			pCenterX,
			pCenterY,
			eCenterX,
			eCenterY,
			dt,
		);
		return true;
	});
}
