import test from "node:test";
import assert from "node:assert/strict";

import {
	SimulationClock,
	createRenderPacer,
} from "../js/runtime/simulation-clock.js";

function runClockSchedule(callbackHz, simulationHz = 60, durationSeconds = 60) {
	const clock = new SimulationClock({ hz: simulationHz });
	const callbackCount = Math.round(callbackHz * durationSeconds);
	let steps = 0;
	for (let frame = 0; frame < callbackCount; frame++) {
		if (clock.consumeWallTime(frame * 1000 / callbackHz)) steps++;
	}
	return { clock, steps };
}

function runRenderSchedule(callbackHz, targetFps = 60, durationSeconds = 60) {
	const pacer = createRenderPacer();
	const callbackCount = Math.round(callbackHz * durationSeconds);
	let renders = 0;
	for (let frame = 0; frame < callbackCount; frame++) {
		if (pacer.consume(frame * 1000 / callbackHz, targetFps)) renders++;
	}
	return renders;
}

test("simulation clock advances one fixed nominal step", () => {
	const clock = new SimulationClock({ hz: 60 });
	const first = clock.consumeWallTime(100);
	assert.equal(first.tick, 1);
	assert.equal(first.dtSeconds, 1 / 60);
	assert.equal(clock.consumeWallTime(105), null);
	const second = clock.consumeWallTime(117);
	assert.equal(second.tick, 2);
	assert.equal(second.timeMs, 1000 / 30);
});

test("simulation clock discards delayed wall-time backlog", () => {
	const clock = new SimulationClock({ hz: 60 });
	clock.consumeWallTime(0);
	const afterStall = clock.consumeWallTime(10_000);
	assert.equal(afterStall.tick, 2);
	assert.equal(afterStall.timeMs, 1000 / 30);
	assert.equal(clock.consumeWallTime(10_001), null);
	assert.deepEqual(clock.getMetrics(), {
		tick: 2,
		timeMs: 1000 / 30,
		discardedWallTimeMs: 10_000 - 1000 / 60,
		lastDiscardedWallTimeMs: 10_000 - 1000 / 60,
		delayedCallbacks: 1,
	});
});

test("simulation clock retains normal sub-step scheduler phase", () => {
	const clock = new SimulationClock({ hz: 60 });
	assert.equal(clock.consumeWallTime(0).tick, 1);
	assert.equal(clock.consumeWallTime(1000 / 75), null);
	assert.equal(clock.consumeWallTime(2000 / 75).tick, 2);
	// The callback at 26.67 ms was late for the 16.67 ms deadline. Its 10 ms
	// fractional remainder must make the 40 ms callback due; re-anchoring from
	// 26.67 ms incorrectly delays this step until 53.33 ms.
	assert.equal(clock.consumeWallTime(3000 / 75).tick, 3);
	assert.equal(clock.getMetrics().discardedWallTimeMs, 0);
});

test("60 Hz simulation remains 60 Hz across common faster display schedules", () => {
	for (const callbackHz of [60, 75, 90, 120, 144, 165, 240]) {
		const { clock, steps } = runClockSchedule(callbackHz);
		assert.equal(steps, 3600, `${callbackHz} Hz callback schedule`);
		assert.equal(clock.getMetrics().discardedWallTimeMs, 0);
	}
});

test("callback rates below simulation rate remain limited without catch-up", () => {
	assert.equal(runClockSchedule(30).steps, 1800);
	assert.equal(runClockSchedule(50).steps, 3000);
});

test("sub-step phase remains accurate under high-frequency callback jitter", () => {
	const clock = new SimulationClock({ hz: 60 });
	let wallTimeMs = 0;
	let steps = clock.consumeWallTime(wallTimeMs) ? 1 : 0;
	for (let callback = 0; callback < 2000; callback++) {
		wallTimeMs += callback % 2 === 0 ? 6 : 11;
		if (clock.consumeWallTime(wallTimeMs)) steps++;
	}
	assert.equal(
		steps,
		1 + Math.floor((wallTimeMs + 1e-7) / (1000 / 60)),
	);
	assert.equal(clock.getMetrics().discardedWallTimeMs, 0);
});

test("reset restores immediate step behavior and clears scheduler phase", () => {
	const clock = new SimulationClock({ hz: 60 });
	clock.consumeWallTime(0);
	clock.consumeWallTime(20);
	clock.reset({ startTimeMs: 500, wallTimeMs: 1000 });
	const first = clock.consumeWallTime(1000);
	assert.equal(first.tick, 1);
	assert.equal(first.timeMs, 500 + 1000 / 60);
	assert.equal(clock.consumeWallTime(1005), null);
	assert.equal(clock.consumeWallTime(1017).tick, 2);
});

test("rate changes preserve fractional progress toward the next step", () => {
	const clock = new SimulationClock({ hz: 60 });
	clock.consumeWallTime(0);
	assert.equal(clock.consumeWallTime(8), null);
	clock.setRate(120);
	const step = clock.consumeWallTime(12.5);
	assert.equal(step.tick, 2);
	assert.equal(step.dtSeconds, 1 / 120);
});

test("render pacer retains phase across common faster display schedules", () => {
	for (const callbackHz of [60, 75, 90, 120, 144, 165, 240]) {
		assert.equal(
			runRenderSchedule(callbackHz),
			3600,
			`${callbackHz} Hz callback schedule`,
		);
	}
});

test("render pacer renders once after a stall and discards missed intervals", () => {
	const pacer = createRenderPacer();
	assert.equal(pacer.consume(0, 60), true);
	assert.equal(pacer.consume(10_000, 60), true);
	assert.equal(pacer.consume(10_001, 60), false);
	assert.equal(pacer.consume(10_017, 60), true);
	pacer.reset();
	assert.equal(pacer.consume(20_000, 60), true);
});

test("render pacer discards elapsed intervals before its first explicit render", () => {
	const pacer = createRenderPacer(0);
	assert.equal(pacer.consume(10_000, 60), true);
	assert.equal(pacer.consume(10_001, 60), false);
	assert.equal(pacer.consume(10_017, 60), true);
});
