// Backwards-compatible combat public API.
//
// The implementation is split by subsystem under js/combat/ so existing imports
// from "./combat.js" do not need to change.

export {
	MIN_THROW_DECELERATION,
	getThrowableKinematics,
	getThrowableTravelDistance,
	getThrowableBoomerangTravelDistance,
	getRandomSpreadOffset,
} from "./combat/weapon-utils.js";

export {
	lineIntersects,
	hasLineOfSight,
	circleIntersectsRect,
} from "./combat/collision.js";

export {
	detonateBullet,
	processExplosions,
} from "./combat/explosions.js";

export {
	shoot,
	resolveProjectileVectorCollisions,
	getPenetratedCollisionRect,
	BULLET_MAX_STEP_BLOCKS,
	processBullets,
} from "./combat/projectiles.js";

export {
	updateEnemies,
	resolveEnemyVectorCollisions,
} from "./combat/enemies.js";

export {
	DEFAULT_LASER_CALCULATION_BUDGET_PER_FRAME,
	getLaserCalculationBudgetPerFrame,
	getLaserCalculationBudgetRemaining,
	resetLaserCalculationBudget,
	rayRectIntersection,
	getLaserWallStopWithPenetrationBudget,
	requestLaserShot,
	processLasers,
} from "./combat/lasers.js";
