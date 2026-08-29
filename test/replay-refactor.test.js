import assert from "node:assert/strict";
import test from "node:test";

const elements = new Map();
function element(id) {
	if (!elements.has(id)) {
		elements.set(id, {
			id,
			disabled: false,
			textContent: "",
			addEventListener() {},
			getContext() { return {}; },
		});
	}
	return elements.get(id);
}

globalThis.document = {
	getElementById(id) {
		return element(id);
	},
};

const replayFacade = await import("../js/replay.js");
const replayIndex = await import("../js/replay/index.js");
const replayCodec = await import("../js/replay/codec.js");
const { Config } = await import("../js/config.js");
const { GameState, player, camera } = await import("../js/state.js");
const { ReplayRuntime } = await import("../js/replay/runtime.js");

function resetReplayRuntime() {
	Object.assign(ReplayRuntime, {
		recording: false,
		recordingStartedAt: null,
		recordedFrames: [],
		recordedRendering: null,
		recordedViewport: null,
		recordedPlayerStyle: null,
		recordedSources: null,
		recordedEnvironments: [],
		recordedWallTuples: null,
		lastRecordedEnvironmentStateRevision: null,
		currentRecordedEnvironmentRevision: -1,
		recordedRenderIds: new Map(),
		nextRecordedRenderId: 1,
		recordedEnemyDefinitions: [],
		recordedEnemyDefinitionIds: new Set(),
		recordedProjectileDefinitions: [],
		recordedProjectileDefinitionIds: new Set(),
		loadedReplay: null,
		playbackActive: false,
		playbackPlaying: false,
		playbackFrameIndex: 0,
		playbackStartedAt: 0,
		playbackBaseTimeMs: 0,
		playbackSpeed: 1,
		trailHistory: [],
		liveTrailSequence: 0,
		playbackHydratedReplay: null,
		playbackHydratedFrameIndex: -1,
		playbackHydratedSnapshot: null,
	});
	GameState.pressedInputs.clear();
}

function compactReplay() {
	return {
		replayVersion: 3,
		rendering: { TARGET_FPS: 60 },
		viewport: [30, 16.875],
		playerStyle: [0.5, "royalblue", 10],
		sources: { config: "session", level: "session" },
		entityDefinitions: { enemies: [], projectiles: [] },
		environments: [
			{ r: 0, k: [[1, 2, 3, 4, "gray"]] },
		],
		frames: [
			[0, 0, 0, 0, 0, -1, [1, 2, 10], [], [], [], [], [], []],
			[100, 0, 2, 0, 0, -1, [2, 2, 9], [], [], [], [], [], []],
		],
	};
}

test("replay facade preserves the established public exports", () => {
	for (const name of [
		"captureVisualSnapshot",
		"pushTrailSnapshot",
		"getLiveTrailEntries",
		"startReplayRecording",
		"recordReplaySnapshot",
		"loadReplayData",
		"startOrResumeReplayPlayback",
		"getReplaySnapshotForRender",
		"getReplayTrailEntries",
		"initReplayControls",
	]) {
		assert.equal(replayFacade[name], replayIndex[name]);
	}
});

test("snapshot capture preserves live environment references and detached dynamic actor values", () => {
	resetReplayRuntime();
	Object.assign(camera, { x: 4, y: 5, widthBlocks: 30, heightBlocks: 16.875 });
	Object.assign(player, { x: 1, y: 2, size: 0.5, color: "royalblue", hp: 8, maxHp: 10 });
	GameState.walls = [{ x: 10, y: 0, width: 1, height: 1, color: "gray" }];
	GameState.enemySpawns = [{ x: 12, y: 1 }];
	GameState.enemies = [{ x: 3, y: 4, size: 0.5, color: "red", hp: 2, maxHp: 3 }];
	GameState.projectiles = [];
	GameState.projectileTrailEvents = [];
	GameState.laserWarmups = [];
	GameState.laserBeams = [];
	GameState.explosions = [];
	GameState.showEditorHelpers = false;

	const snapshot = replayFacade.captureVisualSnapshot(50);
	const firstEnemyRenderId = snapshot.enemies[0].renderId;
	assert.equal(snapshot.walls, GameState.walls);
	assert.equal(snapshot.enemySpawns, GameState.enemySpawns);

	GameState.enemies[0].x = 99;
	assert.equal(snapshot.enemies[0].x, 3);
	assert.equal(replayFacade.captureVisualSnapshot(51).enemies[0].renderId, firstEnemyRenderId);
});

test("live trails preserve deterministic detail sampling and always include the current source frame", () => {
	resetReplayRuntime();
	const previousLength = Config.RENDERING.TRAIL_LENGTH_FRAMES;
	const previousDetail = Config.RENDERING.TRAIL_DETAIL;
	const previousQuadDetail = Config.RENDERING.TRAIL_QUAD_DETAIL;
	Config.RENDERING.TRAIL_LENGTH_FRAMES = 3;
	Config.RENDERING.TRAIL_DETAIL = 30;
	Config.RENDERING.TRAIL_QUAD_DETAIL = 0;

	try {
		for (let frame = 0; frame < 4; frame++) {
			replayFacade.pushTrailSnapshot({
				player: { x: frame },
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [],
				laserWarmups: [],
				laserBeams: [],
				explosions: [],
			});
		}
		const entries = replayFacade.getLiveTrailEntries(30, true);
		assert.deepEqual(entries.map((entry) => entry.frameNumber), [0, 2, 3]);
		assert.equal(entries[0].alpha, 0);
		assert.ok(Math.abs(entries[1].alpha - (2 / 3)) < 1e-12);
		assert.equal(entries[2].alpha, 1);
	} finally {
		Config.RENDERING.TRAIL_LENGTH_FRAMES = previousLength;
		Config.RENDERING.TRAIL_DETAIL = previousDetail;
		Config.RENDERING.TRAIL_QUAD_DETAIL = previousQuadDetail;
		replayFacade.clearTrailHistory();
	}
});

test("recording preserves wall-only environment revisions and compact frame revision references", () => {
	resetReplayRuntime();
	GameState.environmentRevision = 10;
	GameState.levelSeed = 123;
	GameState.gameModeId = "sandbox";

	const baseSnapshot = {
		rendering: { TARGET_FPS: 60 },
		camera: { x: 0, y: 0, widthBlocks: 30, heightBlocks: 16.875 },
		activeWeaponIndex: 0,
		maxDistance: -1,
		configSource: "session",
		levelSource: "session",
		walls: [{ x: 0, y: 0, width: 1, height: 1, color: "gray" }],
		enemySpawns: [],
		player: { x: 0, y: 0, size: 0.5, color: "blue", hp: 10, maxHp: 10 },
		enemies: [],
		projectiles: [],
		projectileTrailEvents: [],
		laserWarmups: [],
		laserBeams: [],
		explosions: [],
	};

	assert.equal(replayFacade.startReplayRecording(), true);
	replayFacade.recordReplaySnapshot(baseSnapshot, 1000);

	GameState.environmentRevision = 11;
	replayFacade.recordReplaySnapshot({ ...baseSnapshot, enemySpawns: [{ x: 2, y: 2 }] }, 1016);

	GameState.environmentRevision = 12;
	replayFacade.recordReplaySnapshot({
		...baseSnapshot,
		walls: baseSnapshot.walls.concat({ x: 2, y: 0, width: 1, height: 1, color: "gray" }),
	}, 1032);

	assert.equal(ReplayRuntime.recordedEnvironments.length, 2);
	assert.deepEqual(
		ReplayRuntime.recordedFrames.map((frame) => frame[1]),
		[0, 0, 1],
	);
	assert.ok(Array.isArray(ReplayRuntime.recordedEnvironments[0].k));
	assert.ok(Array.isArray(ReplayRuntime.recordedEnvironments[1].a));
});

test("compact replay playback remains timestamp-driven and hydrates the recorded environment", () => {
	resetReplayRuntime();
	const replay = compactReplay();
	replayFacade.loadReplayData(replay);
	assert.equal(replayFacade.startOrResumeReplayPlayback(1000), true);

	const first = replayFacade.getReplaySnapshotForRender(1050);
	assert.equal(first.frame, 0);
	assert.equal(first.player.x, 1);
	assert.deepEqual(first.walls, [{ x: 1, y: 2, width: 3, height: 4, color: "gray" }]);

	const second = replayFacade.getReplaySnapshotForRender(1100);
	assert.equal(second.frame, 1);
	assert.equal(second.player.x, 2);
	assert.equal(replayFacade.getReplayPlaybackState(1100).playbackPlaying, false);
});


test("compact replay preserves projectile checkpoint markers without changing legacy trail events", () => {
	resetReplayRuntime();
	const snapshot = {
		camera: { x: 0, y: 0 },
		activeWeaponIndex: 0,
		maxDistance: -1,
		player: { x: 0, y: 0, hp: 10 },
		enemies: [],
		projectiles: [],
		projectileTrailEvents: [
			{ renderId: "p1", x: 1, y: 2, radius: 0.25, color: "red" },
			{ renderId: "p1", x: 3, y: 4, radius: 0.25, color: "red", checkpoint: true },
		],
		laserWarmups: [],
		laserBeams: [],
		explosions: [],
	};

	const frame = replayCodec.encodeReplayFrame(snapshot, 10, 0);
	const replay = {
		replayVersion: 3,
		viewport: [30, 16.875],
		playerStyle: [0.5, "blue", 10],
		sources: {},
		entityDefinitions: {
			enemies: [],
			projectiles: ReplayRuntime.recordedProjectileDefinitions,
		},
	};
	const decoded = replayCodec.decodeV3Frame(replay, frame, 0);

	assert.equal(decoded.projectileTrailEvents[0].checkpoint, undefined);
	assert.equal(decoded.projectileTrailEvents[1].checkpoint, true);
});
