import test from "node:test";
import assert from "node:assert/strict";

import {
	beginProfileFrame,
	beginProfileSection,
	configureProfiler,
	endProfileFrame,
	endProfileSection,
	getProfilerSnapshot,
	resetProfiler,
	setProfileCounter,
} from "../js/performance/profiler.js";

test.afterEach(() => {
	configureProfiler({ enabled: false, now: () => performance.now() });
	resetProfiler();
});

test("disabled profiler retains no samples", () => {
	configureProfiler({ enabled: false });
	beginProfileFrame(10);
	endProfileFrame();
	assert.equal(getProfilerSnapshot().frames.samples, 0);
});

test("profiler aggregates sections, counters, and bounded frames", () => {
	const timestamps = [0, 1, 3, 5, 10, 14];
	configureProfiler({ enabled: true, sampleLimit: 1, now: () => timestamps.shift() });
	beginProfileFrame(100);
	const startedAt = beginProfileSection();
	endProfileSection("projectiles", startedAt);
	setProfileCounter("projectiles", 4);
	endProfileFrame();
	beginProfileFrame(200);
	setProfileCounter("projectiles", 6);
	endProfileFrame();

	const snapshot = getProfilerSnapshot();
	assert.equal(snapshot.retainedFrames, 1);
	assert.equal(snapshot.frames.meanMs, 4);
	assert.equal(snapshot.sections.projectiles, undefined);
	assert.deepEqual(snapshot.counters.projectiles, {
		samples: 1,
		mean: 6,
		latest: 6,
		max: 6,
	});
});
