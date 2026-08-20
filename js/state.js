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
	bullets: [],
	enemyBullets: [],
	projectileTrailEvents: [],
	explosions: [],
	laserWarmups: [],
	laserBeams: [],
	weaponCooldownUntilByWeapon: [],
	enemies: [],
	walls: [],
	enemySpawns: [],
	enemySpawnRate: 0,
	lastSpawnTime: 0,
	generatedColumns: new Set(),
	placedStructures: [],
	levelSeed: 12345,
	currentSeed: 12345,
	uiMode: "none",
	gameModeId: "sandbox",
	showEditorHelpers: false,
	environmentRevision: 0,
	isInvincible: false,
	MaxDistance: -1,
	isPlayerDead: false,
};

// Increments whenever render-relevant world geometry/spawn metadata changes.
// Replay recording uses this cheap revision marker so static environment data
// is only serialized when it actually changes.
export function markEnvironmentChanged() {
	GameState.environmentRevision += 1;
	return GameState.environmentRevision;
}

// Mutable player entity containing position, movement properties, appearance, and health.
export const player = {
	x: 0,
	y: 0,
	size: Config.PLAYER_SIZE_BLOCKS,
	speed: Config.PLAYER_SPEED,
	color: "royalblue",
	hp: 10,
	maxHp: 10,
};

// Mutable camera state expressed in world blocks; the render system follows the player by updating these coordinates.
export const camera = { x: 0, y: 0, widthBlocks: 30, heightBlocks: 16.875 };
