import { Config } from "../../config.js";
import { GameState, player, TEAM_PLAYER } from "../../state.js";
import {
	findChainTarget,
	getAngleToTarget,
	isTargetWithinChainRange,
} from "../targeting.js";
import { clampAngleToInterval } from "../visibility.js";
import { registerProjectile } from "../projectile-cap.js";
import { resolveProjectileDefinition } from "../projectile-schema.js";
import {
	getMinimumThrowDeceleration,
	getEffectiveVariationLuck,
	getProjectileVolleyAngles,
	getVariedStat,
	normalizeVariationLuckUpgrade,
	getThrowableKinematics,
} from "../weapon-utils.js";
import { isProjectileChainPathRadiusClear } from "./chain.js";

export function shoot(shooter, targetX, targetY, stats, options = {}) {
	if (GameState.isPlayerDead) return;
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
	const createdAt = performance.now();
	const chain = stats.chain?.enabled === true
		? Math.max(0, Math.floor(Number(stats.chain.maxTargets) || 0))
		: 0;
	const chainMaximumRangeBlocks = chain > 0
		? Math.max(0, Number(stats.chain.maximumRangeBlocks) || 0)
		: 0;

	for (const angle of volleyAngles) {
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
		const chainProbe = { x: centerX, y: centerY, radius };
		const pathIsRadiusClear = (target) =>
			isProjectileChainPathRadiusClear(chainProbe, target);
		const initialChainTarget = chain > 0
			? team === TEAM_PLAYER
				? findChainTarget(
					centerX,
					centerY,
					baseAngle,
					new Set(),
					"angle",
					pathIsRadiusClear,
					chainMaximumRangeBlocks,
				)
				: player.hp > 0 &&
					isTargetWithinChainRange(
						centerX,
						centerY,
						player,
						chainMaximumRangeBlocks,
					) &&
					pathIsRadiusClear(player)
					? player
					: null
			: null;
		const chainedLaunchAngle = initialChainTarget
			? getAngleToTarget(centerX, centerY, initialChainTarget)
			: null;
		// chain>0 overrides spread/volley direction when an eligible target exists:
		// the projectile aims directly at the enemy closest to the mouse angle.
		const projectileAngle = chainedLaunchAngle ?? angle;

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
			chainMaximumRangeBlocks,
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
