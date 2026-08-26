// Mutable game singletons.

import { Config } from "./config.js";

// Mutable game-wide state: physical inputs, entities, procedural-generation
// bookkeeping, timing, gameplay toggles, aiming, and active weapon selection.
export const GameState = {
	pressedInputs: new Set(),
	mouseClientX: null,
	mouseClientY: null,
	aimWorldX: 1,
	aimWorldY: 0.25,
	activeWeaponIndex: 0,
	projectiles: [],
	projectileTrailEvents: [],
	explosions: [],
	laserWarmups: [],
	laserBeams: [],
	weaponCooldownUntilByWeapon: [],
	enemies: [],
	walls: [],
	enemySpawns: [],
	enemySpawnRate: 0,
	enemySpawnBaseRate: 0,
	enemySpawnProgressOriginX: 0,
	enemySpawnProgressBlocks: 0,
	enemySpawnRateProgressionEnabled: false,
	enemySpawnRateIncreasePerInterval: 0.1,
	enemySpawnRateIncreaseIntervalBlocks: 100,
	minimumEnemySpawnDistanceBlocks: 25,
	maximumEnemySpawnDistanceBlocks: 35,
	lastSpawnTime: 0,
	generatedColumns: new Set(),
	placedStructures: [],
	corridorCeilingYBlocks: 0,
	corridorWidthBlocks: 10,
	structureSpawnChance: 0.5,
	structureDensityBlocks: 5,
	minimumStructureOriginXExclusive: 2,
	levelSeed: 12345,
	currentSeed: 12345,
	uiMode: "none",
	gameModeId: "sandbox",
	configSource: "session",
	levelSource: "session",
	defaultsSource: "session",
	showEditorHelpers: false,
	environmentRevision: 0,
	isInvincible: false,
	MaxDistance: -1,
	isPlayerDead: false,
};

export const TEAM_PLAYER = "player";
export const TEAM_ENEMY = "enemy";

const PLAYER_ENTITY_ID = 1;
let nextEntityId = PLAYER_ENTITY_ID + 1;

// Entity IDs are stable for one level run. Projectile ownership and FIFO caps
// use these scalar IDs instead of retaining live entity-object references.
export function allocateEntityId() {
	return nextEntityId++;
}

// A full level reset clears every projectile and cap queue before IDs can be
// reused, so resetting the sequence cannot merge two owners' FIFO state.
export function resetEntityIds() {
	nextEntityId = PLAYER_ENTITY_ID + 1;
}

// Increments whenever render-relevant world geometry/spawn metadata changes.
// Replay recording uses this cheap revision marker so static environment data
// is only serialized when it actually changes.
export function markEnvironmentChanged() {
	GameState.environmentRevision += 1;
	return GameState.environmentRevision;
}

// Mutable player entity containing position, movement properties, appearance, and health.
export const player = {
	id: PLAYER_ENTITY_ID,
	team: TEAM_PLAYER,
	upgrades: {
		variationLuck: 0,
	},
	x: 0,
	y: 0,
	size: Config.PLAYER_SIZE_BLOCKS,
	speed: Config.PLAYER_SPEED,
	color: "royalblue",
	hp: 10,
	maxHp: 10,
	vx: 0,
	vy: 0,
	maximumProjectileCount: 50,
};

// Mutable camera state expressed in world blocks; the render system follows the player by updating these coordinates.
export const camera = { x: 0, y: 0, widthBlocks: 30, heightBlocks: 16.875 };
