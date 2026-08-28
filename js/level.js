// Loads the factory level definition from level.json.

export const DEFAULT_LEVEL_URL = "level.json";
export const LEVEL_SCHEMA_VERSION = 1;

const LEVEL_FIELDS = new Set([
	"LEVEL_SCHEMA_VERSION",
	"seed",
	"invincibility",
	"player",
	"playerSpawn",
	"enemySpawns",
	"enemySpawnRate",
	"enemySpawnRateIncreasePerInterval",
	"enemySpawnRateIncreaseIntervalBlocks",
	"minimumEnemySpawnDistanceBlocks",
	"maximumEnemySpawnDistanceBlocks",
	"corridorCeilingYBlocks",
	"corridorWidthBlocks",
	"structureSpawnChance",
	"structureDensityBlocks",
	"walls",
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

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

function rejectUnknownKeys(value, allowed, path) {
	for (const key of Object.keys(value || {})) {
		if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
			throw new Error(`${path}.${key} is not recognised by this schema.`);
		}
	}
}

function finite(value, path) {
	if (!Number.isFinite(Number(value))) throw new Error(`${path} must be finite.`);
	return Number(value);
}

export function migrateLevelDefinition(level) {
	if (!level || typeof level !== "object" || Array.isArray(level)) {
		throw new Error("level.json must contain one JSON object.");
	}
	const migrated = clone(level);
	const version = Number(migrated.LEVEL_SCHEMA_VERSION ?? 0);
	if (!Number.isInteger(version) || version < 0 || version > LEVEL_SCHEMA_VERSION) {
		throw new Error(`Unsupported level schema ${migrated.LEVEL_SCHEMA_VERSION}.`);
	}
	if (version < 1) {
		if (!migrated.player && migrated.playerSpawn) {
			migrated.player = { spawn: migrated.playerSpawn };
		}
		delete migrated.playerSpawn;
		migrated.walls ??= [];
		migrated.enemySpawns ??= [];
		migrated.LEVEL_SCHEMA_VERSION = LEVEL_SCHEMA_VERSION;
	}
	return migrated;
}

export function validateLevelDefinition(level) {
	level = migrateLevelDefinition(level);
	if (!level || typeof level !== "object" || Array.isArray(level)) {
		throw new Error("level.json must contain one JSON object.");
	}
	rejectUnknownKeys(level, LEVEL_FIELDS, "level");
	if (level.LEVEL_SCHEMA_VERSION !== LEVEL_SCHEMA_VERSION) {
		throw new Error(`Unsupported level schema ${level.LEVEL_SCHEMA_VERSION}.`);
	}
	const procedural = level.seed !== undefined;
	const spawn = level.player?.spawn ?? level.playerSpawn;
	if (procedural) finite(level.seed, "level.seed");
	if (!level.player || typeof level.player !== "object" || Array.isArray(level.player)) {
		throw new Error(procedural
			? "level.player is required."
			: "Explicit levels require player.spawn with finite x and y values.");
	}
	rejectUnknownKeys(
		level.player,
		new Set(["spawn", "maximumProjectileCount", "upgrades"]),
		"level.player",
	);
	if (spawn !== undefined) {
		if (!spawn || typeof spawn !== "object" || Array.isArray(spawn)) {
			throw new Error("level.player.spawn must be an object.");
		}
		rejectUnknownKeys(spawn, new Set(["x", "y"]), "level.player.spawn");
		finite(spawn.x, "level.player.spawn.x");
		finite(spawn.y, "level.player.spawn.y");
	}
	if (level.player.maximumProjectileCount !== undefined) {
		finite(level.player.maximumProjectileCount, "level.player.maximumProjectileCount");
	}
	if (level.player.upgrades !== undefined) {
		rejectUnknownKeys(
			level.player.upgrades,
			new Set(["variationLuck"]),
			"level.player.upgrades",
		);
		finite(level.player.upgrades.variationLuck ?? 0, "level.player.upgrades.variationLuck");
	}
	if (!procedural) {
		if (!spawn || !Number.isFinite(Number(spawn.x)) || !Number.isFinite(Number(spawn.y))) {
			throw new Error("Explicit levels require player.spawn with finite x and y values.");
		}
		if (level.walls !== undefined && !Array.isArray(level.walls)) {
			throw new Error("Explicit level walls must be an array.");
		}
		if (level.enemySpawns !== undefined && !Array.isArray(level.enemySpawns)) {
			throw new Error("Explicit level enemySpawns must be an array.");
		}
	}
	for (const [index, wall] of (level.walls || []).entries()) {
		if (!wall || typeof wall !== "object" || Array.isArray(wall)) {
			throw new Error(`level.walls[${index}] must be an object.`);
		}
		rejectUnknownKeys(
			wall,
			new Set(["x", "y", "width", "height", "size", "color"]),
			`level.walls[${index}]`,
		);
		finite(wall.x, `level.walls[${index}].x`);
		finite(wall.y, `level.walls[${index}].y`);
		finite(wall.width ?? wall.size, `level.walls[${index}].width`);
		finite(wall.height ?? wall.size, `level.walls[${index}].height`);
	}
	for (const [index, spawnPoint] of (level.enemySpawns || []).entries()) {
		if (!spawnPoint || typeof spawnPoint !== "object" || Array.isArray(spawnPoint)) {
			throw new Error(`level.enemySpawns[${index}] must be an object.`);
		}
		rejectUnknownKeys(
			spawnPoint,
			new Set(["x", "y", "type", "size"]),
			`level.enemySpawns[${index}]`,
		);
		finite(spawnPoint.x, `level.enemySpawns[${index}].x`);
		finite(spawnPoint.y, `level.enemySpawns[${index}].y`);
		if (spawnPoint.type !== undefined && typeof spawnPoint.type !== "string") {
			throw new Error(`level.enemySpawns[${index}].type must be a string.`);
		}
	}
	return level;
}

export function prepareLoadedLevel(level, configFallback = {}) {
	const data = clone(validateLevelDefinition(level));
	return {
		data,
		procedural: data.seed !== undefined,
		runtimeSettings: resolveLevelRuntimeSettings(data, configFallback),
		playerDefinition: data.player || { spawn: data.playerSpawn },
	};
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
