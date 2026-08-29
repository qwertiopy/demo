// Compact replay frame encoding/decoding.

import { ReplayRuntime } from "./runtime.js";

const replayEntityDefinitionMaps = new WeakMap();

const V3_FRAME = Object.freeze({
	TIME_MS: 0,
	ENVIRONMENT_REVISION: 1,
	CAMERA_X: 2,
	CAMERA_Y: 3,
	ACTIVE_WEAPON_INDEX: 4,
	MAX_DISTANCE: 5,
	PLAYER: 6,
	ENEMIES: 7,
	PROJECTILES: 8,
	PROJECTILE_TRAIL_EVENTS: 9,
	LASER_WARMUPS: 10,
	LASER_BEAMS: 11,
	EXPLOSIONS: 12,
});
let nextRenderId = 1;

function recordedRenderId(renderId) {
	let id = ReplayRuntime.recordedRenderIds.get(renderId);
	if (id === undefined) {
		id = ReplayRuntime.nextRecordedRenderId++;
		ReplayRuntime.recordedRenderIds.set(renderId, id);
	}
	return id;
}

function encodeEnemy(enemy) {
	const id = recordedRenderId(enemy.renderId);
	if (!ReplayRuntime.recordedEnemyDefinitionIds.has(id)) {
		ReplayRuntime.recordedEnemyDefinitionIds.add(id);
		ReplayRuntime.recordedEnemyDefinitions.push([
			id,
			enemy.size,
			enemy.color,
			enemy.maxHp,
		]);
	}
	return [id, enemy.x, enemy.y, enemy.hp];
}

function encodeProjectile(projectile) {
	const id = recordedRenderId(projectile.renderId);
	if (!ReplayRuntime.recordedProjectileDefinitionIds.has(id)) {
		ReplayRuntime.recordedProjectileDefinitionIds.add(id);
		ReplayRuntime.recordedProjectileDefinitions.push([
			id,
			projectile.radius,
			projectile.color,
		]);
	}
	return [id, projectile.x, projectile.y];
}

function encodeLaserWarmup(warmup) {
	const id = recordedRenderId(warmup.renderId);
	if (warmup.type === "cone") {
		return [
			id,
			1,
			warmup.originX,
			warmup.originY,
			warmup.centerAngle,
			warmup.halfAngle,
			warmup.range,
			warmup.color,
			warmup.alpha,
		];
	}

	return [
		id,
		0,
		warmup.x1,
		warmup.y1,
		warmup.x2,
		warmup.y2,
		warmup.color,
		warmup.radius,
		warmup.alpha,
	];
}

function encodeLaserBeam(beam) {
	const id = recordedRenderId(beam.renderId);
	if (beam.type === "cone") {
		return [
			id,
			1,
			(beam.points || []).flatMap((point) => [point.x, point.y]),
			beam.color,
			beam.alpha,
		];
	}

	return [
		id,
		0,
		beam.x1,
		beam.y1,
		beam.x2,
		beam.y2,
		beam.color,
		beam.radius,
		beam.alpha,
	];
}

function encodeExplosion(explosion) {
	return [
		recordedRenderId(explosion.renderId),
		explosion.x,
		explosion.y,
		explosion.radius,
		explosion.color,
	];
}

export function encodeReplayFrame(snapshot, timeMs, environmentRevision) {
	return [
		timeMs,
		environmentRevision,
		snapshot.camera.x,
		snapshot.camera.y,
		snapshot.activeWeaponIndex,
		snapshot.maxDistance,
		[snapshot.player.x, snapshot.player.y, snapshot.player.hp],
		(snapshot.enemies || []).map(encodeEnemy),
		(snapshot.projectiles || []).map(encodeProjectile),
		(snapshot.projectileTrailEvents || []).map(encodeProjectile),
		(snapshot.laserWarmups || []).map(encodeLaserWarmup),
		(snapshot.laserBeams || []).map(encodeLaserBeam),
		(snapshot.explosions || []).map(encodeExplosion),
	];
}


function entityDefinitionMapsForReplay(replay) {
	let maps = replayEntityDefinitionMaps.get(replay);
	if (!maps) {
		maps = {
			enemies: new Map(
				(replay.entityDefinitions?.enemies || []).map((definition) => [
					Number(definition[0]),
					definition,
				]),
			),
			projectiles: new Map(
				(replay.entityDefinitions?.projectiles || []).map((definition) => [
					Number(definition[0]),
					definition,
				]),
			),
		};
		replayEntityDefinitionMaps.set(replay, maps);
	}
	return maps;
}

export function replayFrameTimeMs(replay, frame) {
	return Number(replay?.replayVersion) >= 3
		? Number(frame?.[V3_FRAME.TIME_MS]) || 0
		: Number(frame?.timeMs) || 0;
}

export function replayFrameEnvironmentRevision(replay, frame) {
	return Number(replay?.replayVersion) >= 3
		? Number(frame?.[V3_FRAME.ENVIRONMENT_REVISION])
		: Number(frame?.environmentRevision);
}

function decodeLaserWarmup(warmup) {
	if (warmup[1] === 1) {
		return {
			renderId: warmup[0],
			type: "cone",
			originX: warmup[2],
			originY: warmup[3],
			centerAngle: warmup[4],
			halfAngle: warmup[5],
			range: warmup[6],
			color: warmup[7],
			alpha: warmup[8],
		};
	}

	return {
		renderId: warmup[0],
		type: "beam",
		x1: warmup[2],
		y1: warmup[3],
		x2: warmup[4],
		y2: warmup[5],
		color: warmup[6],
		radius: warmup[7],
		alpha: warmup[8],
	};
}

function decodeLaserBeam(beam) {
	if (beam[1] === 1) {
		const coordinates = beam[2] || [];
		const points = [];
		for (let index = 0; index + 1 < coordinates.length; index += 2) {
			points.push({ x: coordinates[index], y: coordinates[index + 1] });
		}
		return {
			renderId: beam[0],
			type: "cone",
			points,
			color: beam[3],
			alpha: beam[4],
		};
	}

	return {
		renderId: beam[0],
		type: "beam",
		x1: beam[2],
		y1: beam[3],
		x2: beam[4],
		y2: beam[5],
		color: beam[6],
		radius: beam[7],
		alpha: beam[8],
	};
}

export function decodeV3Frame(replay, frame, frameIndex) {
	const definitions = entityDefinitionMapsForReplay(replay);
	const playerStyle = replay.playerStyle || [];
	const viewport = replay.viewport || [];
	const sources = replay.sources || {};
	const playerFrame = frame[V3_FRAME.PLAYER] || [];

	const decodeEnemy = (enemy) => {
		const definition = definitions.enemies.get(Number(enemy[0])) || [];
		return {
			renderId: enemy[0],
			x: enemy[1],
			y: enemy[2],
			size: definition[1],
			color: definition[2],
			hp: enemy[3],
			maxHp: definition[3],
		};
	};
	const decodeProjectile = (projectile) => {
		const definition = definitions.projectiles.get(Number(projectile[0])) || [];
		return {
			renderId: projectile[0],
			x: projectile[1],
			y: projectile[2],
			radius: definition[1],
			color: definition[2],
		};
	};

	return {
		frame: frameIndex,
		timeMs: replayFrameTimeMs(replay, frame),
		environmentRevision: replayFrameEnvironmentRevision(replay, frame),
		camera: {
			x: frame[V3_FRAME.CAMERA_X],
			y: frame[V3_FRAME.CAMERA_Y],
			widthBlocks: viewport[0],
			heightBlocks: viewport[1],
		},
		showEditorHelpers: false,
		activeWeaponIndex: frame[V3_FRAME.ACTIVE_WEAPON_INDEX],
		maxDistance: frame[V3_FRAME.MAX_DISTANCE],
		configSource: sources.config,
		levelSource: sources.level,
		player: {
			renderId: "player",
			x: playerFrame[0],
			y: playerFrame[1],
			size: playerStyle[0],
			color: playerStyle[1],
			hp: playerFrame[2],
			maxHp: playerStyle[2],
		},
		enemies: (frame[V3_FRAME.ENEMIES] || []).map(decodeEnemy),
		projectiles: (frame[V3_FRAME.PROJECTILES] || []).map(decodeProjectile),
		projectileTrailEvents: (
			frame[V3_FRAME.PROJECTILE_TRAIL_EVENTS] || []
		).map(decodeProjectile),
		laserWarmups: (frame[V3_FRAME.LASER_WARMUPS] || []).map(
			decodeLaserWarmup,
		),
		laserBeams: (frame[V3_FRAME.LASER_BEAMS] || []).map(decodeLaserBeam),
		explosions: (frame[V3_FRAME.EXPLOSIONS] || []).map((explosion) => ({
			renderId: explosion[0],
			x: explosion[1],
			y: explosion[2],
			radius: explosion[3],
			color: explosion[4],
		})),
	};
}

