import test from "node:test";
import assert from "node:assert/strict";

import {
	LEVEL_SCHEMA_VERSION,
	migrateLevelDefinition,
	prepareLoadedLevel,
	validateLevelDefinition,
} from "../js/level.js";

test("explicit levels require a finite player spawn", () => {
	assert.throws(() => validateLevelDefinition({ walls: [] }), /require player\.spawn/);
	assert.doesNotThrow(() => validateLevelDefinition({
		player: { spawn: { x: 1, y: 2 } },
		walls: [],
		enemySpawns: [],
	}));
});

test("level preparation is transactional and does not retain caller objects", () => {
	const source = { seed: 7, player: { maximumProjectileCount: 5 } };
	const prepared = prepareLoadedLevel(source);
	prepared.data.seed = 9;
	assert.equal(source.seed, 7);
	assert.equal(prepared.procedural, true);
});

test("unversioned level imports migrate before strict validation", () => {
	const migrated = migrateLevelDefinition({
		playerSpawn: { x: 2, y: 3 },
		walls: [],
	});
	assert.equal(migrated.LEVEL_SCHEMA_VERSION, LEVEL_SCHEMA_VERSION);
	assert.deepEqual(migrated.player.spawn, { x: 2, y: 3 });
	assert.equal("playerSpawn" in migrated, false);
	assert.deepEqual(migrated.enemySpawns, []);
	assert.doesNotThrow(() => validateLevelDefinition(migrated));
	assert.throws(
		() => validateLevelDefinition({ ...migrated, unexpected: true }),
		/not recognised/,
	);
});
