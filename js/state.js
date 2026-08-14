// Mutable game singletons.

import { Config } from "./config.js";

// Mutable game-wide state: input flags, entities, procedural-generation bookkeeping, timing, and gameplay toggles.
export const GameState = {
	keys: { w: false, a: false, s: false, d: false },
	bullets: [],
	enemyBullets: [],
	enemies: [],
	walls: [],
	enemySpawns: [],
	enemySpawnRate: 0,
	lastSpawnTime: 0,
	generatedColumns: new Set(),
	placedStructures: [],
	levelSeed: 12345,
	currentSeed: 12345,
	playerLastShot: 0,
	showEditorHelpers: true,
	isInvincible: false,
	MaxDistance: -1,
};

// Mutable player entity containing position, movement properties, appearance, and health.
export const player = {
	x: 0,
	y: 0,
	size: Config.PLAYER_SIZE_BLOCKS,
	speed: Config.PLAYER_SPEED,
	color: "royalblue",
	hp: 100,
	maxHp: 100,
};

// Mutable camera state expressed in world blocks; the render system follows the player by updating these coordinates.
export const camera = { x: 0, y: 0, widthBlocks: 20, heightBlocks: 11.25 };
