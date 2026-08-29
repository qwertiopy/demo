// Pending laser warmups and short-lived rendered beam lifecycle.

import { GameState, player } from "../../state.js";
import { resolveLaserShot } from "./resolution.js";

// Advances pending laser warmups and short-lived rendered beam flashes.
export function processLasers(currentTime) {
	for (let i = GameState.laserWarmups.length - 1; i >= 0; i--) {
		const shot = GameState.laserWarmups[i];
		if (
			shot.ownerId !== player.id &&
			!GameState.enemies.some(
				(enemy) => enemy.id === shot.ownerId && enemy.hp > 0,
			)
		) {
			GameState.laserWarmups.splice(i, 1);
			continue;
		}

		if (currentTime < shot.fireAt) continue;

		resolveLaserShot(shot, currentTime);
		if (!shot.ignoreCooldown) {
			GameState.weaponCooldownUntilByWeapon[shot.weaponIndex] =
				shot.fireAt + Math.max(0, Number(shot.stats.cooldownMs) || 0);
		}
		GameState.laserWarmups.splice(i, 1);
	}

	GameState.laserBeams = GameState.laserBeams.filter(
		(beam) => currentTime - beam.createdAt < beam.durationMs,
	);
}
