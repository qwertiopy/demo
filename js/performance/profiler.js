// Opt-in runtime profiler. Disabled profiling does not sample the clock or
// retain frame data. Enable it with ?profile=1 or from the browser console via
// GameProfiler.enable().

const DEFAULT_SAMPLE_LIMIT = 600;

function defaultNow() {
	return globalThis.performance?.now?.() ?? Date.now();
}

function profileRequestedByUrl() {
	try {
		return new URLSearchParams(globalThis.location?.search || "").get("profile") === "1";
	} catch {
		return false;
	}
}

let enabled = profileRequestedByUrl();
let sampleLimit = DEFAULT_SAMPLE_LIMIT;
let now = defaultNow;
let activeFrame = null;
let completedFrames = [];

function clampSampleLimit(value) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? Math.max(1, Math.floor(numeric)) : DEFAULT_SAMPLE_LIMIT;
}

function percentile(sortedValues, ratio) {
	if (sortedValues.length === 0) return 0;
	const index = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.ceil(sortedValues.length * ratio) - 1),
	);
	return sortedValues[index];
}

function summarize(values) {
	if (values.length === 0) {
		return { samples: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
	}

	const sorted = [...values].sort((a, b) => a - b);
	const total = values.reduce((sum, value) => sum + value, 0);
	return {
		samples: values.length,
		meanMs: total / values.length,
		p50Ms: percentile(sorted, 0.5),
		p95Ms: percentile(sorted, 0.95),
		maxMs: sorted[sorted.length - 1],
	};
}

export function configureProfiler(options = {}) {
	if ("enabled" in options) enabled = options.enabled === true;
	if ("sampleLimit" in options) sampleLimit = clampSampleLimit(options.sampleLimit);
	if (typeof options.now === "function") now = options.now;

	if (!enabled) activeFrame = null;
	if (completedFrames.length > sampleLimit) {
		completedFrames = completedFrames.slice(-sampleLimit);
	}
	return getProfilerState();
}

export function getProfilerState() {
	return {
		enabled,
		sampleLimit,
		retainedFrames: completedFrames.length,
		frameActive: activeFrame !== null,
	};
}

export function isProfilerEnabled() {
	return enabled;
}

export function beginProfileFrame(timestamp = null) {
	if (!enabled) return;
	activeFrame = {
		timestamp,
		startedAt: now(),
		durationMs: 0,
		sections: Object.create(null),
		counters: Object.create(null),
	};
}

export function beginProfileSection() {
	return enabled && activeFrame ? now() : null;
}

export function endProfileSection(name, startedAt) {
	if (!enabled || !activeFrame || startedAt === null) return;
	const duration = Math.max(0, now() - startedAt);
	activeFrame.sections[name] = (activeFrame.sections[name] || 0) + duration;
}

export function setProfileCounter(name, value) {
	if (!enabled || !activeFrame) return;
	const numeric = Number(value);
	if (Number.isFinite(numeric)) activeFrame.counters[name] = numeric;
}

export function endProfileFrame() {
	if (!enabled || !activeFrame) return;
	activeFrame.durationMs = Math.max(0, now() - activeFrame.startedAt);
	completedFrames.push(activeFrame);
	if (completedFrames.length > sampleLimit) completedFrames.shift();
	activeFrame = null;
}

export function resetProfiler() {
	activeFrame = null;
	completedFrames = [];
}

export function getProfilerSnapshot() {
	const sectionNames = new Set();
	const counterNames = new Set();
	for (const frame of completedFrames) {
		for (const name of Object.keys(frame.sections)) sectionNames.add(name);
		for (const name of Object.keys(frame.counters)) counterNames.add(name);
	}

	const sections = {};
	for (const name of [...sectionNames].sort()) {
		sections[name] = summarize(
			completedFrames
				.map((frame) => frame.sections[name])
				.filter(Number.isFinite),
		);
	}

	const counters = {};
	for (const name of [...counterNames].sort()) {
		const values = completedFrames
			.map((frame) => frame.counters[name])
			.filter(Number.isFinite);
		counters[name] = {
			samples: values.length,
			mean: values.length > 0
				? values.reduce((sum, value) => sum + value, 0) / values.length
				: 0,
			latest: values.at(-1) ?? 0,
			max: values.length > 0 ? Math.max(...values) : 0,
		};
	}

	return {
		...getProfilerState(),
		frames: summarize(completedFrames.map((frame) => frame.durationMs)),
		sections,
		counters,
	};
}

if (typeof window !== "undefined") {
	window.GameProfiler = Object.freeze({
		enable: (options = {}) => configureProfiler({ ...options, enabled: true }),
		disable: () => configureProfiler({ enabled: false }),
		reset: resetProfiler,
		snapshot: getProfilerSnapshot,
		state: getProfilerState,
	});
}
