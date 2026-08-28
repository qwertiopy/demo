// Target-FPS frame pacing shared by the browser game loop and unit tests.
// This intentionally preserves the main-branch variable-timestep semantics.

// Small tolerance prevents a nominal 60 Hz rAF interval such as 16.66 ms from
// accidentally missing a 16.67 ms target deadline and falling to ~30 FPS.
export const FRAME_PACING_EPSILON_MS = 0.5;

// Caps unexpected stalls while still allowing deliberately low target FPS
// values to use their intended timestep rather than entering slow motion.
export const MAX_DT_SECONDS = 0.05;

export class FramePacer {
	constructor() {
		this.reset();
	}

	reset() {
		this.lastAnimationFrameTime = null;
		this.lastTickTime = null;
		this.tickAccumulatorMs = 0;
		this.targetFrameMs = 0;
		this.tickDurationMs = 0;
		this.dt = 0;
	}

	advanceAnimationFrame(currentTime, targetFps) {
		this.targetFrameMs = 1000 / targetFps;

		if (this.lastAnimationFrameTime === null) {
			this.lastAnimationFrameTime = currentTime;
			// Render immediately on startup rather than waiting one target interval.
			this.tickAccumulatorMs = this.targetFrameMs;
		} else {
			const rafElapsedMs = Math.max(
				0,
				currentTime - this.lastAnimationFrameTime,
			);
			this.lastAnimationFrameTime = currentTime;
			this.tickAccumulatorMs += rafElapsedMs;
		}

		return (
			this.tickAccumulatorMs + FRAME_PACING_EPSILON_MS >=
			this.targetFrameMs
		);
	}

	consumeTick(currentTime) {
		// If we are only fractionally early because of rAF timestamp precision,
		// treat this as the target deadline. Otherwise preserve fractional overshoot
		// so 60 FPS targets schedule correctly even on 120/144 Hz displays.
		if (this.tickAccumulatorMs < this.targetFrameMs) {
			this.tickAccumulatorMs = this.targetFrameMs;
		}
		this.tickAccumulatorMs %= this.targetFrameMs;

		this.tickDurationMs =
			this.lastTickTime === null
				? this.targetFrameMs
				: Math.max(0, currentTime - this.lastTickTime);
		this.lastTickTime = currentTime;

		const maxDtForTarget = Math.max(
			MAX_DT_SECONDS,
			this.targetFrameMs / 1000,
		);
		this.dt = Math.min(
			Math.max(this.tickDurationMs / 1000, 0),
			maxDtForTarget,
		);
	}
}
