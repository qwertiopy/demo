// Explosion creation, lifetime, and damage handling.

import { GameState } from "../state.js";
import { circleIntersectsRenderedShape } from "./collision.js";
import { isDamageableTarget } from "./team-relations.js";
import { applyCombatDamage } from "./damage.js";
import { queryActorsInAabb } from "../spatial/entity-index.js";

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
		const targets = queryActorsInAabb(
			explosion.x - explosion.radius,
			explosion.y - explosion.radius,
			explosion.x + explosion.radius,
			explosion.y + explosion.radius,
		).filter(
			(target) => isDamageableTarget(explosion.team, target),
		);

		for (const target of targets) {
			if (!isDamageableTarget(explosion.team, target) || explosion.hitTargets.has(target)) continue;

			if (
				circleIntersectsRenderedShape(
					explosion.x,
					explosion.y,
					explosion.radius,
					target,
				)
			) {
				applyCombatDamage(explosion.team, target, explosion.damage);

				explosion.hitTargets.add(target);
			}
		}

		if (currentTime - explosion.createdAt >= explosion.durationMs) {
			GameState.explosions.splice(i, 1);
		}
	}
}
