import { GameState } from "../../state.js";

// Resolves circular projectile/projectile overlaps for any pair where at least
// one projectile opts in with bulletCollision=true. An opted-in projectile
// therefore collides with every player/enemy projectile, even when both are
// moving. dv is used only to keep a truly stationary projectile fixed when it
// is hit by a moving one; otherwise the overlap is split by projectile radius.
export function resolveProjectileVectorCollisions() {
	const allProjectiles = GameState.projectiles.filter(
		(projectile) => !projectile.removedByProjectileCap,
	);
	const stationaryEpsilon = 1e-12;

	for (let i = 0; i < allProjectiles.length; i++) {
		for (let j = i + 1; j < allProjectiles.length; j++) {
			const a = allProjectiles[i];
			const b = allProjectiles[j];

			if (a.bulletCollision !== true && b.bulletCollision !== true) {
				continue;
			}

			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const distance = Math.hypot(dx, dy);
			const minDistance = (a.radius ?? 0) + (b.radius ?? 0);

			if (distance >= minDistance) continue;

			const angle = distance === 0 ? Math.random() * Math.PI * 2 : 0;
			const nx = distance === 0 ? Math.cos(angle) : dx / distance;
			const ny = distance === 0 ? Math.sin(angle) : dy / distance;
			const overlap = minDistance - (distance === 0 ? 0.001 : distance);
			const aStationary = (Number(a.dv) || 0) <= stationaryEpsilon;
			const bStationary = (Number(b.dv) || 0) <= stationaryEpsilon;

			if (aStationary && !bStationary) {
				b.x += nx * overlap;
				b.y += ny * overlap;
			} else if (!aStationary && bStationary) {
				a.x -= nx * overlap;
				a.y -= ny * overlap;
			} else {
				const totalRadius = Math.max(
					1e-9,
					(a.radius ?? 0) + (b.radius ?? 0),
				);
				const weightA = (b.radius ?? 0) / totalRadius;
				const weightB = (a.radius ?? 0) / totalRadius;

				a.x -= nx * overlap * weightA;
				a.y -= ny * overlap * weightA;
				b.x += nx * overlap * weightB;
				b.y += ny * overlap * weightB;
			}
		}
	}
}
