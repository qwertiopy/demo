// Projectile spawning, projectile/projectile collision, penetration, wall response, and movement.

import { GameState, player } from "../state.js";
import { isColliding } from "../utils.js";
import { detonateBullet } from "./explosions.js";
import {
	MIN_THROW_DECELERATION,
	getProjectileVolleyAngles,
	getThrowableBoomerangTravelDistance,
	getThrowableKinematics,
	getThrowableTravelDistance,
} from "./weapon-utils.js";

// Creates one projectile or a whole configured volley from the shooter's center.
export function shoot(shooter, targetX, targetY, bulletArray, stats) {
	if (GameState.isPlayerDead) return;

	const centerX = shooter.x + shooter.size / 2;
	const centerY = shooter.y + shooter.size / 2;
	const targetDx = targetX - centerX;
	const targetDy = targetY - centerY;
	const baseAngle = Math.atan2(targetDy, targetDx);
	const requestedAngles = getProjectileVolleyAngles(baseAngle, stats);
	const volleyAngles = bulletArray === GameState.bullets
		? requestedAngles.slice(0, 100)
		: requestedAngles;
	const throwable = stats.throwable === true;
	const speed = throwable ? 0 : (stats.speed ?? 12);
	const throwDistanceMultiplier = Math.max(
		0,
		Number(stats.throwDistanceMultiplier ?? 1) || 0,
	);
	const throwDistanceBlocks = throwable
		? Math.hypot(targetDx, targetDy) * throwDistanceMultiplier
		: 0;
	const throwDeceleration = throwable
		? Math.max(
			MIN_THROW_DECELERATION,
			Number(stats.throwDeceleration ?? 20) || 0,
		)
		: 0;
	const throwKinematics = throwable
		? getThrowableKinematics(throwDistanceBlocks, throwDeceleration)
		: null;
	const createdAt = performance.now();

	// Preserve the existing 100-player-projectile cap without allowing a volley
	// to overshoot it. Very large configured volleys are themselves capped at 100.
	if (bulletArray === GameState.bullets) {
		while (GameState.bullets.length + volleyAngles.length > 100) {
			GameState.bullets.shift();
		}
	}

	for (const angle of volleyAngles) {
		// Throwable vx/vy are intentionally zero: their movement is driven by the
		// closed-form throw-distance equation in processBullets(). throwDirX/Y are
		// unit direction components and can still be reflected by wall bounces.
		bulletArray.push({
			x: centerX,
			y: centerY,
			radius: stats.radiusBlocks ?? 0.08,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			color: stats.color ?? "white",
			damage: stats.damage ?? 1,
			bounces: 0,
			maxBounces: stats.maxBounces ?? 0,
			throwBounces: 0,
			hitTargets: new Set(),
			createdAt,
			lifetimeMs: stats.lifetimeMs ?? 60000,
			explosionRadiusBlocks: stats.explosionRadiusBlocks ?? 0,
			detonationTimeMs: stats.detonationTimeMs ?? 0,
			explosionDurationMs: stats.explosionDurationMs ?? 0,
			explosionDamage: stats.explosionDamage ?? 0,
			detonatesOnImpact: stats.detonatesOnImpact ?? false,
			penetrationBlocks: Math.max(0, Number(stats.penetrationBlocks ?? 0) || 0),
			remainingPenetrationBlocks: Math.max(
				0,
				Number(stats.penetrationBlocks ?? 0) || 0,
			),
			finishPenetratedWall: false,
			throwable,
			throwDirX: Math.cos(angle),
			throwDirY: Math.sin(angle),
			throwDistanceBlocks,
			throwDistanceMultiplier,
			throwTravelledBlocks: 0,
			throwLegStartedAt: createdAt,
			throwDeceleration,
			throwInitialSpeed: throwKinematics?.initialSpeed ?? 0,
			throwFlightDurationMs: throwKinematics?.durationMs ?? 0,
			throwComplete: !throwable || throwDistanceBlocks === 0,
			dv: 0,
			bulletCollision: stats.bulletCollision === true,

			get width() {
				return this.radius * 2;
			},
			get height() {
				return this.radius * 2;
			},
			get size() {
				return this.radius * 2;
			},
		});
	}
}

// Resolves circular projectile/projectile overlaps for any pair where at least
// one projectile opts in with bulletCollision=true. An opted-in projectile
// therefore collides with every player/enemy projectile, even when both are
// moving. dv is used only to keep a truly stationary projectile fixed when it
// is hit by a moving one; otherwise the overlap is split by projectile radius.
export function resolveProjectileVectorCollisions() {
	const allProjectiles = [...GameState.bullets, ...GameState.enemyBullets];
	const stationaryEpsilon = 1e-12;

	for (let i = 0; i < allProjectiles.length; i++) {
		for (let j = i + 1; j < allProjectiles.length; j++) {
			const a = allProjectiles[i];
			const b = allProjectiles[j];

			if (a.bulletCollision !== true && b.bulletCollision !== true) {
				continue;
			}

			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const distance = Math.hypot(dx, dy);
			const minDistance = (a.radius ?? 0) + (b.radius ?? 0);

			if (distance >= minDistance) continue;

			const angle = distance === 0 ? Math.random() * Math.PI * 2 : 0;
			const nx = distance === 0 ? Math.cos(angle) : dx / distance;
			const ny = distance === 0 ? Math.sin(angle) : dy / distance;
			const overlap = minDistance - (distance === 0 ? 0.001 : distance);
			const aStationary = (Number(a.dv) || 0) <= stationaryEpsilon;
			const bStationary = (Number(b.dv) || 0) <= stationaryEpsilon;

			if (aStationary && !bStationary) {
				b.x += nx * overlap;
				b.y += ny * overlap;
			} else if (!aStationary && bStationary) {
				a.x -= nx * overlap;
				a.y -= ny * overlap;
			} else {
				const totalRadius = Math.max(
					1e-9,
					(a.radius ?? 0) + (b.radius ?? 0),
				);
				const weightA = (b.radius ?? 0) / totalRadius;
				const weightB = (a.radius ?? 0) / totalRadius;

				a.x -= nx * overlap * weightA;
				a.y -= ny * overlap * weightA;
				b.x += nx * overlap * weightB;
				b.y += ny * overlap * weightB;
			}
		}
	}
}

// Returns a directionally inset collider that delays a collision by the
// requested penetration depth. Penetration is measured from the entry face
// along the active collision axis. If penetration is at least the collider's
// thickness on that axis, the collider is phased through completely.
export function getPenetratedCollisionRect(
	rect,
	penetrationBlocks = 0,
	axis = "x",
	direction = 1,
) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const penetration = Math.max(0, Number(penetrationBlocks) || 0);

	let x = rect.x;
	let y = rect.y;
	let adjustedWidth = width;
	let adjustedHeight = height;

	if (axis === "x") {
		if (adjustedWidth <= 0 || penetration >= adjustedWidth) return null;

		if (direction >= 0) {
			x += penetration;
		}
		adjustedWidth -= penetration;
	} else {
		if (adjustedHeight <= 0 || penetration >= adjustedHeight) return null;

		if (direction >= 0) {
			y += penetration;
		}
		adjustedHeight -= penetration;
	}

	return {
		x,
		y,
		width: adjustedWidth,
		height: adjustedHeight,
	};
}

// Moving projectiles have one total wall-penetration budget measured in
// blocks of travel while overlapping wall material. Each simulation substep
// starts by deciding whether penetration is still available. If it is, every
// wall collision in that substep is phased through and the intended path
// distance for that substep is deducted once from the remaining budget. This
// avoids double-charging at tile seams/corners while making continuous travel
// inside walls consume penetration continuously. Once a substep begins with no
// penetration remaining, the normal wall collision action is triggered.
function collidesWithWallUsingPenetrationBudget(
	bullet,
	wall,
	penetrationStepState,
	isBouncy,
) {
	if (!projectileCircleOverlapsWall(bullet, wall)) return false;

	// A bouncy projectile that spent its final penetration while already inside
	// wall material is allowed to finish exiting that material. Once completely
	// clear, the next wall contact executes the normal bounce action.
	if (bullet.finishPenetratedWall && isBouncy) return false;

	if (penetrationStepState.phaseThisStep) {
		if (!penetrationStepState.consumed) {
			const remaining = Math.max(
				0,
				Number(
					bullet.remainingPenetrationBlocks ??
						bullet.penetrationBlocks ??
						0,
				) || 0,
			);
			bullet.remainingPenetrationBlocks = Math.max(
				0,
				remaining - penetrationStepState.travelDistanceBlocks,
			);
			penetrationStepState.consumed = true;

			if (bullet.remainingPenetrationBlocks <= 0 && isBouncy) {
				bullet.finishPenetratedWall = true;
			}
		}
		return false;
	}

	return true;
}

// Maximum projectile travel per collision substep; limiting this prevents fast bullets from tunneling through walls or targets
// this can also be done by using the line of sight function to see if the bullet intersected a wall at any point between 2 steps, and if it did, reversing its direction or deleting it
// i think doing it that way is more robust and allows for faster bullets and is also generally less buggy because it relies on continuous mathematical calculations - cyn
export const BULLET_MAX_STEP_BLOCKS = 0.2;

// Returns whether a projectile has bounce behaviour available. Throwables are
// always wall-bouncy; their configured maxBounces is reserved for boomerang
// endpoint reversals rather than wall impacts.
function isBouncyProjectile(bullet) {
	return bullet.throwable === true || Math.max(0, bullet.maxBounces ?? 0) > 0;
}

function triggerSuccessfulBounceExplosion(bullet, isPlayerBullets, currentTime) {
	if ((bullet.explosionRadiusBlocks ?? 0) > 0) {
		detonateBullet(bullet, isPlayerBullets, currentTime);
	}
}

function projectileRect(bullet) {
	return {
		x: bullet.x - bullet.radius,
		y: bullet.y - bullet.radius,
		size: bullet.radius * 2,
	};
}

// Wall collision uses the projectile's rendered circular hitbox. projectileRect
// remains for entity damage so this bugfix does not change target hitboxes.
function projectileCircleOverlapsWall(bullet, wall) {
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;
	const closestX = Math.max(wall.x, Math.min(bullet.x, wall.x + width));
	const closestY = Math.max(wall.y, Math.min(bullet.y, wall.y + height));
	const dx = bullet.x - closestX;
	const dy = bullet.y - closestY;
	const radius = Math.max(0, Number(bullet.radius) || 0);

	// Tangency is a resolved contact rather than overlap. This lets a bounced
	// projectile move away from or along a wall without immediately re-hitting.
	return dx * dx + dy * dy < radius * radius - 1e-10;
}

// The old wall response moved the projectile a whole substep into the wall and
// then undid the entire substep, which could make a hit happen up to 0.2 blocks
// away from the visible wall. Once an overlap is detected, binary-search only
// that substep to place the circle immediately before its true contact point.
function resolveProjectileAxisWallContact(
	bullet,
	wall,
	axis,
	startCoordinate,
	endCoordinate,
) {
	let clearCoordinate = startCoordinate;
	let collidingCoordinate = endCoordinate;
	const originalCoordinate = axis === "x" ? bullet.x : bullet.y;

	for (let i = 0; i < 16; i++) {
		const midpoint = (clearCoordinate + collidingCoordinate) / 2;
		if (axis === "x") bullet.x = midpoint;
		else bullet.y = midpoint;

		if (projectileCircleOverlapsWall(bullet, wall)) {
			collidingCoordinate = midpoint;
		} else {
			clearCoordinate = midpoint;
		}
	}

	if (axis === "x") bullet.x = originalCoordinate;
	else bullet.y = originalCoordinate;

	return clearCoordinate;
}

// Substeps projectile movement, reflects bullets from walls, applies damage to
// valid targets, handles penetration/bounce synergies, advances closed-form
// throwable legs, tags zero-movement projectiles, and removes expired bullets.
export function processBullets(bulletArray, isPlayerBullets, currentTime, dt) {
	for (let i = bulletArray.length - 1; i >= 0; i--) {
		const b = bulletArray[i];
		const targets = isPlayerBullets ? GameState.enemies : [player];

		if (
			b.detonationTimeMs > 0 &&
			currentTime - b.createdAt >= b.detonationTimeMs
		) {
			detonateBullet(b, isPlayerBullets, currentTime);
			bulletArray.splice(i, 1);
			continue;
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

		for (let step = 0; step < steps; step++) {
			const intendedStepDistance = b.throwable
				? throwableStepDistance
				: Math.hypot(b.vx * stepDt, b.vy * stepDt);
			const penetrationStepState = {
				phaseThisStep:
					Math.max(
						0,
						Number(
							b.remainingPenetrationBlocks ??
								b.penetrationBlocks ??
								0,
						) || 0,
					) > 0,
				travelDistanceBlocks: intendedStepDistance,
				consumed: false,
			};

			const mockRect = projectileRect(b);
			const moveX = b.throwable
				? b.throwDirX * throwableStepDistance
				: b.vx * stepDt;

			const startX = b.x;
			b.x += moveX;
			mockRect.x = b.x - b.radius;
			mockRect.y = b.y - b.radius;

			const hitWallX = moveX === 0 ? null : GameState.walls.find((w) =>
				collidesWithWallUsingPenetrationBudget(
					b,
					w,
					penetrationStepState,
					bouncy,
				),
			);

			if (hitWallX) {
				b.x = resolveProjectileAxisWallContact(
					b,
					hitWallX,
					"x",
					startX,
					b.x,
				);
				mockRect.x = b.x - b.radius;

				if (b.throwable) {
					// Wall bounces are unlimited for throwables. maxBounces instead
					// controls boomerang reversals at throw-leg endpoints.
					b.throwDirX *= -1;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else if (b.bounces < b.maxBounces) {
					b.vx *= -1;
					b.bounces++;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else {
					removeBullet = true;
					detonateOnRemoval = b.detonatesOnImpact;
					break;
				}
			}

			const moveY = b.throwable
				? b.throwDirY * throwableStepDistance
				: b.vy * stepDt;

			const startY = b.y;
			b.y += moveY;
			mockRect.x = b.x - b.radius;
			mockRect.y = b.y - b.radius;

			const hitWallY = moveY === 0 ? null : GameState.walls.find((w) =>
				collidesWithWallUsingPenetrationBudget(
					b,
					w,
					penetrationStepState,
					bouncy,
				),
			);

			if (hitWallY) {
				b.y = resolveProjectileAxisWallContact(
					b,
					hitWallY,
					"y",
					startY,
					b.y,
				);
				mockRect.y = b.y - b.radius;

				if (b.throwable) {
					b.throwDirY *= -1;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else if (b.bounces < b.maxBounces) {
					b.vy *= -1;
					b.bounces++;
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else {
					removeBullet = true;
					detonateOnRemoval = b.detonatesOnImpact;
					break;
				}
			}

			// Once a bouncy projectile has spent its last penetration inside wall
			// material, keep phasing until its entire hitbox is clear. Only then is
			// the next wall contact allowed to execute a bounce/collision action.
			if (b.finishPenetratedWall && bouncy) {
				mockRect.x = b.x - b.radius;
				mockRect.y = b.y - b.radius;
				if (!GameState.walls.some((w) => projectileCircleOverlapsWall(b, w))) {
					b.finishPenetratedWall = false;
				}
			}

			// Target damage is independent of wall penetration. Any actual overlap
			// damages immediately and target contact never consumes penetration.
			targets.forEach((t) => {
				const isTargetCollision = isColliding(mockRect, t);

				if (isTargetCollision) {
					if (!b.hitTargets.has(t)) {
						if (isPlayerBullets || !GameState.isInvincible) {
							t.hp -= b.damage ?? 1;
						}
						b.hitTargets.add(t);
					}
				} else {
					b.hitTargets.delete(t);
				}
			});
		}

		if (removeBullet) {
			if (detonateOnRemoval) {
				detonateBullet(b, isPlayerBullets, currentTime);
			}
			bulletArray.splice(i, 1);
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
					triggerSuccessfulBounceExplosion(
						b,
						isPlayerBullets,
						currentTime,
					);
				} else {
					b.throwComplete = true;

					if (b.detonatesOnImpact) {
						detonateBullet(b, isPlayerBullets, currentTime);
						bulletArray.splice(i, 1);
						continue;
					}
				}
			} else {
				b.throwComplete = false;
			}
		}

		if (currentTime - b.createdAt > b.lifetimeMs) {
			bulletArray.splice(i, 1);
			continue;
		}

	}
}
