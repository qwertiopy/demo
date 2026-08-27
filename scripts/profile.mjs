import { performance } from "node:perf_hooks";

import { CombatDefaults } from "../js/combat/defaults.js";
import {
	registerProjectile,
	releaseProjectileEntry,
	resetProjectileCaps,
} from "../js/combat/projectile-cap.js";
import { GameState } from "../js/state.js";
import { markWallIndexDirty, queryWallsInAabb } from "../js/spatial/wall-index.js";

CombatDefaults.DEFAULT_MAXIMUM_PROJECTILE_COUNT = 50;
CombatDefaults.MAXIMUM_PROJECTILE_COUNT_SAFEGUARD = 1000;

function benchmark(name, iterations, operation) {
	for (let index = 0; index < Math.min(iterations, 1000); index++) operation(index);
	const startedAt = performance.now();
	for (let index = 0; index < iterations; index++) operation(index);
	const durationMs = performance.now() - startedAt;
	return {
		name,
		iterations,
		durationMs,
		operationsPerSecond: durationMs > 0 ? iterations * 1000 / durationMs : Infinity,
	};
}

GameState.walls = Array.from({ length: 5000 }, (_, index) => ({
	x: index % 500,
	y: Math.floor(index / 500),
	width: 1,
	height: 1,
}));
markWallIndexDirty();

const wallQueries = benchmark("wall-index-aabb", 20000, (index) => {
	const x = index % 490;
	queryWallsInAabb(x, 2, x + 10, 7);
});

resetProjectileCaps();
const liveEntries = [];
const projectileQueue = benchmark("projectile-cap-register-release", 100000, (index) => {
	const entry = registerProjectile(2, {}, 50);
	liveEntries.push(entry);
	if (index % 2 === 0) releaseProjectileEntry(entry);
	if (liveEntries.length > 100) releaseProjectileEntry(liveEntries.shift());
});

console.log(JSON.stringify({ wallQueries, projectileQueue }, null, 2));
