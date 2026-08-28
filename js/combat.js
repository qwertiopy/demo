// Combat public API.
//
// The implementation is split by subsystem under js/combat/ so existing imports
// from "./combat.js" do not need to change.

export {
	getMinimumThrowDeceleration,
	getThrowableKinematics,
	getThrowableTravelDistance,
	getThrowableBoomerangTravelDistance,
	getRandomSpreadOffset,
	normalizeVariationLuckUpgrade,
} from "./combat/weapon-utils.js";

export {
	lineIntersects,
	hasLineOfSight,
	hasProjectileRadiusClearance,
	circleIntersectsRect,
	circleIntersectsRenderedShape,
} from "./combat/collision.js";

export {
	detonateBullet,
	processExplosions,
} from "./combat/explosions.js";

export {
	shoot,
	resolveProjectileVectorCollisions,
	getPenetratedCollisionRect,
	getBulletMaxStepBlocks,
	processProjectiles,
} from "./combat/projectiles.js";

export {
	updateEnemies,
	resolveEnemyVectorCollisions,
} from "./combat/enemies.js";

export {
	getLaserCalculationBudgetPerFrame,
	getLaserCalculationBudgetRemaining,
	getLaserCalculationBudgetOverrun,
	getLaserCalculationBudgetSpent,
	resetLaserCalculationBudget,
	rayRectIntersection,
	getLaserWallStopWithPenetrationBudget,
	requestLaserShot,
	processLasers,
} from "./combat/lasers.js";
