// Explosion creation, lifetime, and damage handling.

import { GameState, player, TEAM_PLAYER } from "../state.js";
import { circleIntersectsRect } from "./collision.js";

// Creates a circular explosion at the projectile's current position. A radius
// of 0 means the projectile is non-explosive and no explosion object is made.
export function detonateBullet(bullet, currentTime) {
	const radius = bullet.explosionRadiusBlocks ?? 0;

	if (radius <= 0) return false;

	GameState.explosions.push({
		x: bullet.x,
		y: bullet.y,
		radius,
		damage: bullet.explosionDamage ?? 0,
		color: bullet.color ?? "orange",
		createdAt: currentTime,
		durationMs: bullet.explosionDurationMs ?? 0,
		ownerId: bullet.ownerId,
		team: bullet.team,
		hitTargets: new Set(),
	});

	return true;
}

// Applies circular explosion damage for the explosion's lifetime. Each target
// can only take damage once from a given explosion, even if it remains inside
// the circle or leaves and re-enters before the duration expires.
export function processExplosions(currentTime) {
	for (let i = GameState.explosions.length - 1; i >= 0; i--) {
		const explosion = GameState.explosions[i];
		const isPlayerExplosion = explosion.team === TEAM_PLAYER;
		const targets = isPlayerExplosion
			? GameState.enemies
			: [player];

		for (const target of targets) {
			if (target.hp <= 0 || explosion.hitTargets.has(target)) continue;

			if (
				circleIntersectsRect(
					explosion.x,
					explosion.y,
					explosion.radius,
					target,
				)
			) {
				if (isPlayerExplosion || !GameState.isInvincible) {
					target.hp -= explosion.damage;
				}

				explosion.hitTargets.add(target);
			}
		}

		if (currentTime - explosion.createdAt >= explosion.durationMs) {
			GameState.explosions.splice(i, 1);
		}
	}
}
