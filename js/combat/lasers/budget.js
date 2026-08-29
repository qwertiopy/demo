// Laser calculation budget and loaded-world range helpers.

import { Config } from "../../config.js";
import {
	getWallIndexBounds,
	queryWallsAlongRayDda,
} from "../../spatial/wall-index.js";
import { getCombatDefault } from "../defaults.js";
import { rayRectIntersection } from "../visibility.js";

// Laser range is no longer capped by an arbitrary gameplay distance. Rays extend
// to the edge of the currently loaded world, while a shared per-frame calculation
// budget limits worst-case CPU work. One budget unit represents one potentially
// expensive laser/world or laser/entity geometry check.
let laserCalculationBudgetRemaining = 0;
let laserLoadedWorldBoundsCached = false;
let cachedLaserLoadedWorldBounds = null;

export function getLaserCalculationBudgetPerFrame() {
	return Math.max(
		1,
		Math.floor(getCombatDefault("LASER_CALCULATION_BUDGET_PER_FRAME")),
	);
}

export function resetLaserCalculationBudget() {
	laserCalculationBudgetRemaining = getLaserCalculationBudgetPerFrame();
	laserLoadedWorldBoundsCached = false;
	cachedLaserLoadedWorldBounds = null;
}

export function getLaserCalculationBudgetRemaining() {
	return laserCalculationBudgetRemaining;
}

export function consumeLaserCalculationBudget(units = 1) {
	const cost = Math.max(1, Math.floor(Number(units) || 1));
	if (laserCalculationBudgetRemaining < cost) return false;
	laserCalculationBudgetRemaining -= cost;
	return true;
}

function getLaserLoadedWorldBounds() {
	if (laserLoadedWorldBoundsCached) return cachedLaserLoadedWorldBounds;

	laserLoadedWorldBoundsCached = true;
	cachedLaserLoadedWorldBounds = getWallIndexBounds();
	return cachedLaserLoadedWorldBounds;
}

function getLaserFallbackLoadedRangeBlocks() {
	const rendering = Config.RENDERING || {};
	return Math.max(
		1,
		Number(rendering.DISTANCE_FRONT_BLOCKS ?? 35) +
			Number(rendering.DISTANCE_BACK_BLOCKS ?? 20) +
			Number(rendering.CLEANUP_BUFFER_BLOCKS ?? 0),
	);
}

export function getLaserLoadedRangeBlocks(originX, originY, dirX, dirY) {
	const bounds = getLaserLoadedWorldBounds();
	if (!bounds) return getLaserFallbackLoadedRangeBlocks();

	const hit = rayRectIntersection(originX, originY, dirX, dirY, bounds, 0);
	if (!hit) return 0;
	return Math.max(0, hit.exitDistance);
}

export function getLaserLoadedWorldRadiusBlocks(originX, originY) {
	const bounds = getLaserLoadedWorldBounds();
	if (!bounds) return getLaserFallbackLoadedRangeBlocks();

	const corners = [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		{ x: bounds.x, y: bounds.y + bounds.height },
	];

	return Math.max(
		1,
		...corners.map((corner) =>
			Math.hypot(corner.x - originX, corner.y - originY),
		),
	);
}

export function queryLaserWallsAlongRay(
	originX,
	originY,
	dirX,
	dirY,
	maxRangeBlocks,
	radius = 0,
) {
	return queryWallsAlongRayDda(
		originX,
		originY,
		dirX,
		dirY,
		maxRangeBlocks,
		radius,
		() => consumeLaserCalculationBudget(),
	);
}

