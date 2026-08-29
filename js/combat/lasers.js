// Compatibility facade for the laser subsystem.

export {
	getLaserCalculationBudgetPerFrame,
	getLaserCalculationBudgetRemaining,
	getLaserWallStopWithPenetrationBudget,
	processLasers,
	requestLaserShot,
	resetLaserCalculationBudget,
} from "./lasers/index.js";

export { rayRectIntersection } from "./visibility.js";
