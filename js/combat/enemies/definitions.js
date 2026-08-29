// Enemy configuration resolution and cached runtime stats.

import { Config } from "../../config.js";
import { clampProjectileCount } from "../projectile-cap.js";
import { resolveProjectileDefinition } from "../projectile-schema.js";

const enemyRuntimeStatsByType = new Map();

export function createEnemyRuntimeStats(typeName, configuredStats) {
	const cached = enemyRuntimeStatsByType.get(typeName);
	if (cached?.configuredStats === configuredStats) return cached.runtimeStats;
	const weaponOverride = configuredStats.weapons?.[0];
	if (!weaponOverride) {
		throw new Error(`ENEMY_TYPES.${typeName}.weapons[0] is required.`);
	}
	const weapon = resolveProjectileDefinition(Config.BASE_PROJECTILE, weaponOverride);
	const runtimeStats = {
		...configuredStats,
		weaponDefinition: weaponOverride,
		weapon,
		bulletSpeed: weapon.speed,
		bulletSpeedVariation: weapon.speedVariation,
		bulletRadiusBlocks: weapon.radiusBlocks,
		bulletRadiusVariation: weapon.radiusVariation,
		bulletDamage: weapon.damage,
		bulletDamageVariation: weapon.damageVariation,
		bulletCount: weapon.bulletCount,
		spread: weapon.spread,
	};
	runtimeStats.maximumProjectileCount = clampProjectileCount(
		configuredStats.maximumProjectileCount,
		`ENEMY_TYPES.${typeName}.maximumProjectileCount`,
	);
	enemyRuntimeStatsByType.set(typeName, { configuredStats, runtimeStats });
	return runtimeStats;
}
