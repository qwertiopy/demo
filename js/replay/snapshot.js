// Render-relevant live snapshot capture.

import { Config } from "../config.js";
import { GameState, player, camera } from "../state.js";

// Stable IDs let consecutive visual snapshots identify the same moving object.
// This is used by trail interpolation and is also serialized into replay files.
const renderIds = new WeakMap();
let nextRenderId = 1;

function getRenderId(object, prefix) {
	if (!object || typeof object !== "object") return null;
	let id = renderIds.get(object);
	if (!id) {
		id = `${prefix}:${nextRenderId++}`;
		renderIds.set(object, id);
	}
	return id;
}

function renderingSnapshot() {
	return {
		CANVAS_WIDTH_PX: Math.max(
			1,
			Math.round(Number(Config.RENDERING.CANVAS_WIDTH_PX) || 1920),
		),
		CANVAS_HEIGHT_PX: Math.max(
			1,
			Math.round(Number(Config.RENDERING.CANVAS_HEIGHT_PX) || 1080),
		),
		BLOCK_SIZE_PX: Math.max(
			1,
			Number(Config.RENDERING.BLOCK_SIZE_PX) || 64,
		),
		ZOOM: Math.max(0.01, Number(Config.RENDERING.ZOOM) || 1),
		TARGET_FPS: Math.max(
			1,
			Math.round(Number(Config.RENDERING.TARGET_FPS ?? 60) || 60),
		),
		ENVIRONMENT_OVERSCAN_BLOCKS: Math.max(
			0,
			Number(Config.RENDERING.ENVIRONMENT_OVERSCAN_BLOCKS) || 0,
		),
		TRAIL_LENGTH_FRAMES: Math.max(
			0,
			Math.round(Number(Config.RENDERING.TRAIL_LENGTH_FRAMES) || 0),
		),
		TRAIL_DETAIL: Math.min(
			60,
			Math.max(0, Math.round(Number(Config.RENDERING.TRAIL_DETAIL) || 0)),
		),
		TRAIL_QUAD_DETAIL: Math.min(
			60,
			Math.max(
				0,
				Math.round(Number(Config.RENDERING.TRAIL_QUAD_DETAIL ?? 30) || 0),
			),
		),
	};
}

function debugSnapshot() {
	const source = Config.DEBUG || {};
	const configuredBudget = Number(source.MAX_DRAWS_PER_FRAME);

	return {
		MAX_DRAWS_PER_FRAME: Number.isFinite(configuredBudget)
			? Math.max(0, Math.floor(configuredBudget))
			: 1000,
		SHOW_FPS: source.SHOW_FPS !== false,
		SHOW_TARGET_FPS: source.SHOW_TARGET_FPS !== false,
		SHOW_MS_PER_TICK: source.SHOW_MS_PER_TICK !== false,
		SHOW_ENTITY_COUNT: source.SHOW_ENTITY_COUNT !== false,
		SHOW_ENEMY_COUNT: source.SHOW_ENEMY_COUNT !== false,
		SHOW_BULLET_COUNT: source.SHOW_BULLET_COUNT !== false,
		DRAW_GRID_COORDINATES: source.DRAW_GRID_COORDINATES !== false,
		DRAW_ENEMY_SPAWNS: source.DRAW_ENEMY_SPAWNS !== false,
		DRAW_ENEMY_AIM_MAXIMUM_CONE:
			source.DRAW_ENEMY_AIM_MAXIMUM_CONE !== false,
		DRAW_ENEMY_AIM_VISIBILITY_REGION:
			source.DRAW_ENEMY_AIM_VISIBILITY_REGION !== false,
		DRAW_ENEMY_AIM_VISIBLE_INTERVAL:
			source.DRAW_ENEMY_AIM_VISIBLE_INTERVAL !== false,
		DRAW_ENEMY_AIM_BOUNDARY_POINTS:
			source.DRAW_ENEMY_AIM_BOUNDARY_POINTS !== false,
		DRAW_ENEMY_AIM_LEAD_ANGLE:
			source.DRAW_ENEMY_AIM_LEAD_ANGLE !== false,
		DRAW_ENEMY_AIM_CACHED_CORNER:
			source.DRAW_ENEMY_AIM_CACHED_CORNER !== false,
	};
}

function captureEnemyAimDebugSnapshot(enemy, debug) {
	const maximumAimInterval =
		debug.DRAW_ENEMY_AIM_MAXIMUM_CONE && enemy.debugMaximumAimInterval
			? {
				originX: enemy.debugMaximumAimInterval.originX,
				originY: enemy.debugMaximumAimInterval.originY,
				minAngle: enemy.debugMaximumAimInterval.minAngle,
				maxAngle: enemy.debugMaximumAimInterval.maxAngle,
			}
			: null;
	const aimVisibilityProfile =
		debug.DRAW_ENEMY_AIM_VISIBILITY_REGION && enemy.debugAimVisibilityProfile
			? {
				originX: enemy.debugAimVisibilityProfile.originX,
				originY: enemy.debugAimVisibilityProfile.originY,
				maxDistance: Number.isFinite(
					enemy.debugAimVisibilityProfile.maxDistance,
				)
					? enemy.debugAimVisibilityProfile.maxDistance
					: 50,
				rays: enemy.debugAimVisibilityProfile.rays.map((ray) => ({
					angle: ray.angle,
					distance: Number.isFinite(ray.distance) ? ray.distance : 50,
					blocked: ray.blocked === true,
				})),
			}
			: null;
	const visibleInterval =
		(debug.DRAW_ENEMY_AIM_VISIBLE_INTERVAL ||
			debug.DRAW_ENEMY_AIM_BOUNDARY_POINTS) &&
		enemy.debugVisibleAimInterval
			? {
				originX: enemy.debugVisibleAimInterval.originX,
				originY: enemy.debugVisibleAimInterval.originY,
				minAngle: enemy.debugVisibleAimInterval.minAngle,
				maxAngle: enemy.debugVisibleAimInterval.maxAngle,
				minBoundaryPoint:
					enemy.debugVisibleAimInterval.minBoundary?.point || null,
				maxBoundaryPoint:
					enemy.debugVisibleAimInterval.maxBoundary?.point || null,
			}
			: null;
	let cachedCornerPoint = null;
	if (debug.DRAW_ENEMY_AIM_CACHED_CORNER) {
		if (
			enemy.lostLosCorner?.source?.kind === "point" ||
			enemy.lostLosCorner?.source?.kind === "rounded-corner-tangent"
		) {
			cachedCornerPoint = {
				x: enemy.lostLosCorner.source.x,
				y: enemy.lostLosCorner.source.y,
			};
		} else {
			cachedCornerPoint = enemy.lostLosCorner?.point || null;
		}
	}

	return {
		originX: Number.isFinite(enemy.debugAimOriginX)
			? enemy.debugAimOriginX
			: enemy.x + enemy.size / 2,
		originY: Number.isFinite(enemy.debugAimOriginY)
			? enemy.debugAimOriginY
			: enemy.y + enemy.size / 2,
		leadAngle:
			debug.DRAW_ENEMY_AIM_LEAD_ANGLE &&
			Number.isFinite(enemy.currentPredictedShotAngle)
				? enemy.currentPredictedShotAngle
				: null,
		maximumAimInterval,
		aimVisibilityProfile,
		visibleInterval,
		distance: Number.isFinite(enemy.debugAimDistance)
			? Math.max(0, enemy.debugAimDistance)
			: 50,
		cachedCornerAngle:
			debug.DRAW_ENEMY_AIM_CACHED_CORNER &&
			Number.isFinite(enemy.lostLosCornerAngle)
				? enemy.lostLosCornerAngle
				: null,
		cachedCornerPoint,
		usingCachedCorner: enemy.debugUsingCachedCorner === true,
	};
}

// Captures render-relevant data for the current frame. Environment arrays are
// referenced directly for live drawing; trail history strips them, and replay
// recording clones them only when GameState.environmentRevision changes.
export function captureVisualSnapshot(currentTime) {
	const rendering = renderingSnapshot();
	const debug = debugSnapshot();
	const captureEnemyAimDebug =
		GameState.showEditorHelpers &&
		debug.MAX_DRAWS_PER_FRAME > 0 &&
		(
			debug.DRAW_ENEMY_AIM_MAXIMUM_CONE ||
			debug.DRAW_ENEMY_AIM_VISIBILITY_REGION ||
			debug.DRAW_ENEMY_AIM_VISIBLE_INTERVAL ||
			debug.DRAW_ENEMY_AIM_BOUNDARY_POINTS ||
			debug.DRAW_ENEMY_AIM_LEAD_ANGLE ||
			debug.DRAW_ENEMY_AIM_CACHED_CORNER
		);

	return {
		rendering,
		debug,
		camera: {
			x: camera.x,
			y: camera.y,
			widthBlocks: camera.widthBlocks,
			heightBlocks: camera.heightBlocks,
		},
		showEditorHelpers: GameState.showEditorHelpers,
		activeWeaponIndex: GameState.activeWeaponIndex,
		maxDistance: GameState.MaxDistance,
		configSource: GameState.configSource,
		levelSource: GameState.levelSource,
		walls: GameState.walls,
		enemySpawns: GameState.enemySpawns,
		player: {
			renderId: "player",
			x: player.x,
			y: player.y,
			size: player.size,
			color: player.color,
			hp: player.hp,
			maxHp: player.maxHp,
		},
		enemies: GameState.enemies.map((enemy) => ({
			renderId: getRenderId(enemy, "enemy"),
			x: enemy.x,
			y: enemy.y,
			size: enemy.size,
			color: enemy.color,
			hp: enemy.hp,
			maxHp: enemy.maxHp,
			aimDebug: captureEnemyAimDebug
				? captureEnemyAimDebugSnapshot(enemy, debug)
				: null,
		})),
		projectiles: GameState.projectiles
			.filter((projectile) => !projectile.removedByProjectileCap)
			.map(
			(projectile) => ({
				renderId: getRenderId(projectile, "projectile"),
				x: projectile.x,
				y: projectile.y,
				radius: projectile.radius,
				color: projectile.color,
			}),
			),
		projectileTrailEvents: (GameState.projectileTrailEvents || []).map(
			(event) => ({
				renderId: getRenderId(event.projectile, "projectile"),
				x: event.x,
				y: event.y,
				radius: event.radius,
				color: event.color,
			}),
		),
		laserWarmups: GameState.laserWarmups.map((shot) => {
			const originX = shot.shooter.x + shot.shooter.size / 2;
			const originY = shot.shooter.y + shot.shooter.size / 2;
			const elapsed = Math.max(0, currentTime - shot.startedAt);
			const duration = Math.max(1, shot.fireAt - shot.startedAt);
			const progress = Math.min(1, elapsed / duration);
			const radius = Math.max(
				0.015,
				Number(shot.stats.radiusBlocks ?? 0.03) || 0.03,
			);
			const alpha = 0.16 + progress * 0.34;

			if ((shot.coneHalfAngle ?? 0) > 0) {
				return {
					renderId: getRenderId(shot, "laser-warmup"),
					type: "cone",
					originX,
					originY,
					centerAngle: shot.centerAngle,
					halfAngle: shot.coneHalfAngle,
					range: Math.max(0, Number(shot.telegraphRangeBlocks) || 0),
					color: shot.stats.color ?? "white",
					alpha,
				};
			}

			return {
				renderId: getRenderId(shot, "laser-warmup"),
				type: "beam",
				x1: originX,
				y1: originY,
				x2: originX + shot.dirX * Math.max(0, Number(shot.telegraphRangeBlocks) || 0),
				y2: originY + shot.dirY * Math.max(0, Number(shot.telegraphRangeBlocks) || 0),
				color: shot.stats.color ?? "white",
				radius,
				alpha,
			};
		}),
		laserBeams: GameState.laserBeams.map((beam) => {
			const age = Math.max(0, currentTime - beam.createdAt);
			const alpha = Math.max(
				0,
				1 - age / Math.max(1, Number(beam.durationMs) || 1),
			);

			if (beam.type === "cone") {
				return {
					renderId: getRenderId(beam, "laser-beam"),
					type: "cone",
					points: (beam.points || []).map((point) => ({
						x: point.x,
						y: point.y,
					})),
					color: beam.color,
					alpha,
				};
			}

			return {
				renderId: getRenderId(beam, "laser-beam"),
				type: "beam",
				x1: beam.x1,
				y1: beam.y1,
				x2: beam.x2,
				y2: beam.y2,
				color: beam.color,
				radius: beam.radius,
				alpha,
			};
		}),
		explosions: GameState.explosions.map((explosion) => ({
			renderId: getRenderId(explosion, "explosion"),
			x: explosion.x,
			y: explosion.y,
			radius: explosion.radius,
			color: explosion.color,
		})),
	};
}

