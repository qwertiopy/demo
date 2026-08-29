// Live visual trail history and deterministic trail sampling.

import { Config } from "../config.js";
import { ReplayRuntime } from "./runtime.js";

export function getTrailLengthFrames() {
	return Math.max(
		0,
		Math.round(Number(Config.RENDERING.TRAIL_LENGTH_FRAMES) || 0),
	);
}

export function getTrailDetail() {
	return Math.min(
		60,
		Math.max(0, Math.round(Number(Config.RENDERING.TRAIL_DETAIL) || 0)),
	);
}

export function getTrailQuadDetail() {
	return Math.min(
		60,
		Math.max(
			0,
			Math.round(Number(Config.RENDERING.TRAIL_QUAD_DETAIL ?? 30) || 0),
		),
	);
}

// Select exactly `detail` source frames out of each repeating 60-frame
// window. This uses a deterministic distributed/Bresenham-like pattern rather
// than a floating stride. Important examples:
//   detail 60 -> 0,1,2,3,...
//   detail 30 -> 0,2,4,6,...
//   detail 20 -> 0,3,6,9,...
// Non-divisors (e.g. 40) are spread as evenly as possible across all 60.
export function isTrailDetailFrame(frameNumber, detail = getTrailDetail()) {
	const normalizedDetail = Math.min(60, Math.max(0, Math.round(detail || 0)));
	if (normalizedDetail <= 0) return false;
	if (normalizedDetail >= 60) return true;

	const frame = Math.max(0, Math.floor(Number(frameNumber) || 0));
	if (frame === 0) return true;

	return (
		Math.floor((frame * normalizedDetail) / 60) !==
		Math.floor(((frame - 1) * normalizedDetail) / 60)
	);
}

function makeDynamicTrailSnapshot(snapshot) {
	return {
		player: snapshot.player,
		enemies: snapshot.enemies,
		projectiles: snapshot.projectiles,
		projectileTrailEvents: snapshot.projectileTrailEvents || [],
		laserWarmups: snapshot.laserWarmups,
		laserBeams: snapshot.laserBeams,
		explosions: snapshot.explosions,
	};
}

// Keep all source frames inside the configured length window. Trail Detail is
// deliberately applied only when entries are requested: a detail of 30 can
// therefore connect source frame 0 directly to frame 2 without losing the
// ability to change detail at runtime.
export function pushTrailSnapshot(snapshot) {
	const trailLength = getTrailLengthFrames();
	const sequence = ReplayRuntime.liveTrailSequence++;

	if (trailLength <= 0 || (getTrailDetail() <= 0 && getTrailQuadDetail() <= 0)) {
		ReplayRuntime.trailHistory.length = 0;
		return;
	}

	ReplayRuntime.trailHistory.push({
		sequence,
		snapshot: makeDynamicTrailSnapshot(snapshot),
	});
	const maxSnapshots = trailLength + 1;

	if (ReplayRuntime.trailHistory.length > maxSnapshots) {
		ReplayRuntime.trailHistory.splice(
			0,
			ReplayRuntime.trailHistory.length - maxSnapshots,
		);
	}
}

export function clearTrailHistory() {
	ReplayRuntime.trailHistory.length = 0;
	ReplayRuntime.liveTrailSequence = 0;
}

// Returns sampled trail frames oldest -> newest. Trail Detail controls the
// historical samples, but the current source frame is always included as the
// terminal sample. This prevents a visible gap at the head of low-detail trails
// on frames that are intentionally skipped by Trail Detail. Alpha is still based
// on actual source-frame age, not the number of sampled frames.
export function getLiveTrailEntries(
	detail = getTrailDetail(),
	preserveProjectileEvents = true,
) {
	const trailLength = getTrailLengthFrames();
	detail = Math.min(60, Math.max(0, Math.round(Number(detail) || 0)));
	const history = ReplayRuntime.trailHistory;

	if (trailLength <= 0 || detail <= 0 || history.length <= 1) return [];

	const current = history[history.length - 1];
	const entries = [];

	for (const entry of history) {
		const ageFrames = current.sequence - entry.sequence;
		if (ageFrames < 0 || ageFrames > trailLength) continue;
		const hasProjectileTrailEvents =
			preserveProjectileEvents &&
			(entry.snapshot.projectileTrailEvents?.length ?? 0) > 0;
		if (!isTrailDetailFrame(entry.sequence, detail) && !hasProjectileTrailEvents) {
			continue;
		}

		entries.push({
			snapshot: entry.snapshot,
			alpha: Math.max(0, 1 - ageFrames / trailLength),
			frameNumber: entry.sequence,
		});
	}

	// Always terminate the ribbon at the live position. At lower detail the
	// current frame is often intentionally unsampled (e.g. odd frames at 30),
	// which previously left the newest quad missing until the next sample.
	if (entries.at(-1)?.frameNumber !== current.sequence) {
		entries.push({
			snapshot: current.snapshot,
			alpha: 1,
			frameNumber: current.sequence,
		});
	}

	return entries.length >= 2 ? entries : [];
}

