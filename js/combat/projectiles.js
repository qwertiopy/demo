// Projectile spawning, projectile/projectile collision, penetration, wall response, and movement.

import { Config } from "../config.js";
import { GameState, getEntityById } from "../state.js";
import { queryWallsInAabb } from "../spatial/wall-index.js";
import { queryExposedWallCorners } from "../spatial/wall-feature-index.js";
import { queryActorsInAabb } from "../spatial/entity-index.js";
import { detonateBullet } from "./explosions.js";
import {
	circleIntersectsRenderedShape,
	hasProjectileRadiusClearance,
} from "./collision.js";
import { isDamageableTarget } from "./team-relations.js";
import { applyCombatDamage } from "./damage.js";
import { runProjectileEffectOrder } from "./effect-order.js";
import {
	findChainTarget,
	getAngleToTarget,
	getTargetCenter,
} from "./targeting.js";
import { clampAngleToInterval } from "./visibility.js";
import { getCombatDefault } from "./defaults.js";
import { registerProjectile, releaseProjectile } from "./projectile-cap.js";
import {
	getSplitChildDefinition,
	resolveProjectileDefinition,
} from "./projectile-schema.js";
import {
	getMinimumThrowDeceleration,
	getEffectiveVariationLuck,
	getProjectileVolleyAngles,
	getVariedStat,
	normalizeVariationLuckUpgrade,
	getThrowableBoomerangTravelDistance,
	getThrowableKinematics,
	getThrowableTravelDistance,
} from "./weapon-utils.js";

let splitLaserFirer = null;

export function registerSplitLaserFirer(firer) {
	splitLaserFirer = typeof firer === "function" ? firer : null;
}

function getSplitAngles(baseAngle, count, spread) {
	if (count <= 0) return [];
	if (count === 1) return [baseAngle];
	const cappedSpread = Math.min(Math.PI * 2, Math.max(0, Number(spread)));
	if (cappedSpread >= Math.PI * 2) {
		return Array.from(
			{ length: count },
			(_, index) => baseAngle - Math.PI + index * Math.PI * 2 / count,
		);
	}
	return Array.from(
		{ length: count },
		(_, index) => baseAngle - cappedSpread / 2 + index * cappedSpread / (count - 1),
	);
}

function selectSplitChildEntries(children, count) {
	if (!Array.isArray(children) || children.length === 0) {
		return Array.from({ length: count }, () => null);
	}
	const weights = children.map((entry) => Math.max(0, Number(entry?.weight) || 0));
	const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
	if (weightTotal <= 0) {
		return Array.from({ length: count }, (_, index) => children[index % children.length]);
	}
	return Array.from({ length: count }, () => {
		let roll = Math.random() * weightTotal;
		let lastPositive = children[0];
		for (let index = 0; index < children.length; index++) {
			if (weights[index] <= 0) continue;
			lastPositive = children[index];
			roll -= weights[index];
			if (roll <= 0) return children[index];
		}
		return lastPositive;
	});
}

function getProjectileDirectionAngle(projectile) {
	return projectile.throwable
		? Math.atan2(projectile.throwDirY, projectile.throwDirX)
		: Math.atan2(projectile.vy, projectile.vx);
}

export function fireSplitChildren(projectile, baseAngle, currentTime) {
	if (!projectile.splitEnabled || projectile.splitCount <= 0) return false;
	const angles = getSplitAngles(baseAngle, projectile.splitCount, projectile.splitSpread);
	const entries = selectSplitChildEntries(projectile.splitChildren, angles.length);
	const origin = { x: projectile.x, y: projectile.y, size: 0 };

	for (let index = 0; index < angles.length; index++) {
		const childStats = getSplitChildDefinition(Config.BASE_PROJECTILE, entries[index]);
		const angle = angles[index];
		if (childStats.laser) {
			splitLaserFirer?.({
				shooter: origin,
				ownerId: projectile.ownerId,
				team: projectile.team,
				variationLuckUpgrade: projectile.variationLuckUpgrade,
				angle,
				stats: childStats,
				currentTime,
			});
		} else {
			shoot(
				origin,
				origin.x + Math.cos(angle),
				origin.y + Math.sin(angle),
				childStats,
				{
					ownerId: projectile.ownerId,
					team: projectile.team,
					variationLuckUpgrade: projectile.variationLuckUpgrade,
					splitCreated: true,
					forcedBaseAngle: angle,
				},
			);
		}
	}
	return true;
}

// Trails are sampled once per render frame, but projectile wall impacts and
// removals can happen between those samples. Keep a tiny transient path for
// any projectile that bounces or dies during this simulation update so the
// renderer can preserve the exact impact/reversal/terminal point.
function pushProjectileTrailEvent(projectile, x = projectile.x, y = projectile.y) {
	GameState.projectileTrailEvents.push({
		projectile,
		x,
		y,
		radius: projectile.radius,
		color: projectile.color,
	});
}

function redirectProjectileTowardTarget(projectile, target) {
	const center = getTargetCenter(target);
	redirectProjectileTowardPoint(projectile, center.x, center.y);
}

function redirectProjectileTowardPoint(projectile, targetX, targetY) {
	const angle = Math.atan2(targetY - projectile.y, targetX - projectile.x);
	const dirX = Math.cos(angle);
	const dirY = Math.sin(angle);

	if (projectile.throwable) {
		projectile.throwDirX = dirX;
		projectile.throwDirY = dirY;
		return;
	}

	const speed = Math.hypot(projectile.vx, projectile.vy);
	projectile.vx = dirX * speed;
	projectile.vy = dirY * speed;
}

function chooseChainWaypoint(projectile, target) {
	const center = getTargetCenter(target);
	const padding = Math.max(2, projectile.radius * 2);
	const corners = queryExposedWallCorners(
		Math.min(projectile.x, center.x) - padding,
		Math.min(projectile.y, center.y) - padding,
		Math.max(projectile.x, center.x) + padding,
		Math.max(projectile.y, center.y) + padding,
	);
	let best = null;
	let bestCost = Infinity;

	for (const corner of corners) {
		for (const quadrant of corner.freeQuadrants) {
			const waypoint = {
				x: corner.x + quadrant.x * projectile.radius,
				y: corner.y + quadrant.y * projectile.radius,
				cornerX: corner.x,
				cornerY: corner.y,
			};
			if (!hasProjectileRadiusClearance(
				projectile.x,
				projectile.y,
				waypoint.x,
				waypoint.y,
				projectile.radius,
			)) continue;
			if (!hasProjectileRadiusClearance(
				waypoint.x,
				waypoint.y,
				center.x,
				center.y,
				projectile.radius,
			)) continue;
			const cost = Math.hypot(waypoint.x - projectile.x, waypoint.y - projectile.y) +
				Math.hypot(center.x - waypoint.x, center.y - waypoint.y);
			if (cost < bestCost) {
				best = waypoint;
				bestCost = cost;
			}
		}
	}
	return best;
}

function steerChainProjectile(projectile, target) {
	const center = getTargetCenter(target);
	if (hasProjectileRadiusClearance(
		projectile.x,
		projectile.y,
		center.x,
		center.y,
		projectile.radius,
	)) {
		projectile.chainWaypoint = null;
		redirectProjectileTowardTarget(projectile, target);
		return true;
	}

	let waypoint = projectile.chainWaypoint;
	const reachedWaypoint = waypoint &&
		Math.hypot(waypoint.x - projectile.x, waypoint.y - projectile.y) <=
			Math.max(1e-6, projectile.radius * 0.25);
	if (
		!waypoint ||
		reachedWaypoint ||
		!hasProjectileRadiusClearance(
			projectile.x,
			projectile.y,
			waypoint.x,
			waypoint.y,
			projectile.radius,
		)
	) {
		waypoint = chooseChainWaypoint(projectile, target);
		projectile.chainWaypoint = waypoint;
	}
	if (!waypoint) return false;
	redirectProjectileTowardPoint(projectile, waypoint.x, waypoint.y);
	return true;
}

function isActiveProjectileChainTarget(projectile, target) {
	if (
		!target ||
		(Number(target.hp) || 0) <= 0 ||
		projectile.chainVisitedTargets?.has(target)
	) {
		return false;
	}

	return (
		isDamageableTarget(projectile.team, target) &&
		getEntityById(target.id) === target
	);
}

// Active chain projectiles greedily home along the direct current line to their
// acquired target. An untargeted projectile scans once per simulation frame;
// after a target is acquired it retains that target until the target is hit,
// dies, or leaves the active target list. Returns true only when this acquisition
// consumes a post-hit chain redirect, so impact modifiers trigger once rather
// than on every steering adjustment.
export function updateProjectileChainAim(projectile) {
	if (Math.max(0, Number(projectile.chain) || 0) <= 0) return false;

	projectile.chainVisitedTargets ??= new Set();
	if (isActiveProjectileChainTarget(projectile, projectile.chainTarget)) {
		steerChainProjectile(projectile, projectile.chainTarget);
		return false;
	}

	projectile.chainTarget = null;
	const isPostHitRedirect = projectile.chainVisitedTargets.size > 0;
	if (isPostHitRedirect && (projectile.chainsRemaining ?? 0) <= 0) {
		return false;
	}

	const referenceAngle = projectile.chainReferenceAngle ??
		getProjectileDirectionAngle(projectile);
	const target = findChainTarget(
			projectile.x,
			projectile.y,
			referenceAngle,
			projectile.chainVisitedTargets,
			isPostHitRedirect ? "distance" : "angle",
			projectile.radius,
			projectile.team,
		);

	if (!target) return false;

	projectile.chainTarget = target;
	if (isPostHitRedirect) projectile.chainsRemaining--;
	steerChainProjectile(projectile, target);
	return isPostHitRedirect;
}

function triggerImpactPayloadEffects(projectile, currentTime) {
	runProjectileEffectOrder({
		explosion: projectile.detonatesOnImpact
			? () => detonateBullet(projectile, currentTime)
			: null,
		split: projectile.splitsOnImpact
			? () => fireSplitChildren(
				projectile,
				getProjectileDirectionAngle(projectile),
				currentTime,
			)
			: null,
	});
}

function triggerChainRedirectEffects(projectile, currentTime) {
	triggerImpactPayloadEffects(projectile, currentTime);
}

// Creates one projectile or a whole configured volley from the shooter's center.
// Ownership identifies one entity's FIFO queue; team independently controls
// targeting and damage. Both are copied directly to every split descendant.
export function shoot(shooter, targetX, targetY, stats, options = {}) {
	stats = resolveProjectileDefinition(Config.BASE_PROJECTILE, stats);
	const ownerId = options.ownerId ?? shooter.id;
	const team = options.team ?? shooter.team;
	const maximumProjectileCount = options.maximumProjectileCount ??
		shooter.maximumProjectileCount;
	const variationLuckUpgrade = normalizeVariationLuckUpgrade(
		options.variationLuckUpgrade ?? shooter.upgrades?.variationLuck,
	);
	const effectiveVariationLuck = getEffectiveVariationLuck(
		stats,
		variationLuckUpgrade,
	);
	if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
		throw new Error(`Projectile ownerId must be a positive integer; received ${ownerId}.`);
	}
	if (typeof team !== "string" || team.length === 0) {
		throw new Error("Projectile team must be a non-empty string.");
	}

	const centerX = shooter.x + shooter.size / 2;
	const centerY = shooter.y + shooter.size / 2;
	const targetDx = targetX - centerX;
	const targetDy = targetY - centerY;
	const baseAngle = Number.isFinite(options.forcedBaseAngle)
		? options.forcedBaseAngle
		: Math.atan2(targetDy, targetDx);
	const requestedAngles = getProjectileVolleyAngles(baseAngle, stats);
	const constrainedAngles = stats.aimAngleBounds
		? requestedAngles.map((angle) =>
			clampAngleToInterval(angle, stats.aimAngleBounds),
		)
		: requestedAngles;
	const volleyAngles = constrainedAngles;
	const throwable = stats.throwable === true;
	const throwDistanceMultiplier = Math.max(
		0,
		Number(stats.throwDistanceMultiplier) || 0,
	);
	const throwDistanceBlocks = throwable
		? Math.hypot(targetDx, targetDy) * throwDistanceMultiplier
		: 0;
	const throwDeceleration = throwable
		? Math.max(
			getMinimumThrowDeceleration(),
			Number(stats.throwDeceleration) || 0,
		)
		: 0;
	const createdAt = Number.isFinite(Number(options.currentTime))
		? Number(options.currentTime)
		: GameState.simulationTimeMs;
	const chain = Math.max(0, Math.floor(Number(stats.chain) || 0));
	const initialChainTarget = chain > 0
		? findChainTarget(
				centerX,
				centerY,
				baseAngle,
				new Set(),
				"angle",
				Math.max(
					0,
					Number(stats.radiusBlocks) + Number(stats.radiusVariation || 0),
				),
				team,
			)
		: null;
	const chainedLaunchAngle = initialChainTarget
		? getAngleToTarget(centerX, centerY, initialChainTarget)
		: null;

	for (const angle of volleyAngles) {
		// chain>0 overrides spread/volley direction when an eligible target exists:
		// the projectile aims directly at the enemy closest to the mouse angle.
		const projectileAngle = chainedLaunchAngle ?? angle;

		// Variation is rolled independently for every projectile and stat. The
		// owner upgrade is snapshotted once per firing action, then combined with
		// this weapon's configured luck and maximum.
		const speed = throwable
			? 0
			: getVariedStat(
				stats.speed,
				stats.speedVariation,
				0,
				effectiveVariationLuck,
			);
		const radius = getVariedStat(
			stats.radiusBlocks,
			stats.radiusVariation,
			0,
			effectiveVariationLuck,
		);
		const damage = getVariedStat(
			stats.damage,
			stats.damageVariation,
			0,
			effectiveVariationLuck,
		);
		const splitThrowInitialSpeed = options.splitCreated && throwable
			? getVariedStat(
				stats.speed,
				stats.speedVariation,
				0,
				effectiveVariationLuck,
			)
			: 0;
		const projectileThrowDistanceBlocks = options.splitCreated && throwable
			? splitThrowInitialSpeed * splitThrowInitialSpeed /
				(2 * throwDeceleration) * throwDistanceMultiplier
			: throwDistanceBlocks;
		const projectileThrowDeceleration = options.splitCreated && throwable &&
			throwDistanceMultiplier > 0
			? throwDeceleration / throwDistanceMultiplier
			: throwDeceleration;
		const throwKinematics = throwable
			? getThrowableKinematics(
				projectileThrowDistanceBlocks,
				projectileThrowDeceleration,
			)
			: null;

		// Throwable vx/vy are intentionally zero: their movement is driven by the
		// closed-form throw-distance equation in processProjectiles(). throwDirX/Y are
		// unit direction components and can still be reflected by wall bounces.
		const projectile = {
			x: centerX,
			y: centerY,
			radius,
			vx: Math.cos(projectileAngle) * speed,
			vy: Math.sin(projectileAngle) * speed,
			color: stats.color,
			damage,
			bounces: 0,
			maxBounces: stats.maxBounces,
			throwBounces: 0,
			hitTargets: new Set(),
			chain,
			chainsRemaining: Math.max(0, chain - 1),
			chainReferenceAngle: baseAngle,
			chainVisitedTargets: new Set(),
			chainTarget: initialChainTarget,
			createdAt,
			lifetimeMs: stats.lifetimeMs,
			explosionRadiusBlocks: stats.explosionRadiusBlocks,
			detonationTimeMs: stats.detonationTimeMs,
			explosionDurationMs: stats.explosionDurationMs,
			explosionDamage: stats.explosionDamage,
			detonatesOnImpact: stats.detonatesOnImpact,
			splitEnabled: stats.splitEnabled,
			splitCount: stats.splitCount,
			splitTimeMs: stats.splitTimeMs,
			splitsOnImpact: stats.splitsOnImpact,
			splitSpread: stats.splitSpread,
			splitChildren: stats.splitChildren,
			ownerId,
			team,
			variationLuckUpgrade,
			penetrationBlocks: Math.max(0, Number(stats.penetrationBlocks ?? 0) || 0),
			remainingPenetrationBlocks: Math.max(
				0,
				Number(stats.penetrationBlocks ?? 0) || 0,
			),
			finishPenetratedWall: false,
			throwable,
			throwDirX: Math.cos(projectileAngle),
			throwDirY: Math.sin(projectileAngle),
			throwDistanceBlocks: projectileThrowDistanceBlocks,
			throwDistanceMultiplier,
			throwTravelledBlocks: 0,
			throwLegStartedAt: createdAt,
			throwDeceleration: projectileThrowDeceleration,
			throwInitialSpeed: throwKinematics?.initialSpeed ?? 0,
			throwFlightDurationMs: throwKinematics?.durationMs ?? 0,
			throwComplete: !throwable || projectileThrowDistanceBlocks === 0,
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
		};
		GameState.projectiles.push(projectile);
		projectile.projectileCapEntry = registerProjectile(
			ownerId,
			projectile,
			maximumProjectileCount,
		);
	}
}

// Resolves circular projectile/projectile overlaps for any pair where at least
// one projectile opts in with bulletCollision=true. An opted-in projectile
// therefore collides with every player/enemy projectile, even when both are
// moving. dv is used only to keep a truly stationary projectile fixed when it
// is hit by a moving one; otherwise the overlap is split by projectile radius.
export function resolveProjectileVectorCollisions() {
	const allProjectiles = GameState.projectiles.filter(
		(projectile) => !projectile.removedByProjectileCap,
	);
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

// Maximum projectile travel per collision substep; limiting this prevents fast
// bullets from tunneling through targets. Wall collision itself is now swept
// continuously across the whole 2D substep rather than resolving X then Y.
export function getBulletMaxStepBlocks() {
	return getCombatDefault("PROJECTILE_MAX_STEP_BLOCKS");
}

// Returns whether a projectile has bounce behaviour available. Throwables are
// always wall-bouncy; their configured maxBounces is reserved for boomerang
// endpoint reversals rather than wall impacts.
function isBouncyProjectile(bullet) {
	return bullet.throwable === true || Math.max(0, bullet.maxBounces ?? 0) > 0;
}

function triggerSuccessfulBounceEffects(bullet, currentTime) {
	runProjectileEffectOrder({
		chain: () => updateProjectileChainAim(bullet),
		explosion: bullet.detonatesOnImpact === true
			? () => detonateBullet(bullet, currentTime)
			: null,
		split: bullet.splitsOnImpact === true
			? () => fireSplitChildren(
				bullet,
				getProjectileDirectionAngle(bullet),
				currentTime,
			)
			: null,
	});
}

function projectileRect(bullet) {
	return {
		x: bullet.x - bullet.radius,
		y: bullet.y - bullet.radius,
		size: bullet.radius * 2,
	};
}

// Wall collision uses the projectile's rendered circular hitbox. projectileRect
// remains for entity damage so wall-hitbox accuracy does not change target
// hitboxes.
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

function getProjectileWallCandidates(bullet, moveX = 0, moveY = 0) {
	const radius = Math.max(0, Number(bullet.radius) || 0);
	const endX = bullet.x + moveX;
	const endY = bullet.y + moveY;

	return queryWallsInAabb(
		Math.min(bullet.x, endX) - radius,
		Math.min(bullet.y, endY) - radius,
		Math.max(bullet.x, endX) + radius,
		Math.max(bullet.y, endY) + radius,
	);
}

function projectileOverlapsAnyWall(bullet) {
	return getProjectileWallCandidates(bullet).some((wall) =>
		projectileCircleOverlapsWall(bullet, wall)
	);
}

function dynamicCombatDefault(key) {
	return { valueOf: () => getCombatDefault(key) };
}

const WALL_TOI_EPSILON = dynamicCombatDefault("WALL_TOI_EPSILON");
const WALL_APPROACH_EPSILON = dynamicCombatDefault("WALL_APPROACH_EPSILON");
const WALL_CONTACT_NUDGE = dynamicCombatDefault("WALL_CONTACT_NUDGE");
const MAX_WALL_IMPACTS_PER_SUBSTEP = dynamicCombatDefault(
	"MAX_WALL_IMPACTS_PER_SUBSTEP",
);
const BULLET_MAX_STEP_BLOCKS = dynamicCombatDefault("PROJECTILE_MAX_STEP_BLOCKS");

function reflectVector(x, y, normalX, normalY) {
	const dot = x * normalX + y * normalY;
	return {
		x: x - 2 * dot * normalX,
		y: y - 2 * dot * normalY,
	};
}

function getOverlapNormal(bullet, wall, moveX, moveY) {
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;
	const left = wall.x;
	const right = wall.x + width;
	const top = wall.y;
	const bottom = wall.y + height;
	const closestX = Math.max(left, Math.min(bullet.x, right));
	const closestY = Math.max(top, Math.min(bullet.y, bottom));
	const dx = bullet.x - closestX;
	const dy = bullet.y - closestY;
	const distance = Math.hypot(dx, dy);

	if (distance > WALL_APPROACH_EPSILON) {
		return { normalX: dx / distance, normalY: dy / distance };
	}

	// This fallback is only expected when a projectile begins a non-penetrating
	// step already inside wall material. Push against the incoming motion rather
	// than choosing an arbitrary wall face.
	if (Math.abs(moveX) >= Math.abs(moveY)) {
		return { normalX: moveX >= 0 ? -1 : 1, normalY: 0 };
	}

	return { normalX: 0, normalY: moveY >= 0 ? -1 : 1 };
}

function firstRayCircleHit(
	startX,
	startY,
	moveX,
	moveY,
	centerX,
	centerY,
	radius,
) {
	const a = moveX * moveX + moveY * moveY;
	if (a <= WALL_APPROACH_EPSILON) return null;

	const relX = startX - centerX;
	const relY = startY - centerY;
	const b = 2 * (relX * moveX + relY * moveY);
	const c = relX * relX + relY * relY - radius * radius;
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) return null;

	const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
	const denominator = 2 * a;
	const first = (-b - sqrtDiscriminant) / denominator;
	const second = (-b + sqrtDiscriminant) / denominator;

	if (first >= -WALL_TOI_EPSILON && first <= 1 + WALL_TOI_EPSILON) {
		return Math.max(0, Math.min(1, first));
	}
	if (second >= -WALL_TOI_EPSILON && second <= 1 + WALL_TOI_EPSILON) {
		return Math.max(0, Math.min(1, second));
	}

	return null;
}

// Exact swept-circle vs axis-aligned rectangle collision for one movement
// segment. Faces are tested as offset line segments and corners as circles,
// which preserves the true rounded Minkowski boundary instead of treating the
// projectile as a square-expanded AABB.
function sweptCircleWallHit(bullet, moveX, moveY, wall) {
	if (projectileCircleOverlapsWall(bullet, wall)) {
		const normal = getOverlapNormal(bullet, wall, moveX, moveY);
		return { time: 0, ...normal };
	}

	const radius = Math.max(0, Number(bullet.radius) || 0);
	const width = wall.width ?? wall.size ?? 0;
	const height = wall.height ?? wall.size ?? 0;
	const left = wall.x;
	const right = wall.x + width;
	const top = wall.y;
	const bottom = wall.y + height;
	const startX = bullet.x;
	const startY = bullet.y;
	const candidates = [];

	const addCandidate = (time, normalX, normalY) => {
		if (!Number.isFinite(time)) return;
		if (time < -WALL_TOI_EPSILON || time > 1 + WALL_TOI_EPSILON) return;
		if (moveX * normalX + moveY * normalY >= -WALL_APPROACH_EPSILON) {
			return;
		}
		candidates.push({
			time: Math.max(0, Math.min(1, time)),
			normalX,
			normalY,
		});
	};

	if (moveX > WALL_APPROACH_EPSILON) {
		const time = (left - radius - startX) / moveX;
		const y = startY + moveY * time;
		if (y >= top - WALL_TOI_EPSILON && y <= bottom + WALL_TOI_EPSILON) {
			addCandidate(time, -1, 0);
		}
	} else if (moveX < -WALL_APPROACH_EPSILON) {
		const time = (right + radius - startX) / moveX;
		const y = startY + moveY * time;
		if (y >= top - WALL_TOI_EPSILON && y <= bottom + WALL_TOI_EPSILON) {
			addCandidate(time, 1, 0);
		}
	}

	if (moveY > WALL_APPROACH_EPSILON) {
		const time = (top - radius - startY) / moveY;
		const x = startX + moveX * time;
		if (x >= left - WALL_TOI_EPSILON && x <= right + WALL_TOI_EPSILON) {
			addCandidate(time, 0, -1);
		}
	} else if (moveY < -WALL_APPROACH_EPSILON) {
		const time = (bottom + radius - startY) / moveY;
		const x = startX + moveX * time;
		if (x >= left - WALL_TOI_EPSILON && x <= right + WALL_TOI_EPSILON) {
			addCandidate(time, 0, 1);
		}
	}

	const corners = [
		{ x: left, y: top, xSide: -1, ySide: -1 },
		{ x: right, y: top, xSide: 1, ySide: -1 },
		{ x: right, y: bottom, xSide: 1, ySide: 1 },
		{ x: left, y: bottom, xSide: -1, ySide: 1 },
	];

	for (const corner of corners) {
		const time = firstRayCircleHit(
			startX,
			startY,
			moveX,
			moveY,
			corner.x,
			corner.y,
			radius,
		);
		if (time === null) continue;

		const hitX = startX + moveX * time;
		const hitY = startY + moveY * time;
		const inCornerRegionX = corner.xSide < 0
			? hitX <= left + WALL_TOI_EPSILON
			: hitX >= right - WALL_TOI_EPSILON;
		const inCornerRegionY = corner.ySide < 0
			? hitY <= top + WALL_TOI_EPSILON
			: hitY >= bottom - WALL_TOI_EPSILON;
		if (!inCornerRegionX || !inCornerRegionY) continue;

		const normalDx = hitX - corner.x;
		const normalDy = hitY - corner.y;
		const normalLength = Math.hypot(normalDx, normalDy);
		if (normalLength <= WALL_APPROACH_EPSILON) continue;

		addCandidate(
			time,
			normalDx / normalLength,
			normalDy / normalLength,
		);
	}

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.time - b.time);
	return candidates[0];
}

// Find the earliest collision against the UNION of all wall rectangles. When
// multiple connected wall tiles are reached at the same time, combine their
// normals into one contact manifold. This is what prevents an internal seam or
// shared vertex from being mistaken for the side of whichever candidate wall
// happened to appear first. The spatial index only narrows the broad phase; the
// exact swept-circle manifold calculation below is unchanged.
function findEarliestProjectileWallHit(bullet, moveX, moveY) {
	let earliestTime = Infinity;
	const simultaneousHits = [];
	const candidateWalls = getProjectileWallCandidates(bullet, moveX, moveY);

	for (const wall of candidateWalls) {
		const hit = sweptCircleWallHit(bullet, moveX, moveY, wall);
		if (!hit) continue;

		if (hit.time < earliestTime - WALL_TOI_EPSILON) {
			earliestTime = hit.time;
			simultaneousHits.length = 0;
			simultaneousHits.push(hit);
		} else if (Math.abs(hit.time - earliestTime) <= WALL_TOI_EPSILON) {
			simultaneousHits.push(hit);
		}
	}

	if (simultaneousHits.length === 0) return null;

	let normalX = 0;
	let normalY = 0;
	let mostOpposing = simultaneousHits[0];
	let mostOpposingDot = Infinity;

	for (const hit of simultaneousHits) {
		const approachDot = moveX * hit.normalX + moveY * hit.normalY;
		if (approachDot >= -WALL_APPROACH_EPSILON) continue;

		normalX += hit.normalX;
		normalY += hit.normalY;
		if (approachDot < mostOpposingDot) {
			mostOpposingDot = approachDot;
			mostOpposing = hit;
		}
	}

	const normalLength = Math.hypot(normalX, normalY);
	if (normalLength <= WALL_APPROACH_EPSILON) {
		normalX = mostOpposing.normalX;
		normalY = mostOpposing.normalY;
	} else {
		normalX /= normalLength;
		normalY /= normalLength;
	}

	return {
		time: earliestTime,
		normalX,
		normalY,
	};
}

function consumeProjectilePenetrationStep(bullet, travelDistanceBlocks, isBouncy) {
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
		remaining - travelDistanceBlocks,
	);

	if (bullet.remainingPenetrationBlocks <= 0 && isBouncy) {
		bullet.finishPenetratedWall = true;
	}
}

// Substeps projectile movement, reflects bullets from walls, applies damage to
// valid targets, handles penetration/bounce synergies, advances closed-form
// throwable legs, tags zero-movement projectiles, and removes expired bullets.
export function processProjectiles(currentTime, dt) {
	const projectiles = GameState.projectiles;
	for (let i = projectiles.length - 1; i >= 0; i--) {
		const b = projectiles[i];

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
			pushProjectileTrailEvent(b);
		};

		if (updateProjectileChainAim(b)) {
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
						updateProjectileChainAim(b);
						removeBullet = true;
						detonateOnRemoval = b.detonatesOnImpact;
						splitOnRemoval = b.splitsOnImpact;
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

					const remainingDistance = Math.hypot(moveX, moveY) *
						Math.max(0, 1 - wallHit.time);
					const outgoingAngle = getProjectileDirectionAngle(b);
					moveX = Math.cos(outgoingAngle) * remainingDistance;
					moveY = Math.sin(outgoingAngle) * remainingDistance;

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
			const targets = queryActorsInAabb(
				b.x - b.radius,
				b.y - b.radius,
				b.x + b.radius,
				b.y + b.radius,
			).filter((target) => isDamageableTarget(b.team, target));

			for (const previousTarget of b.hitTargets) {
				if (!circleIntersectsRenderedShape(
					b.x,
					b.y,
					b.radius,
					previousTarget,
				)) {
					b.hitTargets.delete(previousTarget);
				}
			}

			for (const t of targets) {
				const isTargetCollision =
					isDamageableTarget(b.team, t) &&
					circleIntersectsRenderedShape(b.x, b.y, b.radius, t);

				if (isTargetCollision) {
					if (!b.hitTargets.has(t)) {
						applyCombatDamage(b.team, t, b.damage ?? 1);
						b.hitTargets.add(t);

						if ((b.chain ?? 0) > 0) {
							b.chainVisitedTargets ??= new Set();
							b.chainVisitedTargets.add(t);
							if (b.chainTarget === t) b.chainTarget = null;

							if (!chainTriggeredThisStep && !b.chainTarget) {
								if (updateProjectileChainAim(b)) {
									chainTriggeredThisStep = true;
									triggerChainRedirectEffects(b, currentTime);
								}
							}
						}
					}
				}
			}
		}

		if (b.removedByProjectileCap) {
			removeBullet = true;
			detonateOnRemoval = false;
			splitOnRemoval = false;
		}

		if (removeBullet) {
			runProjectileEffectOrder({
				explosion: detonateOnRemoval
					? () => detonateBullet(b, currentTime)
					: null,
				split: splitOnRemoval
					? () => fireSplitChildren(
						b,
						getProjectileDirectionAngle(b),
						currentTime,
					)
					: null,
				"terminal-impact": () => {
					releaseProjectile(b);
					projectiles.splice(i, 1);
				},
			});
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

		const explosionTimerExpired = b.detonationTimeMs > 0 &&
			currentTime - b.createdAt >= b.detonationTimeMs;
		const splitTimerExpired = b.splitTimeMs > 0 &&
			currentTime - b.createdAt >= b.splitTimeMs;
		if (explosionTimerExpired || splitTimerExpired) {
			recordTrailCheckpoint();
			runProjectileEffectOrder({
				explosion: explosionTimerExpired
					? () => detonateBullet(b, currentTime)
					: null,
				split: splitTimerExpired
					? () => fireSplitChildren(
						b,
						getProjectileDirectionAngle(b),
						currentTime,
					)
					: null,
				"terminal-impact": () => {
					releaseProjectile(b);
					projectiles.splice(i, 1);
				},
			});
			continue;
		}

		// Collision and all due projectile effects resolve before exact expiry.
		if (currentTime - b.createdAt >= b.lifetimeMs) {
			recordTrailCheckpoint();
			releaseProjectile(b);
			projectiles.splice(i, 1);
			continue;
		}

	}
}
