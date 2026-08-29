// Converts eligible procedural spawn points into live enemy runtime objects.

import { Config } from "../../config.js";
import { GameState, player, allocateEntityId, TEAM_ENEMY } from "../../state.js";
import { seededRandom } from "../../utils.js";
import { normalizeVariationLuckUpgrade } from "../weapon-utils.js";
import { createEnemyRuntimeStats } from "./definitions.js";

export function processEnemySpawning(currentTime) {
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
					dist >= GameState.minimumEnemySpawnDistanceBlocks &&
					dist <= GameState.maximumEnemySpawnDistanceBlocks
				);
			});

			if (validSpawns.length > 0) {
				const spawnPoint =
					validSpawns[
						Math.floor(seededRandom() * validSpawns.length)
					];

				const typeName = spawnPoint.type || "g-bot";
				const configuredStats =
					Config.ENEMY_TYPES[typeName] || Config.ENEMY_TYPES["g-bot"];
				const stats = createEnemyRuntimeStats(typeName, configuredStats);

				GameState.enemies.push({
					id: allocateEntityId(),
					team: TEAM_ENEMY,
					upgrades: {
						variationLuck: normalizeVariationLuckUpgrade(
							stats.upgrades?.variationLuck,
						),
					},
					x: spawnPoint.x,
					y: spawnPoint.y,
					size: stats.sizeBlocks,
					speed: stats.speed,
					hp: stats.hp,
					maxHp: stats.hp,
					color: stats.color,
					lastShot: 0,
					shootCooldown: stats.weapon.cooldownMs,
					maximumProjectileCount: stats.maximumProjectileCount,
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
}
