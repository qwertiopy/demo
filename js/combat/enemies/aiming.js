// Enemy visibility, predictive aiming, and budgeted wall-scan scheduling.

import { Config } from "../../config.js";
import { GameState, player } from "../../state.js";
import { hasLineOfSight } from "../collision.js";
import { getCombatDefault } from "../defaults.js";
import {
	calculateGapSafeWallAngle,
	calculateMaximumFleeInterceptDistance,
	calculateMaximumLeadHalfAngle,
} from "../targeting.js";
import {
	getAimConeWallScanCandidates,
	getAimVisibilityProfile,
	getAimWallCornerRecord,
	getVisibleAimInterval,
	updateAimWallCornerAngles,
} from "../visibility.js";
import { shortestAngleDelta } from "../weapon-utils.js";
import { getMaximumPlayerMovementSpeed } from "./helpers.js";

export const WALL_ANGLE_EPSILON = 1e-9;
let enemyAimCalculationBudgetRemaining = 0;
let enemyAimSchedulerNextEnemy = null;

export function resetEnemyAimCalculationBudget() {
	enemyAimCalculationBudgetRemaining = Math.max(
		1,
		Math.floor(getCombatDefault("ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME")),
	);
}

function consumeEnemyAimCalculationBudget() {
	if (enemyAimCalculationBudgetRemaining <= 0) return false;
	enemyAimCalculationBudgetRemaining--;
	return true;
}

export function resetWallAttack(enemy, resetLeadHistory = false) {
	enemy.aimMode = "lead";
	enemy.wallStartSide = 0;
	enemy.wallSweepDirection = 0;
	enemy.wallFrontierAngle = null;
	enemy.wallMaxHalfAngle = 0;
	enemy.wallLastSafeStep = 0;
	enemy.wallDeadline = 0;

	if (resetLeadHistory) {
		enemy.lastLeadPlayerVx = null;
		enemy.lastLeadPlayerVy = null;
		enemy.lastPredictedShotAngle = null;
	}
}

function getMaximumEnemyBulletRadius(enemy) {
	const stats = enemy.typeStats;
	const baseRadius = Math.max(
		0,
		Number(stats.bulletRadiusBlocks) || 0,
	);
	const radiusVariation = Math.max(
		0,
		Number(stats.bulletRadiusVariation ?? 0) || 0,
	);

	return baseRadius + radiusVariation;
}

function prepareEnemyAimCornerCache(enemy, forceRefresh = false) {
	const environmentRevision = Number(GameState.environmentRevision) || 0;
	if (!(enemy.aimWallCornerCache instanceof Map)) {
		enemy.aimWallCornerCache = new Map();
	}
	if (
		forceRefresh ||
		enemy.aimWallCornerCacheRevision !== environmentRevision
	) {
		enemy.aimWallCornerCache.clear();
		enemy.aimWallVisibilityScan = null;
		enemy.aimWallCornerCacheRevision = environmentRevision;
	}
}

function advanceEnemyAimWallScan(
	enemy,
	originX,
	originY,
	directAngle,
	halfAngle,
	maxDistance,
	calculationAllowance,
	forceCornerRefresh = false,
) {
	prepareEnemyAimCornerCache(enemy, forceCornerRefresh);
	const projectileRadius = getMaximumEnemyBulletRadius(enemy);
	let allowance = Math.max(
		0,
		Math.floor(Number(calculationAllowance) || 0),
	);
	let scannedCount = 0;

	if (!enemy.aimWallVisibilityScan) {
		enemy.aimWallVisibilityScan = {
			candidateWalls: getAimConeWallScanCandidates(
				originX,
				originY,
				directAngle,
				halfAngle,
				maxDistance,
				projectileRadius,
			),
			nextIndex: 0,
		};
	}

	const scan = enemy.aimWallVisibilityScan;
	while (true) {
		while (scan.nextIndex < scan.candidateWalls.length) {
			if (allowance <= 0 || !consumeEnemyAimCalculationBudget()) {
				return {
					walls: [],
					truncated: true,
					scannedCount,
				};
			}

			const wall = scan.candidateWalls[scan.nextIndex++];
			getAimWallCornerRecord(
				wall,
				projectileRadius,
				enemy.aimWallCornerCache,
				originX,
				originY,
			);
			allowance--;
			scannedCount++;
		}

		// The origin and cone may have moved while this scan was spread across
		// frames. Before publishing a complete result, append any walls that have
		// entered the current cone; already processed world-space records stay valid.
		const currentCandidates = getAimConeWallScanCandidates(
			originX,
			originY,
			directAngle,
			halfAngle,
			maxDistance,
			projectileRadius,
		);
		const processedWalls = new Set(scan.candidateWalls);
		const newWalls = currentCandidates.filter(
			(wall) => !processedWalls.has(wall),
		);
		if (newWalls.length > 0) {
			scan.candidateWalls.push(...newWalls);
			continue;
		}

		const walls = currentCandidates.map((wall) =>
			getAimWallCornerRecord(
				wall,
				projectileRadius,
				enemy.aimWallCornerCache,
				originX,
				originY,
			),
		);
		enemy.aimWallVisibilityScan = null;
		return { walls, truncated: false, scannedCount };
	}
}

export function getEnemyVisibleAimInterval(
	enemy,
	originX,
	originY,
	directAngle,
	halfAngle,
	maxDistance,
	preferredAngle = directAngle,
	walls = null,
) {
	return getVisibleAimInterval(
		originX,
		originY,
		directAngle,
		halfAngle,
		maxDistance,
		getMaximumEnemyBulletRadius(enemy),
		walls,
		preferredAngle,
	);
}

export function getEnemyAimVisibilityProfile(
	enemy,
	originX,
	originY,
	directAngle,
	halfAngle,
	maxDistance,
	walls = null,
) {
	return getAimVisibilityProfile(
		originX,
		originY,
		directAngle,
		halfAngle,
		maxDistance,
		getMaximumEnemyBulletRadius(enemy),
		walls,
	);
}

export function getEnemyPlayerContactDistance(enemy, playerCenterDistance) {
	// A circular inscribed target bound keeps this scalar depth conservative;
	// the actual axis-aligned player collision box can only be contacted sooner.
	const playerRadius = Math.max(0, Number(player.size) || 0) / 2;
	return Math.max(
		0,
		Math.max(0, Number(playerCenterDistance) || 0) -
			playerRadius -
			getMaximumEnemyBulletRadius(enemy),
	);
}

function cloneAimBoundary(boundary) {
	if (!boundary) return null;
	return {
		...boundary,
		point: boundary.point ? { ...boundary.point } : null,
		source: boundary.source ? { ...boundary.source } : null,
	};
}

export function getMaximumAimInterval(
	originX,
	originY,
	directAngle,
	halfAngle,
) {
	const boundedHalfAngle = Math.max(
		0,
		Math.min(Math.PI, Number(halfAngle) || 0),
	);

	return {
		originX,
		originY,
		centerAngle: directAngle,
		minAngle: directAngle - boundedHalfAngle,
		maxAngle: directAngle + boundedHalfAngle,
	};
}

export function rememberVisibleAimInterval(
	enemy,
	interval,
	maxDistance,
	maximumAimInterval = null,
	visibilityProfile = null,
) {
	const rememberedDistance = Math.max(0, Number(maxDistance) || 0);
	enemy.debugAimDistance = rememberedDistance;
	let rememberedMaximumAimInterval = null;
	let rememberedVisibilityProfile = null;

	if (maximumAimInterval) {
		rememberedMaximumAimInterval = { ...maximumAimInterval };
		enemy.debugMaximumAimInterval = rememberedMaximumAimInterval;
	}
	if (visibilityProfile) {
		rememberedVisibilityProfile = {
			...visibilityProfile,
			rays: visibilityProfile.rays.map((ray) => ({ ...ray })),
		};
		enemy.debugAimVisibilityProfile = rememberedVisibilityProfile;
	}

	if (!interval) {
		enemy.debugVisibleAimInterval = null;
		return;
	}

	const rememberedInterval = {
		originX: interval.originX,
		originY: interval.originY,
		centerAngle: interval.centerAngle,
		minOffset: interval.minOffset,
		maxOffset: interval.maxOffset,
		minAngle: interval.minAngle,
		maxAngle: interval.maxAngle,
		minBoundary: cloneAimBoundary(interval.minBoundary),
		maxBoundary: cloneAimBoundary(interval.maxBoundary),
	};
	enemy.lastVisibleAimInterval = rememberedInterval;
	enemy.lastVisibleAimDistance = rememberedDistance;
	if (rememberedMaximumAimInterval) {
		enemy.lastMaximumAimInterval = rememberedMaximumAimInterval;
	}
	if (rememberedVisibilityProfile) {
		enemy.lastAimVisibilityProfile = rememberedVisibilityProfile;
	}
	enemy.debugVisibleAimInterval = rememberedInterval;
}

export function getIntervalBoundaryTowardAngle(interval, angle) {
	if (!interval || !Number.isFinite(angle)) return null;

	const localAngle = shortestAngleDelta(interval.centerAngle, angle);
	const minBoundary = interval.minBoundary || { angle: interval.minAngle };
	const maxBoundary = interval.maxBoundary || { angle: interval.maxAngle };
	if (localAngle <= interval.minOffset) return minBoundary;
	if (localAngle >= interval.maxOffset) return maxBoundary;

	return localAngle - interval.minOffset <= interval.maxOffset - localAngle
		? minBoundary
		: maxBoundary;
}

export function getRememberedBoundaryAngle(originX, originY, boundary) {
	if (!boundary) return null;

	const source = boundary.source;
	let tangentAngle = Number(boundary.tangentAngle);

	if (source?.kind === "rounded-corner-tangent") {
		const dx = source.x - originX;
		const dy = source.y - originY;
		const distance = Math.hypot(dx, dy);
		const radius = Math.max(0, Number(source.radius) || 0);

		if (distance > radius + WALL_ANGLE_EPSILON) {
			tangentAngle =
				Math.atan2(dy, dx) +
				source.tangentSide * Math.asin(Math.min(1, radius / distance));
		}
	} else if (source?.kind === "point") {
		tangentAngle = Math.atan2(source.y - originY, source.x - originX);
	} else if (boundary.point) {
		tangentAngle = Math.atan2(
			boundary.point.y - originY,
			boundary.point.x - originX,
		);
	}

	if (!Number.isFinite(tangentAngle)) return boundary.angle ?? null;
	const inwardSign = boundary.inwardSign === -1 ? -1 : 1;
	const angularInset = Math.max(
		WALL_ANGLE_EPSILON,
		Number(boundary.angularInset) || 0,
	);

	return tangentAngle + inwardSign * angularInset;
}

function hasWorldSpaceAimCorner(boundary) {
	if (!boundary) return false;

	const source = boundary.source;
	return (
		(source?.kind === "rounded-corner-tangent" &&
			Number.isFinite(source.x) &&
			Number.isFinite(source.y)) ||
		(source?.kind === "point" &&
			Number.isFinite(source.x) &&
			Number.isFinite(source.y)) ||
		(Number.isFinite(boundary.point?.x) &&
			Number.isFinite(boundary.point?.y))
	);
}

export function getEnemyBudgetFallbackAim(
	enemy,
	originX,
	originY,
	preferredAngle,
) {
	let boundary = hasWorldSpaceAimCorner(enemy.lostLosCorner)
		? enemy.lostLosCorner
		: null;

	if (!boundary && enemy.lastVisibleAimInterval) {
		const intervalBoundary = getIntervalBoundaryTowardAngle(
			enemy.lastVisibleAimInterval,
			preferredAngle,
		);
		if (hasWorldSpaceAimCorner(intervalBoundary)) {
			boundary = intervalBoundary;
		}
	}

	if (boundary) {
		const angle = getRememberedBoundaryAngle(
			originX,
			originY,
			boundary,
		);
		if (Number.isFinite(angle)) {
			return {
				angle,
				boundary: cloneAimBoundary(boundary),
			};
		}
	}

	const fallbackX = Number.isFinite(enemy.aimFallbackLastSeenX)
		? enemy.aimFallbackLastSeenX
		: enemy.lastSeenX;
	const fallbackY = Number.isFinite(enemy.aimFallbackLastSeenY)
		? enemy.aimFallbackLastSeenY
		: enemy.lastSeenY;
	if (!Number.isFinite(fallbackX) || !Number.isFinite(fallbackY)) {
		return null;
	}

	return {
		angle: Math.atan2(fallbackY - originY, fallbackX - originX),
		boundary: null,
	};
}

export function getSingleAngleInterval(angle) {
	return {
		centerAngle: angle,
		minOffset: 0,
		maxOffset: 0,
		minAngle: angle,
		maxAngle: angle,
	};
}

export function getWallShotGeometry(enemy, distance) {
	const stats = enemy.typeStats;
	const playerSpeed = getMaximumPlayerMovementSpeed();
	const baseBulletSpeed = Math.max(0, Number(stats.bulletSpeed) || 0);
	const speedVariation = Math.max(
		0,
		Number(stats.bulletSpeedVariation ?? 0) || 0,
	);
	const minimumBulletSpeed = Math.max(0, baseBulletSpeed - speedVariation);
	const baseBulletRadius = Math.max(
		0,
		Number(stats.bulletRadiusBlocks) || 0,
	);
	const radiusVariation = Math.max(
		0,
		Number(stats.bulletRadiusVariation ?? 0) || 0,
	);
	const minimumBulletRadius = Math.max(0, baseBulletRadius - radiusVariation);
	const combinedHitRadius = Math.max(0, Number(player.size) || 0) / 2 +
		minimumBulletRadius;
	const shotIntervalSeconds = Math.max(
		0,
		Number(enemy.shootCooldown) || 0,
	) / 1000;
	const safetyFactor = Math.max(
		0,
		Math.min(
			1,
			Number(stats.wallGapSafetyFactor ?? 0.9) || 0,
		),
	);
	const maxHalfAngle = calculateMaximumLeadHalfAngle(
		playerSpeed,
		minimumBulletSpeed,
	);
	const encounterDistance = calculateMaximumFleeInterceptDistance(
		distance,
		playerSpeed,
		minimumBulletSpeed,
	);
	const safeStep = calculateGapSafeWallAngle(
		distance,
		playerSpeed,
		minimumBulletSpeed,
		shotIntervalSeconds,
		combinedHitRadius,
		safetyFactor,
	);
	const spread = Math.max(0, Number(stats.spread ?? 0) || 0);
	const bulletCount = Math.max(
		1,
		Math.floor(Number(stats.bulletCount ?? 1) || 1),
	);

	return {
		canStart:
			minimumBulletSpeed > playerSpeed + WALL_ANGLE_EPSILON &&
			maxHalfAngle > WALL_ANGLE_EPSILON &&
			safeStep > WALL_ANGLE_EPSILON &&
			spread <= WALL_ANGLE_EPSILON &&
			bulletCount === 1,
		maxHalfAngle,
		safeStep,
		encounterDistance,
	};
}

export function scheduleEnemyAimCalculations() {
	const playerCenterX = player.x + player.size / 2;
	const playerCenterY = player.y + player.size / 2;
	const losByEnemy = new Map();
	const hasTargetByEnemy = new Map();
	const scanResultByEnemy = new Map();
	const priorityJobs = [];
	const normalJobs = [];
	const maximumPlayerSpeed = getMaximumPlayerMovementSpeed();

	for (let index = 0; index < GameState.enemies.length; index++) {
		const enemy = GameState.enemies[index];
		if (enemy.hp <= 0) continue;

		const originX = enemy.x + enemy.size / 2;
		const originY = enemy.y + enemy.size / 2;
		const playerDistance = Math.hypot(
			playerCenterX - originX,
			playerCenterY - originY,
		);
		const los = hasLineOfSight(
			originX,
			originY,
			playerCenterX,
			playerCenterY,
		);
		const hasRememberedTarget = enemy.hasAimTarget === true ||
			(Number.isFinite(enemy.lastSeenX) &&
				Number.isFinite(enemy.lastSeenY));
		const hasTarget = hasRememberedTarget || los;
		losByEnemy.set(enemy, los);
		hasTargetByEnemy.set(enemy, hasTarget);

		// Idle enemies have no target and perform no aiming work at all.
		if (!hasTarget) continue;

		const gainedLos = los && enemy.lastAimLos !== true;
		if (gainedLos) {
			// Capture this before any budgeted work. If the first visibility scan
			// cannot run this frame, the enemy can still fire at the exact player
			// world position observed when LOS was gained.
			enemy.aimFallbackLastSeenX = playerCenterX;
			enemy.aimFallbackLastSeenY = playerCenterY;
		}
		prepareEnemyAimCornerCache(enemy, gainedLos);
		updateAimWallCornerAngles(
			enemy.aimWallCornerCache,
			originX,
			originY,
		);

		const baseBulletSpeed = Math.max(
			0,
			Number(enemy.typeStats.bulletSpeed) || 0,
		);
		const directAngle = Math.atan2(
			playerCenterY - originY,
			playerCenterX - originX,
		);
		const leadHalfAngle = calculateMaximumLeadHalfAngle(
			maximumPlayerSpeed,
			baseBulletSpeed,
		);
		const leadDistance = calculateMaximumFleeInterceptDistance(
			playerDistance,
			maximumPlayerSpeed,
			baseBulletSpeed,
		);
		const wallGeometry = getWallShotGeometry(enemy, playerDistance);
		const scanningWallCone = enemy.aimMode === "wall" ||
			wallGeometry.canStart;

		const job = {
			enemy,
			originalIndex: index,
			playerDistance,
			originX,
			originY,
			directAngle,
			halfAngle: enemy.aimMode === "wall"
				? enemy.wallMaxHalfAngle
				: scanningWallCone
					? wallGeometry.maxHalfAngle
					: leadHalfAngle,
			maxDistance: scanningWallCone
				? wallGeometry.encounterDistance
				: leadDistance,
		};
		(gainedLos ? priorityJobs : normalJobs).push(job);
	}

	const sortNearestFirst = (first, second) =>
		first.playerDistance - second.playerDistance ||
		first.originalIndex - second.originalIndex;
	priorityJobs.sort(sortNearestFirst);
	normalJobs.sort(sortNearestFirst);
	if (priorityJobs.length === 0 && normalJobs.length === 0) {
		enemyAimSchedulerNextEnemy = null;
		return { losByEnemy, hasTargetByEnemy, scanResultByEnemy };
	}

	const runJob = (job) => {
		if (enemyAimCalculationBudgetRemaining <= 0) return null;
		const result = advanceEnemyAimWallScan(
			job.enemy,
			job.originX,
			job.originY,
			job.directAngle,
			job.halfAngle,
			job.maxDistance,
			enemyAimCalculationBudgetRemaining,
		);
		scanResultByEnemy.set(job.enemy, result);
		return result;
	};

	// A newly acquired target is always serviced first, nearest enemy first.
	// Every job receives the entire remaining budget so it either completes or
	// remains the sole partial scan carried into a later frame.
	for (const job of priorityJobs) {
		const result = runJob(job);
		if (!result) {
			enemyAimSchedulerNextEnemy = job.enemy;
			return { losByEnemy, hasTargetByEnemy, scanResultByEnemy };
		}
		if (result.truncated) {
			enemyAimSchedulerNextEnemy = job.enemy;
			return { losByEnemy, hasTargetByEnemy, scanResultByEnemy };
		}
	}

	if (normalJobs.length === 0) {
		enemyAimSchedulerNextEnemy = null;
		return { losByEnemy, hasTargetByEnemy, scanResultByEnemy };
	}

	const resumeIndex = normalJobs.findIndex(
		(job) => job.enemy === enemyAimSchedulerNextEnemy,
	);
	const startIndex = resumeIndex >= 0 ? resumeIndex : 0;
	const orderedJobs = [
		...normalJobs.slice(startIndex),
		...normalJobs.slice(0, startIndex),
	];

	for (let index = 0; index < orderedJobs.length; index++) {
		const job = orderedJobs[index];
		enemyAimSchedulerNextEnemy = job.enemy;
		const result = runJob(job);
		if (!result || result.truncated) break;

		// Move only after this enemy's complete wall set has been published.
		enemyAimSchedulerNextEnemy =
			orderedJobs[(index + 1) % orderedJobs.length].enemy;
	}

	return { losByEnemy, hasTargetByEnemy, scanResultByEnemy };
}

// Spawns eligible enemies, evaluates line of sight, handles enemy shooting, and calculates AI velocity toward the player or last seen position
