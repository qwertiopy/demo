// Loads the factory level definition from level.json.

export const DEFAULT_LEVEL_URL = "level.json";

export const DEFAULT_LEVEL_RUNTIME_SETTINGS = Object.freeze({
	invincibility: false,
	enemySpawnRateIncreasePerInterval: 0.1,
	enemySpawnRateIncreaseIntervalBlocks: 100,
	minimumEnemySpawnDistanceBlocks: 25,
	maximumEnemySpawnDistanceBlocks: 35,
	corridorCeilingYBlocks: 0,
	corridorWidthBlocks: 10,
	structureSpawnChance: 0.5,
	structureDensityBlocks: 5,
});

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function validateLevelDefinition(level) {
	if (!level || typeof level !== "object" || Array.isArray(level)) {
		throw new Error("level.json must contain one JSON object.");
	}
	return level;
}

function readFiniteNumber(value, fallback) {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) ? numericValue : fallback;
}

function readNonNegativeNumber(value, fallback) {
	return Math.max(0, readFiniteNumber(value, fallback));
}

function readPositiveNumber(value, fallback) {
	const numericValue = readFiniteNumber(value, fallback);
	return numericValue > 0 ? numericValue : fallback;
}

// Resolves the level-owned competitive/procedural controls. Config values are
// only fallbacks for older custom levels that predate these level.json fields.
export function resolveLevelRuntimeSettings(level, configFallback = {}) {
	const defaults = DEFAULT_LEVEL_RUNTIME_SETTINGS;
	const fallbackMinimumSpawnDistance = readNonNegativeNumber(
		configFallback.MIN_SPAWN_DISTANCE_BLOCKS,
		defaults.minimumEnemySpawnDistanceBlocks,
	);
	const fallbackMaximumSpawnDistance = readNonNegativeNumber(
		configFallback.MAX_SPAWN_DISTANCE_BLOCKS,
		defaults.maximumEnemySpawnDistanceBlocks,
	);
	const minimumEnemySpawnDistanceBlocks = readNonNegativeNumber(
		level?.minimumEnemySpawnDistanceBlocks,
		fallbackMinimumSpawnDistance,
	);
	const maximumEnemySpawnDistanceBlocks = Math.max(
		minimumEnemySpawnDistanceBlocks,
		readNonNegativeNumber(
			level?.maximumEnemySpawnDistanceBlocks,
			fallbackMaximumSpawnDistance,
		),
	);

	return {
		invincibility: level?.invincibility === true,
		enemySpawnRateIncreasePerInterval: readNonNegativeNumber(
			level?.enemySpawnRateIncreasePerInterval,
			defaults.enemySpawnRateIncreasePerInterval,
		),
		enemySpawnRateIncreaseIntervalBlocks: readPositiveNumber(
			level?.enemySpawnRateIncreaseIntervalBlocks,
			defaults.enemySpawnRateIncreaseIntervalBlocks,
		),
		minimumEnemySpawnDistanceBlocks,
		maximumEnemySpawnDistanceBlocks,
		corridorCeilingYBlocks: Math.floor(
			readFiniteNumber(
				level?.corridorCeilingYBlocks,
				defaults.corridorCeilingYBlocks,
			),
		),
		corridorWidthBlocks: Math.max(
			1,
			Math.floor(
				readPositiveNumber(
					level?.corridorWidthBlocks,
					defaults.corridorWidthBlocks,
				),
			),
		),
		structureSpawnChance: Math.min(
			1,
			readNonNegativeNumber(
				level?.structureSpawnChance,
				defaults.structureSpawnChance,
			),
		),
		structureDensityBlocks: readNonNegativeNumber(
			level?.structureDensityBlocks,
			readNonNegativeNumber(
				configFallback.STRUCTURE_DENSITY_BLOCKS,
				defaults.structureDensityBlocks,
			),
		),
	};
}

let cachedDefaultLevel = null;

export async function loadDefaultLevelDefinition({ reload = false } = {}) {
	if (!reload && cachedDefaultLevel !== null) {
		return clone(cachedDefaultLevel);
	}

	const response = await fetch(DEFAULT_LEVEL_URL, { cache: "no-store" });
	if (!response.ok) {
		throw new Error(
			`Failed to load ${DEFAULT_LEVEL_URL} (HTTP ${response.status}).`,
		);
	}

	const level = validateLevelDefinition(await response.json());
	cachedDefaultLevel = clone(level);
	return clone(cachedDefaultLevel);
}
