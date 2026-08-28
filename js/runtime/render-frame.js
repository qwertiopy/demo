// Snapshot/replay/render orchestration for one completed simulation tick.

import { GameState } from "../state.js";
import { draw } from "../render.js";
import {
	captureVisualSnapshot,
	pushTrailSnapshot,
	getLiveTrailEntries,
	getTrailQuadDetail,
	recordReplaySnapshot,
} from "../replay.js";
import {
	beginProfileSection,
	endProfileSection,
	setProfileCounter,
} from "../performance/profiler.js";

export function renderGameFrame(currentTime) {
	setProfileCounter("enemies", GameState.enemies.length);
	setProfileCounter("projectiles", GameState.projectiles.length);
	setProfileCounter("walls", GameState.walls.length);

	const snapshotProfile = beginProfileSection();
	const snapshot = captureVisualSnapshot(currentTime);
	pushTrailSnapshot(snapshot);
	recordReplaySnapshot(snapshot, currentTime);
	endProfileSection("snapshot-replay", snapshotProfile);

	const renderProfile = beginProfileSection();
	draw(snapshot, getLiveTrailEntries(), {
		quadTrailEntries: getLiveTrailEntries(getTrailQuadDetail(), false),
	});
	endProfileSection("render", renderProfile);
}
