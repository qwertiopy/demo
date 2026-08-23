// Enemy spawning, shooting, AI movement, and enemy/enemy separation.

import { Config } from "../config.js";
import { GameState, player } from "../state.js";
import { handleWallCollisions, seededRandom } from "../utils.js";
import { hasLineOfSight } from "./collision.js";
import { shoot } from "./projectiles.js";
import {
	calculateGapSafeWallAngle,
	calculateInterceptAim,
	calculateMaximumFleeInterceptDistance,
	calculateMaximumLeadHalfAngle,
} from "./targeting.js";
import {
	clampAngleToInterval,
	getAimConeWallScanCandidates,
	getAimVisibilityProfile,
	getAimWallCornerRecord,
	getVisibleAimInterval,
	updateAimWallCornerAngles,
} from "./visibility.js";
import { shortestAngleDelta } from "./weapon-utils.js";

const WALL_ANGLE_EPSILON = 1e-9;
const DEFAULT_ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME = 100000;
let enemyAimCalculationBudgetRemaining =
	DEFAULT_ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME;
let enemyAimSchedulerNextEnemy = null;

function resetEnemyAimCalculationBudget() {
	enemyAimCalculationBudgetRemaining = Math.max(
		1,
		Math.floor(
			Number(
				Config.RENDERING?.ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME ??
					DEFAULT_ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME,
			) || DEFAULT_ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME,
		),
	);
}

function consumeEnemyAimCalculationBudget() {
	if (enemyAimCalculationBudgetRemaining <= 0) return false;
	enemyAimCalculationBudgetRemaining--;
	return true;
}

function getMaximumPlayerMovementSpeed() {
	// Movement is applied independently on each axis, so holding one horizontal
	// and one vertical direction produces the true maximum speed: speed * sqrt(2).
	return Math.max(0, Number(player.speed) || 0) * Math.SQRT2;
}

function resetWallAttack(enemy, resetLeadHistory = false) {
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

function recordEnemyShot(enemy, playerCenterX, playerCenterY, currentTime) {
	// Every actual shot, including a wall shot, begins the next averaged-velocity
	// window. This keeps the next lead prediction tied to the most recent shot.
	enemy.playerXAtLastShot = playerCenterX;
	enemy.playerYAtLastShot = playerCenterY;
	enemy.lastShot = currentTime;
}

function fireEnemyProjectile(
	enemy,
	enemyCenterX,
	enemyCenterY,
	playerCenterX,
	playerCenterY,
	currentTime,
	firingAngle,
	spread,
	aimAngleBounds = null,
) {
	const stats = enemy.typeStats;
	const baseBulletSpeed = Math.max(0, Number(stats.bulletSpeed) || 0);

	shoot(
		enemy,
		enemyCenterX + Math.cos(firingAngle),
		enemyCenterY + Math.sin(firingAngle),
		GameState.enemyBullets,
		{
			color: stats.bulletColor,
			speed: baseBulletSpeed,
			speedVariation: stats.bulletSpeedVariation ?? 0,
			radiusBlocks: stats.bulletRadiusBlocks,
			radiusVariation: stats.bulletRadiusVariation ?? 0,
			damage: stats.bulletDamage,
			damageVariation: stats.bulletDamageVariation ?? 0,
			maxBounces: 0,
			spread,
			bulletCount: stats.bulletCount ?? 1,
			explosionRadiusBlocks: stats.bulletExplosionRadiusBlocks ?? 0,
			detonationTimeMs: stats.bulletDetonationTimeMs ?? 0,
			explosionDurationMs: stats.bulletExplosionDurationMs ?? 0,
			explosionDamage: stats.bulletExplosionDamage ?? 0,
			detonatesOnImpact: stats.bulletDetonatesOnImpact ?? false,
			penetrationBlocks: stats.bulletPenetrationBlocks ?? 0,
			bulletCollision: stats.bulletCollision === true,
			aimAngleBounds,
		},
	);

	recordEnemyShot(
		enemy,
		playerCenterX,
		playerCenterY,
		currentTime,
	);
}

function getVariedLeadFiringAngle(
	enemy,
	predictedAngle,
	directAngle,
	baseBulletSpeed,
	spread,
	aimAngleBounds,
) {
	const predictionVariationThreshold = Math.max(
		0,
		Number(enemy.typeStats.predictionVariationThreshold ?? 0.1) || 0,
	);
	const predictionVariation = Math.max(
		0,
		Number(enemy.typeStats.predictionVariation ?? 0.04) || 0,
	);
	let firingAngle = predictedAngle;

	// Preserve the existing prediction-variation gate for ordinary lead shots.
	// Wall shots bypass this helper because random offsets would create gaps.
	if (
		spread <= predictionVariationThreshold &&
		Number.isFinite(enemy.lastPredictedShotAngle) &&
		Math.abs(
			shortestAngleDelta(
				enemy.lastPredictedShotAngle,
				predictedAngle,
			),
		) <= predictionVariationThreshold &&
		predictionVariation > 0
	) {
		firingAngle += (Math.random() - 0.5) * predictionVariation;
	}

	// Store the raw prediction so variation never feeds back into the comparison.
	enemy.lastPredictedShotAngle = predictedAngle;

	// Apply variation first, then keep the result inside the physically possible
	// lead cone around the current direct line-of-sight angle.
	const maxLeadHalfAngle = calculateMaximumLeadHalfAngle(
		getMaximumPlayerMovementSpeed(),
		baseBulletSpeed,
	);
	const variedOffset = shortestAngleDelta(directAngle, firingAngle);
	const clampedOffset = Math.max(
		-maxLeadHalfAngle,
		Math.min(maxLeadHalfAngle, variedOffset),
	);

	return clampAngleToInterval(
		directAngle + clampedOffset,
		aimAngleBounds,
	);
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

function getEnemyVisibleAimInterval(
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

function getEnemyAimVisibilityProfile(
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

function getEnemyPlayerContactDistance(enemy, playerCenterDistance) {
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

function getMaximumAimInterval(
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

function rememberVisibleAimInterval(
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

function getIntervalBoundaryTowardAngle(interval, angle) {
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

function getRememberedBoundaryAngle(originX, originY, boundary) {
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

function getEnemyBudgetFallbackAim(
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

function getSingleAngleInterval(angle) {
	return {
		centerAngle: angle,
		minOffset: 0,
		maxOffset: 0,
		minAngle: angle,
		maxAngle: angle,
	};
}

function getWallShotGeometry(enemy, distance) {
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

function scheduleEnemyAimCalculations() {
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
// update this for enemy logic changes
export function updateEnemies(currentTime, dt) {
	resetEnemyAimCalculationBudget();

	//spawn enemies
	if (GameState.enemySpawnRate > 0 && GameState.enemySpawns.length > 0) {
		// enemyspawnrate = enemy spawns per second
		const spawnIntervalMs = 1000 / GameState.enemySpawnRate;

		if (currentTime - GameState.lastSpawnTime > spawnIntervalMs) {
			// player center
			// player position is stored in the bottom left corner???
			// might be worth changing in the player object instead of recomputing every frame hundreds of times
			const pCenterX = player.x + player.size / 2;
			const pCenterY = player.y + player.size / 2;

			// list of valid spawns based on distance of spawn to player
			const validSpawns = GameState.enemySpawns.filter((spawn) => {
				const dist = Math.hypot(spawn.x - pCenterX, spawn.y - pCenterY);

				return (
					dist >= Config.MIN_SPAWN_DISTANCE_BLOCKS &&
					dist <= Config.MAX_SPAWN_DISTANCE_BLOCKS
				);
			});

			if (validSpawns.length > 0) {
				const spawnPoint =
					validSpawns[
						Math.floor(seededRandom() * validSpawns.length)
					];

				const typeName = spawnPoint.type || "g-bot";
				const stats =
					Config.ENEMY_TYPES[typeName] || Config.ENEMY_TYPES["g-bot"];

				GameState.enemies.push({
					x: spawnPoint.x,
					y: spawnPoint.y,
					size: stats.sizeBlocks,
					speed: stats.speed,
					hp: stats.hp,
					maxHp: stats.hp,
					color: stats.color,
					lastShot: 0,
					shootCooldown: stats.shootCooldown,
					typeStats: stats,
					ai: stats.ai,
					lastSeenX: null,
					lastSeenY: null,
					aimFallbackLastSeenX: null,
					aimFallbackLastSeenY: null,
					vx: 0,
					vy: 0,
					moveX: 0,
					moveY: 0,
					lastPredictedShotAngle: null,
					playerXAtLastShot: null,
					playerYAtLastShot: null,
					lastLeadPlayerVx: null,
					lastLeadPlayerVy: null,
					currentPredictedShotAngle: null,
					aimMode: "lead",
					wallStartSide: 0,
					wallSweepDirection: 0,
					wallFrontierAngle: null,
					wallMaxHalfAngle: 0,
					wallLastSafeStep: 0,
					wallDeadline: 0,
					nextWallStartSide: 1,
					lastVisibleAimInterval: null,
					lastVisibleAimDistance: 0,
					lastMaximumAimInterval: null,
					lastAimVisibilityProfile: null,
					hasAimTarget: false,
					aimWallCornerCache: new Map(),
					aimWallCornerCacheRevision:
						Number(GameState.environmentRevision) || 0,
					aimWallVisibilityScan: null,
					lastAimLos: null,
					debugAimWallScanTruncated: false,
					lostLosCorner: null,
					lostLosCornerAngle: null,
					debugVisibleAimInterval: null,
					debugMaximumAimInterval: null,
					debugAimVisibilityProfile: null,
					debugAimDistance: 0,
					debugAimOriginX: null,
					debugAimOriginY: null,
					debugUsingCachedCorner: false,
				});
			}

			GameState.lastSpawnTime = currentTime;
		}
	}
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

		// only aggressive enemies chase the player??
		if (e.ai === "aggressive") {
			let targetX = los ? pCenterX : e.lastSeenX;
			let targetY = los ? pCenterY : e.lastSeenY;

			if (!los && targetX !== null) {
				if (
					Math.hypot(targetX - eCenterX, targetY - eCenterY) <
					e.speed * dt
				) {
					e.lastSeenX = null;
					e.lastSeenY = null;
					e.hasAimTarget = false;
					e.aimWallVisibilityScan = null;
					e.debugVisibleAimInterval = null;
					e.debugMaximumAimInterval = null;
					e.debugAimVisibilityProfile = null;
					e.debugAimWallScanTruncated = false;
					e.debugUsingCachedCorner = false;
					targetX = null;
				}
			}

			if (targetX !== null && targetY !== null) {
				const angle = Math.atan2(
					targetY - eCenterY,
					targetX - eCenterX,
				);

				e.vx = Math.cos(angle) * e.speed;
				e.vy = Math.sin(angle) * e.speed;
			}
		}

		return true;
	});
}

// Converts enemy velocity into this-frame displacement and applies pairwise separation when enemies overlap
// not touching this either - cyn
export function resolveEnemyVectorCollisions(dt) {
	GameState.enemies.forEach((e) => {
		e.moveX = e.vx * dt;
		e.moveY = e.vy * dt;
	});

	for (let i = 0; i < GameState.enemies.length; i++) {
		for (let j = i + 1; j < GameState.enemies.length; j++) {
			const e1 = GameState.enemies[i];
			const e2 = GameState.enemies[j];

			if (e1.hp <= 0 || e2.hp <= 0) continue;

			const r1 = e1.size / 2;
			const r2 = e2.size / 2;

			const dx = e2.x + r2 + e2.moveX - (e1.x + r1 + e1.moveX);
			const dy = e2.y + r2 + e2.moveY - (e1.y + r1 + e1.moveY);

			const distance = Math.hypot(dx, dy);
			const minDist = r1 + r2;

			if (distance < minDist) {
				// Exact overlap has no geometric separation normal. Pick one angle
				// once so nx/ny still form a unit vector instead of sampling two
				// unrelated random directions.
				const overlapAngle = distance === 0
					? Math.random() * Math.PI * 2
					: 0;
				const nx = distance === 0
					? Math.cos(overlapAngle)
					: dx / distance;
				const ny = distance === 0
					? Math.sin(overlapAngle)
					: dy / distance;

				const overlap = minDist - (distance === 0 ? 0.001 : distance);

				const weight1 = e2.size / (e1.size + e2.size);
				const weight2 = e1.size / (e1.size + e2.size);

				e1.moveX -= nx * overlap * weight1 * 0.5;
				e1.moveY -= ny * overlap * weight1 * 0.5;
				e2.moveX += nx * overlap * weight2 * 0.5;
				e2.moveY += ny * overlap * weight2 * 0.5;
			}
		}
	}

	// Apply the displacement calculated for this tick only after enemy/enemy
	// separation has adjusted it. Previously updateEnemies() moved with the
	// previous tick's moveX/moveY and this freshly resolved vector waited until
	// the next frame.
	GameState.enemies.forEach((e) => {
		handleWallCollisions(e, e.moveX, e.moveY);
	});
}
