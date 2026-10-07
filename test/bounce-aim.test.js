import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Config } from '../js/config.js';
import { CombatDefaults, validateCombatDefaults } from '../js/combat/defaults.js';
import { GameState, player } from '../js/state.js';
import { findEnemyShotPaths, chooseEnemyShotPath } from '../js/combat/enemies/bounce-aim.js';
import { updateEnemies } from '../js/combat/enemies/index.js';
import { createEnemyRuntimeStats } from '../js/combat/enemies/definitions.js';
import { captureVisualSnapshot } from '../js/replay/snapshot.js';

const factory = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
Object.assign(Config, factory);
Object.assign(CombatDefaults, JSON.parse(fs.readFileSync(new URL('../js/combat/defaults.json', import.meta.url))));
const weapon = { maxBounces: 2, radiusBlocks: 0.1, speed: 20, lifetimeMs: 5000 };
const origin = { x: 0, y: 0 }, target = { x: 4, y: 0 };
const reflector = { x: -2, y: 3, width: 8, height: 1 };

function walls(value) {
	GameState.walls = value;
	GameState.environmentRevision++;
}

test('strict bounce threshold; radius-adjusted reflection and uniform route selection', () => {
	walls([reflector]);
	assert.deepEqual(findEnemyShotPaths(origin, target, { ...weapon, maxBounces: 1 }), []);
	const paths = findEnemyShotPaths(origin, target, weapon);
	assert.equal(paths.length, 2);
	assert.equal(paths[0].bounce, null);
	assert.deepEqual(paths[1].bounce, { y: 2.9, x: 2 });
	assert.equal(paths[1].angle, Math.atan2(2.9, 2));
	assert.equal(chooseEnemyShotPath(paths, 0, () => 0), paths[0]);
	assert.equal(chooseEnemyShotPath(paths, 0, () => 0.99), paths[1]);
	assert.equal(chooseEnemyShotPath([]), null);
});

test('bounce can reach a target hidden from direct sight', () => {
	walls([reflector, { x: 1.9, y: -0.5, width: 0.2, height: 1 }]);
	const paths = findEnemyShotPaths(origin, target, weapon);
	assert.ok(paths.length);
	assert.ok(paths.every(path => path.bounce));
});

test('reject obstructed incoming/outgoing legs and shots beyond lifetime', () => {
	for (const x of [1, 3]) {
		walls([reflector, { x: x - 0.2, y: 1, width: 0.4, height: 1 }]);
		assert.ok(!findEnemyShotPaths(origin, target, weapon).some(path => path.bounce?.y === 2.9));
	}
	walls([reflector]);
	assert.deepEqual(findEnemyShotPaths(origin, target, { ...weapon, lifetimeMs: 100 }), []);
});

test('touching wall tiles preserve valid planar reflections including seams', () => {
	walls([{ x: -2, y: 3, width: 4, height: 1 }, { x: 2, y: 3, width: 4, height: 1 }]);
	assert.ok(findEnemyShotPaths(origin, target, weapon).some(path => path.bounce?.x === 2));
});

test('enemy acquires a hidden target by bounce, fires once, respects cooldown, captures debug', () => {
	walls([reflector, { x: 1.9, y: -0.5, width: 0.2, height: 1 }]);
	Object.assign(player, { x: 3.75, y: -0.25, size: 0.5, vx: 0, vy: 0 });
	const configured = { ...Object.values(factory.ENEMY_TYPES)[0], weapons: [{ ...weapon, volley: { enabled: false } }] };
	const e = { id: 42, team: 'enemy', maximumProjectileCount: 100, x: -0.25, y: -0.25, size: 0.5, hp: 100, maxHp: 100,
		lastShot: 0, shootCooldown: 500, typeStats: createEnemyRuntimeStats('bounce-test', configured) };
	Object.assign(GameState, { enemies: [e], projectiles: [], enemySpawns: [], showEditorHelpers: true });
	updateEnemies(1000, 0);
	assert.equal(GameState.projectiles.length, 1);
	assert.equal(e.lastShot, 1000);
	assert.equal(e.hasAimTarget, true);
	assert.ok(e.debugSelectedBouncePath.bounce);
	const snapshot = captureVisualSnapshot(1000);
	assert.ok(snapshot.enemies[0].aimDebug.bouncePaths.some(path => path.selected));
	const before = snapshot.enemies[0].aimDebug.bouncePaths[0].bounce.x;
	e.debugBouncePaths[0].bounce.x += 1;
	assert.equal(snapshot.enemies[0].aimDebug.bouncePaths[0].bounce.x, before);
	updateEnemies(1001, 0);
	assert.equal(GameState.projectiles.length, 1);
	GameState.showEditorHelpers = false;
	assert.equal(captureVisualSnapshot(1001).enemies[0].aimDebug, null);
});


test('shot priority prefers LOS or bounce and falls back to available routes', () => {
	const direct = { bounce: null }, bankA = { bounce: { x: 1, y: 1 } }, bankB = { bounce: { x: 2, y: 2 } };
	const paths = [direct, bankA, bankB];
	assert.equal(chooseEnemyShotPath(paths, -1, () => 0.99), direct);
	assert.equal(chooseEnemyShotPath(paths, 1, () => 0), bankA);
	assert.equal(chooseEnemyShotPath(paths, 1, () => 0.99), bankB);
	assert.equal(chooseEnemyShotPath(paths, 0, () => 0), direct);
	assert.equal(chooseEnemyShotPath(paths, 0, () => 0.99), bankB);
	assert.equal(chooseEnemyShotPath([bankA], -1), bankA);
	assert.equal(chooseEnemyShotPath([direct], 1), direct);
	for (const priority of [-1, 0, 1]) assert.equal(chooseEnemyShotPath([], priority), null);
});

test('combat defaults validate priorities and migrate old saved settings to random', () => {
	for (const priority of [-1, 0, 1]) {
		assert.equal(validateCombatDefaults({ ...CombatDefaults, ENEMY_BOUNCE_SHOT_PRIORITY: priority }).ENEMY_BOUNCE_SHOT_PRIORITY, priority);
	}
	for (const priority of [-2, 2, 0.5, 'invalid']) {
		assert.throws(() => validateCombatDefaults({ ...CombatDefaults, ENEMY_BOUNCE_SHOT_PRIORITY: priority }), /ENEMY_BOUNCE_SHOT_PRIORITY/);
	}
	const old = { ...CombatDefaults };
	delete old.ENEMY_BOUNCE_SHOT_PRIORITY;
	assert.equal(validateCombatDefaults(old).ENEMY_BOUNCE_SHOT_PRIORITY, 0);
});
