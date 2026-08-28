import test from "node:test";
import assert from "node:assert/strict";

import { validateReplayData } from "../js/replay-file.js";

function v3Replay() {
	return {
		replayVersion: 3,
		rendering: {},
		viewport: [30, 16.875],
		playerStyle: [0.5, "blue", 10, null],
		sources: { config: "factory", level: "factory" },
		entityDefinitions: {
			enemies: [[1, 1, "red", 2, {
				type: "polygon",
				points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
			}]],
			projectiles: [[2, 0.05, "white"]],
		},
		environments: [{ r: 0, k: [] }],
		frames: [[0, 0, 0, 0, 0, 0, [0, 0, 10], [[1, 1, 1, 2]], [], [], [], [], []]],
		segments: [{ type: "respawn", atMs: 0, frameIndex: 0 }],
	};
}

test("current compact replay accepts exact actor shapes and respawn markers", () => {
	const replay = v3Replay();
	assert.equal(validateReplayData(replay), replay);
});

test("replay validation rejects malformed shape and undefined tuple ids", () => {
	const malformedShape = v3Replay();
	malformedShape.entityDefinitions.enemies[0][4].points = [];
	assert.throws(() => validateReplayData(malformedShape), /at least three/);

	const badReference = v3Replay();
	badReference.frames[0][7][0][0] = 999;
	assert.throws(() => validateReplayData(badReference), /undefined enemy id/);
});

test("legacy replay versions remain accepted", () => {
	assert.doesNotThrow(() => validateReplayData({
		replayVersion: 1,
		frames: [{ timeMs: 0, camera: {}, player: {}, rendering: {} }],
	}));
	assert.doesNotThrow(() => validateReplayData({
		replayVersion: 2,
		rendering: {},
		environments: [{ revision: 0, walls: [], enemySpawns: [] }],
		frames: [{ timeMs: 0, environmentRevision: 0, camera: {}, player: {} }],
	}));
});
