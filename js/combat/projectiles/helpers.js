import { GameState } from "../../state.js";

export function getProjectileDirectionAngle(projectile) {
	return projectile.throwable
		? Math.atan2(projectile.throwDirY, projectile.throwDirX)
		: Math.atan2(projectile.vy, projectile.vx);
}

// Trails are sampled once per render frame, but projectile wall impacts and
// removals can happen between those samples. Keep a tiny transient path for
// any projectile that bounces or dies during this simulation update so the
// renderer can preserve the exact impact/reversal/terminal point.
export function pushProjectileTrailEvent(
	projectile,
	x = projectile.x,
	y = projectile.y,
	{ checkpoint = false } = {},
) {
	GameState.projectileTrailEvents.push({
		projectile,
		x,
		y,
		radius: projectile.radius,
		color: projectile.color,
		...(checkpoint ? { checkpoint: true } : {}),
	});
}

export function projectileRect(bullet) {
	return {
		x: bullet.x - bullet.radius,
		y: bullet.y - bullet.radius,
		size: bullet.radius * 2,
	};
}

