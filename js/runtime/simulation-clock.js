// Authoritative gameplay clock. Wall time only decides whether one nominal
// simulation step is due; elapsed wall-time backlog is deliberately discarded.

export const DEFAULT_SIMULATION_HZ = 60;
const SCHEDULER_EPSILON_MS = 1e-7;

function positiveFinite(value, fallback) {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export class SimulationClock {
	constructor({ hz = DEFAULT_SIMULATION_HZ, startTimeMs = 0 } = {}) {
		this.hz = positiveFinite(hz, DEFAULT_SIMULATION_HZ);
		this.stepMs = 1000 / this.hz;
		this.stepSeconds = this.stepMs / 1000;
		this.timeMs = Math.max(0, Number(startTimeMs) || 0);
		this.tick = 0;
		this.lastWallTimeMs = null;
		// One step is initially due so the first scheduler callback preserves the
		// existing immediate-start behavior. Thereafter, only the fractional phase
		// below one nominal step is retained.
		this.wallAccumulatorMs = this.stepMs;
		this.discardedWallTimeMs = 0;
		this.lastDiscardedWallTimeMs = 0;
		this.delayedCallbacks = 0;
	}

	reset({ startTimeMs = 0, wallTimeMs = null } = {}) {
		this.timeMs = Math.max(0, Number(startTimeMs) || 0);
		this.tick = 0;
		this.discardedWallTimeMs = 0;
		this.lastDiscardedWallTimeMs = 0;
		this.delayedCallbacks = 0;
		this.lastWallTimeMs = Number.isFinite(Number(wallTimeMs))
			? Number(wallTimeMs)
			: null;
		this.wallAccumulatorMs = this.stepMs;
	}

	setRate(hz) {
		const previousStepMs = this.stepMs;
		const phase = previousStepMs > 0
			? this.wallAccumulatorMs / previousStepMs
			: 0;
		this.hz = positiveFinite(hz, this.hz);
		this.stepMs = 1000 / this.hz;
		this.stepSeconds = this.stepMs / 1000;
		// Preserve progress toward the next step when a rate is changed between
		// callbacks. A pending initial step remains pending at the new rate.
		this.wallAccumulatorMs = Math.max(0, phase * this.stepMs);
	}

	// Returns one step descriptor when a tick is due. It never returns multiple
	// steps and never retains debt from missed wall-clock deadlines.
	consumeWallTime(wallTimeMs) {
		const wallNow = Number(wallTimeMs);
		if (!Number.isFinite(wallNow)) return null;

		if (this.lastWallTimeMs === null) {
			this.lastWallTimeMs = wallNow;
		} else {
			const elapsedWallTimeMs = wallNow - this.lastWallTimeMs;
			this.lastWallTimeMs = wallNow;
			if (elapsedWallTimeMs < 0) {
				// requestAnimationFrame timestamps are monotonic. If a different
				// scheduler violates that contract, reset its phase instead of turning
				// the backwards jump into future simulation debt.
				this.wallAccumulatorMs = 0;
				return null;
			}
			this.wallAccumulatorMs += elapsedWallTimeMs;
		}

		const dueSteps = Math.floor(
			(this.wallAccumulatorMs + SCHEDULER_EPSILON_MS) / this.stepMs,
		);
		if (dueSteps < 1) return null;

		const discardedSteps = Math.max(0, dueSteps - 1);
		this.lastDiscardedWallTimeMs = discardedSteps * this.stepMs;
		if (discardedSteps > 0) {
			this.discardedWallTimeMs += this.lastDiscardedWallTimeMs;
			this.delayedCallbacks++;
		}
		// Consume one due step and discard every additional complete overdue step.
		// Keeping the sub-step remainder prevents refresh-rate quantization from
		// slowing a 60 Hz simulation on 75/90/144/165 Hz displays.
		this.wallAccumulatorMs -= dueSteps * this.stepMs;
		if (
			this.wallAccumulatorMs < 0 &&
			this.wallAccumulatorMs > -SCHEDULER_EPSILON_MS
		) {
			this.wallAccumulatorMs = 0;
		}

		this.timeMs += this.stepMs;
		this.tick += 1;
		return {
			tick: this.tick,
			timeMs: this.timeMs,
			dtMs: this.stepMs,
			dtSeconds: this.stepSeconds,
		};
	}

	getMetrics() {
		return {
			tick: this.tick,
			timeMs: this.timeMs,
			discardedWallTimeMs: this.discardedWallTimeMs,
			lastDiscardedWallTimeMs: this.lastDiscardedWallTimeMs,
			delayedCallbacks: this.delayedCallbacks,
		};
	}
}

export function createRenderPacer(startWallTimeMs = null) {
	return {
		lastWallTimeMs: Number.isFinite(Number(startWallTimeMs))
			? Number(startWallTimeMs)
			: null,
		wallAccumulatorMs: 0,
		intervalMs: null,
		renderImmediately: true,
		consume(wallTimeMs, targetFps) {
			const wallNow = Number(wallTimeMs);
			if (!Number.isFinite(wallNow)) return false;
			const intervalMs = 1000 / positiveFinite(targetFps, 60);
			if (this.intervalMs !== null && this.intervalMs !== intervalMs) {
				this.wallAccumulatorMs *= intervalMs / this.intervalMs;
			}
			this.intervalMs = intervalMs;

			if (this.lastWallTimeMs === null) {
				this.lastWallTimeMs = wallNow;
			} else {
				const elapsedWallTimeMs = wallNow - this.lastWallTimeMs;
				this.lastWallTimeMs = wallNow;
				if (elapsedWallTimeMs < 0) {
					this.wallAccumulatorMs = 0;
					this.renderImmediately = false;
					return false;
				}
				this.wallAccumulatorMs += elapsedWallTimeMs;
			}

			if (this.renderImmediately) {
				this.renderImmediately = false;
				const elapsedIntervals = Math.floor(
					(this.wallAccumulatorMs + SCHEDULER_EPSILON_MS) / intervalMs,
				);
				if (elapsedIntervals > 0) {
					this.wallAccumulatorMs -= elapsedIntervals * intervalMs;
					if (
						this.wallAccumulatorMs < 0 &&
						this.wallAccumulatorMs > -SCHEDULER_EPSILON_MS
					) {
						this.wallAccumulatorMs = 0;
					}
				}
				return true;
			}

			const dueRenders = Math.floor(
				(this.wallAccumulatorMs + SCHEDULER_EPSILON_MS) / intervalMs,
			);
			if (dueRenders < 1) return false;
			// Render once and discard complete missed render intervals. Rendering has
			// no gameplay debt, but it retains fractional phase for accurate pacing.
			this.wallAccumulatorMs -= dueRenders * intervalMs;
			if (
				this.wallAccumulatorMs < 0 &&
				this.wallAccumulatorMs > -SCHEDULER_EPSILON_MS
			) {
				this.wallAccumulatorMs = 0;
			}
			return true;
		},
		reset() {
			this.lastWallTimeMs = null;
			this.wallAccumulatorMs = 0;
			this.intervalMs = null;
			this.renderImmediately = true;
		},
	};
}
