// Replay environment revision encoding and hydration.

import { GameState } from "../state.js";
import { ReplayRuntime } from "./runtime.js";

const replayEnvironmentMaps = new WeakMap();
const REPLAY_ENVIRONMENT_KEYFRAME_INTERVAL = 120;

function wallTuple(wall) {
	return [wall.x, wall.y, wall.width, wall.height, wall.color];
}

function wallTupleKey(wall) {
	return JSON.stringify(wall);
}

function countWallTuples(walls) {
	const counts = new Map();
	for (const wall of walls) {
		const key = wallTupleKey(wall);
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return counts;
}

function diffWallTuples(previousWalls, nextWalls) {
	const previousCounts = countWallTuples(previousWalls);
	const nextCounts = countWallTuples(nextWalls);
	const additions = [];
	const removals = [];

	for (const wall of nextWalls) {
		const key = wallTupleKey(wall);
		const remaining = previousCounts.get(key) || 0;
		if (remaining > 0) previousCounts.set(key, remaining - 1);
		else additions.push(wall);
	}

	for (const wall of previousWalls) {
		const key = wallTupleKey(wall);
		const remaining = nextCounts.get(key) || 0;
		if (remaining > 0) nextCounts.set(key, remaining - 1);
		else removals.push(wall);
	}

	return { additions, removals };
}

function decodeWallTuple(wall) {
	return {
		x: wall[0],
		y: wall[1],
		width: wall[2],
		height: wall[3],
		color: wall[4],
	};
}

export function ensureRecordedEnvironment(snapshot) {
	const stateRevision = Number(GameState.environmentRevision) || 0;

	if (
		ReplayRuntime.recordedEnvironments.length > 0 &&
		ReplayRuntime.lastRecordedEnvironmentStateRevision === stateRevision
	) {
		return ReplayRuntime.currentRecordedEnvironmentRevision;
	}

	const nextWalls = (snapshot.walls || []).map(wallTuple);
	const previousWalls = ReplayRuntime.recordedWallTuples || [];
	const { additions, removals } = diffWallTuples(previousWalls, nextWalls);
	ReplayRuntime.lastRecordedEnvironmentStateRevision = stateRevision;

	// Spawn-point changes are debug-only and therefore do not create replay
	// environment revisions when the visible wall geometry is unchanged.
	if (
		ReplayRuntime.recordedEnvironments.length > 0 &&
		additions.length === 0 &&
		removals.length === 0
	) {
		return ReplayRuntime.currentRecordedEnvironmentRevision;
	}

	const revision = ReplayRuntime.recordedEnvironments.length;
	const keyframe =
		revision === 0 || revision % REPLAY_ENVIRONMENT_KEYFRAME_INTERVAL === 0;
	ReplayRuntime.recordedEnvironments.push(
		keyframe
			? { r: revision, k: nextWalls }
			: { r: revision, a: additions, d: removals },
	);
	ReplayRuntime.recordedWallTuples = nextWalls;
	ReplayRuntime.currentRecordedEnvironmentRevision = revision;

	return ReplayRuntime.currentRecordedEnvironmentRevision;
}

function applyWallDelta(previousWalls, additions, removals) {
	const removalCounts = countWallTuples(removals || []);
	const retainedWalls = previousWalls.filter((wall) => {
		const key = wallTupleKey(wall);
		const remaining = removalCounts.get(key) || 0;
		if (remaining <= 0) return true;
		removalCounts.set(key, remaining - 1);
		return false;
	});
	return retainedWalls.concat((additions || []).map((wall) => [...wall]));
}

export function environmentMapForReplay(replay) {
	if (Number(replay?.replayVersion) < 2) return null;

	let environmentMap = replayEnvironmentMaps.get(replay);
	if (!environmentMap) {
		if (Number(replay.replayVersion) >= 3) {
			environmentMap = new Map();
			let walls = [];
			for (const environment of replay.environments || []) {
				if (Array.isArray(environment.k)) {
					walls = environment.k.map((wall) => [...wall]);
				} else {
					walls = applyWallDelta(walls, environment.a, environment.d);
				}
				environmentMap.set(Number(environment.r), {
					revision: Number(environment.r),
					walls: walls.map(decodeWallTuple),
					enemySpawns: [],
				});
			}
		} else {
			environmentMap = new Map(
				(replay.environments || []).map((environment) => [
					Number(environment.revision),
					environment,
				]),
			);
		}
		replayEnvironmentMaps.set(replay, environmentMap);
	}

	return environmentMap;
}

