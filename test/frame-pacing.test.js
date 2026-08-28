import test from "node:test";
import assert from "node:assert/strict";

import {
	FramePacer,
	MAX_DT_SECONDS,
} from "../js/runtime/frame-pacing.js";

function consumeFrame(pacer, currentTime, targetFps) {
	if (!pacer.advanceAnimationFrame(currentTime, targetFps)) return false;
	pacer.consumeTick(currentTime);
	return true;
}

test("frame pacer preserves target-FPS tick gating", () => {
	const pacer = new FramePacer();

	assert.equal(consumeFrame(pacer, 1000, 30), true);
	assert.ok(Math.abs(pacer.dt - 1 / 30) < 1e-12);

	assert.equal(consumeFrame(pacer, 1016, 30), false);
	assert.equal(consumeFrame(pacer, 1033.4, 30), true);
	assert.ok(Math.abs(pacer.tickDurationMs - 33.4) < 1e-9);
});

test("frame pacer keeps deliberately low target FPS timesteps", () => {
	const pacer = new FramePacer();

	assert.equal(consumeFrame(pacer, 0, 10), true);
	assert.ok(Math.abs(pacer.dt - 0.1) < 1e-12);
	assert.ok(pacer.dt > MAX_DT_SECONDS);
});

test("frame pacer caps unexpected stalls without changing target cadence", () => {
	const pacer = new FramePacer();

	assert.equal(consumeFrame(pacer, 0, 60), true);
	assert.equal(consumeFrame(pacer, 500, 60), true);
	assert.equal(pacer.dt, MAX_DT_SECONDS);
});
