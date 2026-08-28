// Runtime performance/debug HUD updates.

import { Config } from "../config.js";
import { GameState, player } from "../state.js";
import {
	performanceFps,
	performanceTargetFps,
	performanceMsPerTick,
	performanceEntityCount,
	performanceEnemyCount,
	performanceBulletCount,
} from "../dom.js";

const PERFORMANCE_UPDATE_INTERVAL_MS = 500;

const PerformanceStats = {
	windowStartedAt: null,
	tickDurationTotalMs: 0,
	tickDurationSamples: 0,
};

function setDebugStatVisibility(element, visible) {
	if (element) element.hidden = !visible;
}

export function updatePerformanceUi(currentTime, tickDurationMs, targetFps) {
	const debug = Config.DEBUG || {};
	const showFps = debug.SHOW_FPS !== false;
	const showTargetFps = debug.SHOW_TARGET_FPS !== false;
	const showMsPerTick = debug.SHOW_MS_PER_TICK !== false;
	const showEntityCount = debug.SHOW_ENTITY_COUNT !== false;
	const showEnemyCount = debug.SHOW_ENEMY_COUNT !== false;
	const showBulletCount = debug.SHOW_BULLET_COUNT !== false;

	setDebugStatVisibility(performanceFps, showFps);
	setDebugStatVisibility(performanceTargetFps, showTargetFps);
	setDebugStatVisibility(performanceMsPerTick, showMsPerTick);
	setDebugStatVisibility(performanceEntityCount, showEntityCount);
	setDebugStatVisibility(performanceEnemyCount, showEnemyCount);
	setDebugStatVisibility(performanceBulletCount, showBulletCount);

	if (PerformanceStats.windowStartedAt === null) {
		PerformanceStats.windowStartedAt = currentTime;
	}

	if (
		(showFps || showMsPerTick) &&
		Number.isFinite(tickDurationMs) &&
		tickDurationMs > 0
	) {
		PerformanceStats.tickDurationTotalMs += tickDurationMs;
		PerformanceStats.tickDurationSamples += 1;
	}

	if (showTargetFps && performanceTargetFps) {
		performanceTargetFps.textContent = `Target FPS: ${targetFps}`;
	}

	if (showEntityCount || showEnemyCount || showBulletCount) {
		const enemyCount = GameState.enemies.length;
		let playerBulletCount = 0;
		let enemyBulletCount = 0;
		for (const projectile of GameState.projectiles) {
			if (projectile.team === player.team) playerBulletCount++;
			else enemyBulletCount++;
		}
		const bulletCount = GameState.projectiles.length;

		if (showEntityCount && performanceEntityCount) {
			performanceEntityCount.textContent =
				`Entities: ${enemyCount + bulletCount}`;
		}
		if (showEnemyCount && performanceEnemyCount) {
			performanceEnemyCount.textContent = `Enemies: ${enemyCount}`;
		}
		if (showBulletCount && performanceBulletCount) {
			performanceBulletCount.textContent =
				`Bullets: ${bulletCount} (Player: ${playerBulletCount} / Enemy: ${enemyBulletCount})`;
		}
	}

	if (!showFps && !showMsPerTick) {
		PerformanceStats.windowStartedAt = currentTime;
		PerformanceStats.tickDurationTotalMs = 0;
		PerformanceStats.tickDurationSamples = 0;
		return;
	}

	const windowMs = currentTime - PerformanceStats.windowStartedAt;
	if (windowMs < PERFORMANCE_UPDATE_INTERVAL_MS) return;

	const measuredMsPerTick =
		PerformanceStats.tickDurationSamples > 0
			? PerformanceStats.tickDurationTotalMs /
				PerformanceStats.tickDurationSamples
			: 0;
	const measuredFps =
		measuredMsPerTick > 0 ? 1000 / measuredMsPerTick : 0;

	if (showFps && performanceFps) {
		performanceFps.textContent = `FPS: ${measuredFps.toFixed(1)}`;
	}
	if (showMsPerTick && performanceMsPerTick) {
		performanceMsPerTick.textContent = `ms/tick: ${measuredMsPerTick.toFixed(2)}`;
	}

	PerformanceStats.windowStartedAt = currentTime;
	PerformanceStats.tickDurationTotalMs = 0;
	PerformanceStats.tickDurationSamples = 0;
}
