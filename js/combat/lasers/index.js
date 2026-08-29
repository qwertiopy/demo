// Public laser subsystem API.

export {
	getLaserCalculationBudgetPerFrame,
	getLaserCalculationBudgetRemaining,
	resetLaserCalculationBudget,
} from "./budget.js";
export { getLaserWallStopWithPenetrationBudget } from "./wall-interaction.js";
export { requestLaserShot } from "./spawn.js";
export { processLasers } from "./warmup.js";
