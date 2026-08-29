// Enemy movement intent derived from current or remembered player position.

export function updateAggressiveEnemyMovement(
	e,
	los,
	pCenterX,
	pCenterY,
	eCenterX,
	eCenterY,
	dt,
) {
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
}
