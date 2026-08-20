// Shared weapon-angle and throwable-kinematics helpers.

// Throwable projectiles use constant physical deceleration in blocks/sec².
// Throw distance is chosen from the shooter-to-aim distance; initial speed and
// flight duration are derived so the projectile reaches that path distance at
// exactly zero speed:
//
//   D  = configured throw distance
//   a  = throwDeceleration
//   v0 = sqrt(2aD)
//   T  = v0 / a = sqrt(2D/a)
//   s(t) = v0*t - 0.5*a*t²
//
// Position is evaluated from this closed-form equation. Velocity is never
// integrated frame by frame.
export const MIN_THROW_DECELERATION = 0.001;

export function getThrowableKinematics(distanceBlocks, decelerationBlocksPerSecondSq) {
	const distance = Math.max(0, Number(distanceBlocks) || 0);
	const deceleration = Math.max(
		MIN_THROW_DECELERATION,
		Number(decelerationBlocksPerSecondSq ?? 20) || 0,
	);

	if (distance === 0) {
		return {
			distanceBlocks: 0,
			deceleration,
			initialSpeed: 0,
			durationSeconds: 0,
			durationMs: 0,
		};
	}

	const initialSpeed = Math.sqrt(2 * deceleration * distance);
	const durationSeconds = initialSpeed / deceleration;

	return {
		distanceBlocks: distance,
		deceleration,
		initialSpeed,
		durationSeconds,
		durationMs: durationSeconds * 1000,
	};
}

export function getThrowableTravelDistance(
	distanceBlocks,
	elapsedMs,
	decelerationBlocksPerSecondSq,
	precomputedInitialSpeed = null,
	precomputedDurationMs = null,
) {
	const distance = Math.max(0, Number(distanceBlocks) || 0);
	const deceleration = Math.max(
		MIN_THROW_DECELERATION,
		Number(decelerationBlocksPerSecondSq ?? 20) || 0,
	);

	if (distance === 0) return 0;

	// Throwable launch kinematics are normally calculated once in shoot() and
	// reused for every frame and every boomerang leg. The fallback calculations
	// keep compatibility with any older projectile object missing those fields.
	const initialSpeed = Number.isFinite(precomputedInitialSpeed)
		? Math.max(0, precomputedInitialSpeed)
		: Math.sqrt(2 * deceleration * distance);
	const durationSeconds = Number.isFinite(precomputedDurationMs)
		? Math.max(0, precomputedDurationMs) / 1000
		: initialSpeed / deceleration;
	const rawElapsedSeconds = Math.max((Number(elapsedMs) || 0) / 1000, 0);

	if (rawElapsedSeconds >= durationSeconds) {
		return distance;
	}

	const travelled =
		initialSpeed * rawElapsedSeconds -
		0.5 * deceleration * rawElapsedSeconds * rawElapsedSeconds;

	return Math.min(distance, Math.max(0, travelled));
}

// After the first outbound leg, each configured boomerang bounce travels 2D.
// It begins at rest, accelerates at +a for D blocks until it reaches the
// original launch speed at the midpoint, then decelerates at -a for another
// D blocks until it reaches rest at the opposite endpoint. The original
// launch kinematics are reused; no speed/duration values are recalculated.
export function getThrowableBoomerangTravelDistance(
	distanceBlocks,
	elapsedMs,
	decelerationBlocksPerSecondSq,
	precomputedInitialSpeed = null,
	precomputedDurationMs = null,
) {
	const distance = Math.max(0, Number(distanceBlocks) || 0);
	const deceleration = Math.max(
		MIN_THROW_DECELERATION,
		Number(decelerationBlocksPerSecondSq ?? 20) || 0,
	);

	if (distance === 0) return 0;

	const initialSpeed = Number.isFinite(precomputedInitialSpeed)
		? Math.max(0, precomputedInitialSpeed)
		: Math.sqrt(2 * deceleration * distance);
	const halfDurationSeconds = Number.isFinite(precomputedDurationMs)
		? Math.max(0, precomputedDurationMs) / 1000
		: initialSpeed / deceleration;
	const elapsedSeconds = Math.max((Number(elapsedMs) || 0) / 1000, 0);
	const fullDurationSeconds = halfDurationSeconds * 2;

	if (elapsedSeconds >= fullDurationSeconds) {
		return distance * 2;
	}

	if (elapsedSeconds <= halfDurationSeconds) {
		// Starts at v=0 and accelerates to the original launch speed.
		return Math.min(
			distance,
			0.5 * deceleration * elapsedSeconds * elapsedSeconds,
		);
	}

	// From the original launch point onward, decelerate from the original
	// launch speed back to v=0 at the opposite endpoint.
	const secondHalfTime = elapsedSeconds - halfDurationSeconds;
	const secondHalfDistance =
		initialSpeed * secondHalfTime -
		0.5 * deceleration * secondHalfTime * secondHalfTime;

	return Math.min(distance * 2, Math.max(distance, distance + secondHalfDistance));
}

export function getRandomSpreadOffset(spreadRadians = 0) {
	const spread = Math.max(0, Number(spreadRadians) || 0);
	return (Math.random() - 0.5) * spread;
}

// Applies an absolute +/- variation to one configured stat. A variation of 2
// around a base speed of 10 therefore rolls uniformly from 8 through 12. The
// minimum clamp prevents randomized projectile properties becoming negative.
export function getVariedStat(baseValue, variation = 0, minimum = 0) {
	const base = Number(baseValue) || 0;
	const amount = Math.max(0, Number(variation) || 0);
	if (amount === 0) return Math.max(minimum, base);

	const rolled = base + (Math.random() * 2 - 1) * amount;
	return Math.max(minimum, rolled);
}

export function getBulletCount(stats) {
	return Math.max(1, Math.floor(Number(stats?.bulletCount ?? 1) || 1));
}

function getDeterministicVolleyOffsets(count) {
	if (count <= 1) return [0];

	const totalSpan = Math.min(1, 0.1 * (count - 1));
	const start = -totalSpan / 2;
	const step = totalSpan / (count - 1);
	return Array.from({ length: count }, (_, index) => start + step * index);
}

export function getProjectileVolleyAngles(baseAngle, stats) {
	const count = getBulletCount(stats);
	const spread = Math.max(0, Number(stats?.spread ?? 0) || 0);

	if (spread > 0) {
		return Array.from(
			{ length: count },
			() => baseAngle + getRandomSpreadOffset(spread),
		);
	}

	return getDeterministicVolleyOffsets(count).map((offset) => baseAngle + offset);
}

export function normalizeSignedAngle(angle) {
	let result = Number(angle) || 0;
	while (result < -Math.PI) result += Math.PI * 2;
	while (result >= Math.PI) result -= Math.PI * 2;
	return result;
}

export function shortestAngleDelta(fromAngle, toAngle) {
	return normalizeSignedAngle(toAngle - fromAngle);
}

export function getLaserConeHalfAngleFromCount(count) {
	return Math.min(Math.PI, Math.max(0, count - 1) * 0.1);
}

