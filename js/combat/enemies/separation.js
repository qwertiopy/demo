// Enemy/enemy overlap separation and this-frame wall-resolved displacement.

import { GameState } from "../../state.js";
import { handleWallCollisions } from "../../utils.js";

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
