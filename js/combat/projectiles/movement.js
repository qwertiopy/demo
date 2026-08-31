import { GameState, player, TEAM_PLAYER } from "../../state.js";
import { isColliding } from "../../utils.js";
import { detonateBullet } from "../explosions.js";
import { releaseProjectile } from "../projectile-cap.js";
import {
	getThrowableBoomerangTravelDistance,
	getThrowableTravelDistance,
} from "../weapon-utils.js";
import { updateProjectileChainAim } from "./chain.js";
import {
	getProjectileDirectionAngle,
	projectileRect,
	pushProjectileTrailEvent,
} from "./helpers.js";
import { consumeProjectilePenetrationStep } from "./penetration.js";
import { fireSplitChildren } from "./split.js";
import {
	BULLET_MAX_STEP_BLOCKS,
	findEarliestProjectileWallHit,
	isBouncyProjectile,
	MAX_WALL_IMPACTS_PER_SUBSTEP,
	projectileOverlapsAnyWall,
	reflectVector,
	WALL_APPROACH_EPSILON,
	WALL_CONTACT_NUDGE,
} from "./wall-collision.js";

function triggerChainRedirectEffects(projectile, currentTime) {
	if (projectile.detonatesOnImpact) {
		detonateBullet(projectile, currentTime);
	}
	if (projectile.splitsOnImpact) {
		fireSplitChildren(
			projectile,
			getProjectileDirectionAngle(projectile),
			currentTime,
		);
	}
}

function triggerSuccessfulBounceEffects(bullet, currentTime) {
	if (
		bullet.detonatesOnImpact === true &&
		(bullet.explosionRadiusBlocks ?? 0) > 0
	) {
		detonateBullet(bullet, currentTime);
	}
	if (bullet.splitsOnImpact === true) {
		fireSplitChildren(bullet, getProjectileDirectionAngle(bullet), currentTime);
	}
}


// Substeps projectile movement, reflects bullets from walls, applies damage to
// valid targets, handles penetration/bounce synergies, advances closed-form
// throwable legs, tags zero-movement projectiles, and removes expired bullets.
export function processProjectiles(currentTime, dt) {
	const projectiles = GameState.projectiles;
	for (let i = projectiles.length - 1; i >= 0; i--) {
		const b = projectiles[i];
		const isPlayerProjectile = b.team === TEAM_PLAYER;
		const targets = isPlayerProjectile ? GameState.enemies : [player];

		if (b.removedByProjectileCap) {
			releaseProjectile(b);
			projectiles.splice(i, 1);
			continue;
		}

		const frameStartX = b.x;
		const frameStartY = b.y;
		let trailEventPathStarted = false;

		const beginTrailEventPath = () => {
			if (trailEventPathStarted) return;
			pushProjectileTrailEvent(b, frameStartX, frameStartY);
			trailEventPathStarted = true;
		};

		const recordTrailCheckpoint = () => {
			beginTrailEventPath();
			pushProjectileTrailEvent(b, b.x, b.y, { checkpoint: true });
		};

		const updateChainAimAndRecordTargetChange = () => {
			const previousChainTarget = b.chainTarget;
			const triggeredPostHitRedirect = updateProjectileChainAim(b);
			if (b.chainTarget && b.chainTarget !== previousChainTarget) {
				recordTrailCheckpoint();
			}
			return triggeredPostHitRedirect;
		};

		const explosionTimerExpired = b.detonationTimeMs > 0 &&
			currentTime - b.createdAt >= b.detonationTimeMs;
		const splitTimerExpired = b.splitTimeMs > 0 &&
			currentTime - b.createdAt >= b.splitTimeMs;
		if (explosionTimerExpired || splitTimerExpired) {
			recordTrailCheckpoint();
			if (explosionTimerExpired) {
				detonateBullet(b, currentTime);
			}
			if (splitTimerExpired) {
				fireSplitChildren(b, getProjectileDirectionAngle(b), currentTime);
			}
			releaseProjectile(b);
			projectiles.splice(i, 1);
			continue;
		}

		if (updateChainAimAndRecordTargetChange()) {
			triggerChainRedirectEffects(b, currentTime);
			if (b.removedByProjectileCap) {
				releaseProjectile(b);
				projectiles.splice(i, 1);
				continue;
			}
		}

		let frameDistance;
		let desiredThrowTravel = null;
		let throwReachedTerminalTime = false;

		if (b.throwable) {
			const legStartedAt = b.throwLegStartedAt ?? b.createdAt;
			const throwElapsedMs = Math.max(0, currentTime - legStartedAt);
			const isBoomerangLeg = (b.throwBounces ?? 0) > 0;
			const throwLegDistanceBlocks =
				b.throwDistanceBlocks * (isBoomerangLeg ? 2 : 1);
			const throwLegDurationMs =
				b.throwFlightDurationMs * (isBoomerangLeg ? 2 : 1);

			throwReachedTerminalTime =
				throwLegDistanceBlocks <= 0 ||
				throwElapsedMs >= throwLegDurationMs;

			if (throwReachedTerminalTime) {
				desiredThrowTravel = throwLegDistanceBlocks;
			} else if (isBoomerangLeg) {
				desiredThrowTravel = getThrowableBoomerangTravelDistance(
					b.throwDistanceBlocks,
					throwElapsedMs,
					b.throwDeceleration,
					b.throwInitialSpeed,
					b.throwFlightDurationMs,
				);
			} else {
				desiredThrowTravel = getThrowableTravelDistance(
					b.throwDistanceBlocks,
					throwElapsedMs,
					b.throwDeceleration,
					b.throwInitialSpeed,
					b.throwFlightDurationMs,
				);
			}

			frameDistance = Math.max(
				0,
				desiredThrowTravel - (b.throwTravelledBlocks ?? 0),
			);
		} else {
			frameDistance = Math.hypot(b.vx, b.vy) * dt;
		}

		// dv is the projectile's intended movement magnitude for this simulation
		// update. Projectile/projectile collision uses it to distinguish a fixed
		// stationary collider from a moving projectile.
		b.dv = frameDistance;

		const steps = Math.max(
			1,
			Math.ceil(frameDistance / BULLET_MAX_STEP_BLOCKS),
		);
		const stepDt = dt / steps;
		const throwableStepDistance = b.throwable ? frameDistance / steps : 0;
		const bouncy = isBouncyProjectile(b);

		let removeBullet = false;
		let detonateOnRemoval = false;
		let splitOnRemoval = false;
		let terminalWallAngle = null;

		for (let step = 0; step < steps; step++) {
			const intendedStepDistance = b.throwable
				? throwableStepDistance
				: Math.hypot(b.vx * stepDt, b.vy * stepDt);
			const phaseThisStep =
				Math.max(
					0,
					Number(
						b.remainingPenetrationBlocks ??
							b.penetrationBlocks ??
							0,
					) || 0,
				) > 0;
			const mockRect = projectileRect(b);
			let moveX = b.throwable
				? b.throwDirX * throwableStepDistance
				: b.vx * stepDt;
			let moveY = b.throwable
				? b.throwDirY * throwableStepDistance
				: b.vy * stepDt;

			if (b.finishPenetratedWall && bouncy) {
				// Preserve the existing rule: after a bouncy projectile spends its last
				// penetration while inside wall material, phase until the whole circle
				// has cleared the connected wall mass before enabling collision again.
				b.x += moveX;
				b.y += moveY;
			} else if (phaseThisStep) {
				const penetrationContact = findEarliestProjectileWallHit(
					b,
					moveX,
					moveY,
				);

				b.x += moveX;
				b.y += moveY;

				if (penetrationContact) {
					consumeProjectilePenetrationStep(
						b,
						intendedStepDistance,
						bouncy,
					);
				}
			} else {
				let impactCount = 0;

				while (
					Math.hypot(moveX, moveY) > WALL_APPROACH_EPSILON &&
					impactCount < MAX_WALL_IMPACTS_PER_SUBSTEP
				) {
					const wallHit = findEarliestProjectileWallHit(b, moveX, moveY);

					if (!wallHit) {
						b.x += moveX;
						b.y += moveY;
						break;
					}

					b.x += moveX * wallHit.time;
					b.y += moveY * wallHit.time;

					// Preserve the exact swept-circle contact before reflection/removal. This
					// also gives trails the true shared-corner point rather than an axis-wise
					// approximation.
					recordTrailCheckpoint();

					const canBounce = b.throwable || b.bounces < b.maxBounces;
					if (!canBounce) {
						removeBullet = true;
						detonateOnRemoval = b.detonatesOnImpact;
						splitOnRemoval = b.splitsOnImpact;
						terminalWallAngle = Math.atan2(
							wallHit.normalY,
							wallHit.normalX,
						);
						break;
					}

					if (b.throwable) {
						const reflectedDirection = reflectVector(
							b.throwDirX,
							b.throwDirY,
							wallHit.normalX,
							wallHit.normalY,
						);
						const magnitude = Math.hypot(
							reflectedDirection.x,
							reflectedDirection.y,
						) || 1;
						b.throwDirX = reflectedDirection.x / magnitude;
						b.throwDirY = reflectedDirection.y / magnitude;
					} else {
						const reflectedVelocity = reflectVector(
							b.vx,
							b.vy,
							wallHit.normalX,
							wallHit.normalY,
						);
						b.vx = reflectedVelocity.x;
						b.vy = reflectedVelocity.y;
						b.bounces++;
					}

					triggerSuccessfulBounceEffects(b, currentTime);
					if (b.removedByProjectileCap) {
						removeBullet = true;
						detonateOnRemoval = false;
						splitOnRemoval = false;
						break;
					}

					const remainingFraction = Math.max(0, 1 - wallHit.time);
					const reflectedRemainder = reflectVector(
						moveX * remainingFraction,
						moveY * remainingFraction,
						wallHit.normalX,
						wallHit.normalY,
					);
					moveX = reflectedRemainder.x;
					moveY = reflectedRemainder.y;

					// Move an imperceptible distance onto the clear side of the contact
					// manifold so floating-point tangency cannot immediately report t=0 on
					// the same connected wall surface.
					b.x += wallHit.normalX * WALL_CONTACT_NUDGE;
					b.y += wallHit.normalY * WALL_CONTACT_NUDGE;
					impactCount++;
				}
			}

			if (removeBullet) break;

			mockRect.x = b.x - b.radius;
			mockRect.y = b.y - b.radius;

			if (b.finishPenetratedWall && bouncy) {
				if (!projectileOverlapsAnyWall(b)) {
					b.finishPenetratedWall = false;
				}
			}

			// Target damage is independent of wall penetration. Any actual overlap
			// damages immediately and target contact never consumes penetration. A
			// chain can acquire at most one new target for this substep even if several
			// target hitboxes overlap at the same point; every newly hit enemy is still
			// marked visited so the projectile can never chain back through an earlier
			// target.
			let chainTriggeredThisStep = false;

			for (const t of targets) {
				const isTargetCollision = isColliding(mockRect, t);

				if (isTargetCollision) {
					if (!b.hitTargets.has(t)) {
						if (isPlayerProjectile || !GameState.isInvincible) {
							t.hp -= b.damage ?? 1;
						}
						b.hitTargets.add(t);

						if ((b.chain ?? 0) > 0) {
							b.chainVisitedTargets ??= new Set();
							b.chainVisitedTargets.add(t);
							if (b.chainTarget === t) b.chainTarget = null;

							if (!chainTriggeredThisStep && !b.chainTarget) {
								if (updateChainAimAndRecordTargetChange()) {
									chainTriggeredThisStep = true;
									triggerChainRedirectEffects(b, currentTime);
								}
							}
						}
					}
				} else {
					b.hitTargets.delete(t);
				}
			}
		}

		if (b.removedByProjectileCap) {
			removeBullet = true;
			detonateOnRemoval = false;
			splitOnRemoval = false;
		}

		if (removeBullet) {
			if (detonateOnRemoval) {
				detonateBullet(b, currentTime);
			}
			if (splitOnRemoval) {
				fireSplitChildren(
					b,
					terminalWallAngle ?? getProjectileDirectionAngle(b),
					currentTime,
				);
			}
			releaseProjectile(b);
			projectiles.splice(i, 1);
			continue;
		}

		if (b.throwable && desiredThrowTravel !== null) {
			const isBoomerangLeg = (b.throwBounces ?? 0) > 0;
			const throwLegDistanceBlocks =
				b.throwDistanceBlocks * (isBoomerangLeg ? 2 : 1);

			b.throwTravelledBlocks = throwReachedTerminalTime
				? throwLegDistanceBlocks
				: desiredThrowTravel;

			if (throwReachedTerminalTime) {
				const configuredBoomerangBounces = Math.max(
					0,
					Math.floor(Number(b.maxBounces ?? 0) || 0),
				);

				if ((b.throwBounces ?? 0) < configuredBoomerangBounces) {
					recordTrailCheckpoint();
					// A throwable bounce reverses direction by 180 degrees. The first
					// outbound leg is D and ends at v=0. Each bounce leg is 2D: it
					// accelerates from 0 to the original launch speed over the first D,
					// then decelerates back to 0 over the second D. One full 2D leg
					// consumes exactly one configured boomerang bounce.
					b.throwDirX *= -1;
					b.throwDirY *= -1;
					b.throwBounces = (b.throwBounces ?? 0) + 1;
					b.throwLegStartedAt = currentTime;
					b.throwTravelledBlocks = 0;
					b.throwComplete = false;
					triggerSuccessfulBounceEffects(b, currentTime);
				} else {
					b.throwComplete = true;

					if (b.detonatesOnImpact) {
						recordTrailCheckpoint();
						detonateBullet(b, currentTime);
						if (b.splitsOnImpact) {
							fireSplitChildren(
								b,
								getProjectileDirectionAngle(b),
								currentTime,
							);
						}
						releaseProjectile(b);
						projectiles.splice(i, 1);
						continue;
					}
					if (b.splitsOnImpact) {
						recordTrailCheckpoint();
						fireSplitChildren(
							b,
							getProjectileDirectionAngle(b),
							currentTime,
						);
						releaseProjectile(b);
						projectiles.splice(i, 1);
						continue;
					}
				}
			} else {
				b.throwComplete = false;
			}
		}

		if (currentTime - b.createdAt > b.lifetimeMs) {
			recordTrailCheckpoint();
			releaseProjectile(b);
			projectiles.splice(i, 1);
			continue;
		}

	}
}
