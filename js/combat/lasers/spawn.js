// Laser request creation, warmup scheduling, and split-laser registration.

import { GameState, player, TEAM_PLAYER } from "../../state.js";
import {
	registerSplitLaserFirer,
} from "../projectiles.js";
import {
	findChainTarget,
	getAngleToTarget,
	isTargetWithinChainRange,
} from "../targeting.js";
import {
	getBulletCount,
	getEffectiveVariationLuck,
	getLaserConeHalfAngleFromCount,
	getRandomSpreadOffset,
	getVariedStat,
	normalizeVariationLuckUpgrade,
} from "../weapon-utils.js";
import {
	getLaserLoadedRangeBlocks,
	getLaserLoadedWorldRadiusBlocks,
} from "./budget.js";
import { resolveLaserShot } from "./resolution.js";

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
	options = {},
) {
	const ignoreCooldown = options.ignoreCooldown === true;
	const index = ignoreCooldown ? null : Math.max(0, Number(weaponIndex) || 0);
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
		throw new Error(`Laser ownerId must be a positive integer; received ${ownerId}.`);
	}
	if (typeof team !== "string" || team.length === 0) {
		throw new Error("Laser team must be a non-empty string.");
	}
	const cooldownUntil = GameState.weaponCooldownUntilByWeapon[index] || 0;

	if (!ignoreCooldown && currentTime < cooldownUntil) return false;
	if (!ignoreCooldown && GameState.laserWarmups.some((shot) => shot.weaponIndex === index)) {
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
			effectiveVariationLuck,
		),
		damage: getVariedStat(
			stats.damage ?? 1,
			stats.damageVariation ?? 0,
			0,
			effectiveVariationLuck,
		),
	};
	const bulletCount = getBulletCount(variedStats);
	const baseAngle = Number.isFinite(options.forcedAngle)
		? options.forcedAngle
		: Math.atan2(targetY - centerY, targetX - centerX);
	// Chaining is singular-beam-only. Cone lasers keep their existing cone/spread
	// behavior even if the chain modifier is enabled.
	const chain = bulletCount === 1 && variedStats.chain?.enabled === true
		? Math.max(0, Math.floor(Number(variedStats.chain.maxTargets) || 0))
		: 0;
	const chainMaximumRangeBlocks = chain > 0
		? Math.max(0, Number(variedStats.chain.maximumRangeBlocks) || 0)
		: 0;
	const initialChainTarget = chain > 0
		? team === TEAM_PLAYER
			? findChainTarget(
				centerX,
				centerY,
				baseAngle,
				new Set(),
				"angle",
				null,
				chainMaximumRangeBlocks,
			)
			: player.hp > 0 && isTargetWithinChainRange(
				centerX,
				centerY,
				player,
				chainMaximumRangeBlocks,
			)
				? player
				: null
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
		ownerId,
		team,
		variationLuckUpgrade,
		maximumProjectileCount,
		weaponIndex: index,
		ignoreCooldown,
		dirX,
		dirY,
		centerAngle,
		coneHalfAngle,
		chain,
		chainMaximumRangeBlocks,
		chainsRemaining: Math.max(0, chain - 1),
		chainReferenceAngle: baseAngle,
		telegraphRangeBlocks,
		stats: variedStats,
		startedAt: currentTime,
		fireAt: currentTime + warmupMs,
	};

	if (warmupMs <= 0) {
		resolveLaserShot(shot, currentTime);
		if (!ignoreCooldown) {
			GameState.weaponCooldownUntilByWeapon[index] =
				currentTime + Math.max(0, Number(variedStats.cooldownMs) || 0);
		}
		return true;
	}

	GameState.laserWarmups.push(shot);
	return true;
}

registerSplitLaserFirer(({
	shooter,
	ownerId,
	team,
	variationLuckUpgrade,
	angle,
	stats,
	currentTime,
}) =>
	requestLaserShot(
		shooter,
		shooter.x + Math.cos(angle),
		shooter.y + Math.sin(angle),
		stats,
		-1,
		currentTime,
		{
			ownerId,
			team,
			variationLuckUpgrade,
			forcedAngle: angle,
			ignoreCooldown: true,
		},
	),
);

