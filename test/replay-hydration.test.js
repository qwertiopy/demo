import test from "node:test";
import assert from "node:assert/strict";

import { hydrateReplayFrame } from "../js/replay.js";

function frame(time, revision) {
	return [time, revision, 0, 0, 0, 0, [0, 0, 10], [], [], [], [], [], []];
}

test("compact replay environments reconstruct lazily across keyframes and deltas", () => {
	const replay = {
		replayVersion: 3,
		rendering: {},
		viewport: [30, 16.875],
		playerStyle: [0.5, "blue", 10],
		sources: {},
		entityDefinitions: { enemies: [], projectiles: [] },
		environments: [
			{ r: 0, k: [[0, 0, 1, 1, "a"]] },
			{ r: 1, a: [[1, 0, 1, 1, "b"]], d: [] },
			{ r: 2, a: [], d: [[0, 0, 1, 1, "a"]] },
		],
	};
	const second = hydrateReplayFrame(replay, frame(2, 2), 2);
	assert.deepEqual(second.walls, [{ x: 1, y: 0, width: 1, height: 1, color: "b" }]);
	const first = hydrateReplayFrame(replay, frame(0, 0), 0);
	assert.deepEqual(first.walls, [{ x: 0, y: 0, width: 1, height: 1, color: "a" }]);
});
