// Returns a directionally inset collider that delays a collision by the
// requested penetration depth. Penetration is measured from the entry face
// along the active collision axis. If penetration is at least the collider's
// thickness on that axis, the collider is phased through completely.
export function getPenetratedCollisionRect(
	rect,
	penetrationBlocks = 0,
	axis = "x",
	direction = 1,
) {
	const width = rect.width ?? rect.size ?? 0;
	const height = rect.height ?? rect.size ?? 0;
	const penetration = Math.max(0, Number(penetrationBlocks) || 0);

	let x = rect.x;
	let y = rect.y;
	let adjustedWidth = width;
	let adjustedHeight = height;

	if (axis === "x") {
		if (adjustedWidth <= 0 || penetration >= adjustedWidth) return null;

		if (direction >= 0) {
			x += penetration;
		}
		adjustedWidth -= penetration;
	} else {
		if (adjustedHeight <= 0 || penetration >= adjustedHeight) return null;

		if (direction >= 0) {
			y += penetration;
		}
		adjustedHeight -= penetration;
	}

	return {
		x,
		y,
		width: adjustedWidth,
		height: adjustedHeight,
	};
}

// Maximum projectile travel per collision substep; limiting this prevents fast
// bullets from tunneling through targets. Wall collision itself is now swept

export function consumeProjectilePenetrationStep(bullet, travelDistanceBlocks, isBouncy) {
	const remaining = Math.max(
		0,
		Number(
			bullet.remainingPenetrationBlocks ??
				bullet.penetrationBlocks ??
				0,
		) || 0,
	);

	bullet.remainingPenetrationBlocks = Math.max(
		0,
		remaining - travelDistanceBlocks,
	);

	if (bullet.remainingPenetrationBlocks <= 0 && isBouncy) {
		bullet.finishPenetratedWall = true;
	}
}
