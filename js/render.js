// Rendering from JSON-safe visual snapshots. The same renderer is used by live
// gameplay, trails, and replay playback.

import { Config } from "./config.js";
import { canvas, ctx, respawnBtn } from "./dom.js";

const DEFAULT_MAX_DEBUG_DRAWS_PER_FRAME = 1000;
let debugDrawBudgetRemaining = 0;

function normalizedDebugSettings(snapshot) {
	const source = snapshot?.debug || Config.DEBUG || {};
	const configuredBudget = Number(source.MAX_DRAWS_PER_FRAME);

	return {
		MAX_DRAWS_PER_FRAME: Number.isFinite(configuredBudget)
			? Math.max(0, Math.floor(configuredBudget))
			: DEFAULT_MAX_DEBUG_DRAWS_PER_FRAME,
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

function resetDebugDrawBudget(snapshot, debug) {
	debugDrawBudgetRemaining = snapshot.showEditorHelpers
		? debug.MAX_DRAWS_PER_FRAME
		: 0;
}

function consumeDebugDrawBudget(cost = 1) {
	const normalizedCost = Math.max(0, Math.floor(Number(cost) || 0));
	if (normalizedCost > debugDrawBudgetRemaining) return false;
	debugDrawBudgetRemaining -= normalizedCost;
	return true;
}

function normalizedRendering(snapshot) {
	const source = snapshot?.rendering || Config.RENDERING || {};
	return {
		CANVAS_WIDTH_PX: Math.max(
			1,
			Math.round(Number(source.CANVAS_WIDTH_PX) || 1920),
		),
		CANVAS_HEIGHT_PX: Math.max(
			1,
			Math.round(Number(source.CANVAS_HEIGHT_PX) || 1080),
		),
		BLOCK_SIZE_PX: Math.max(1, Number(source.BLOCK_SIZE_PX) || 64),
		ZOOM: Math.max(0.01, Number(source.ZOOM) || 1),
		ENVIRONMENT_OVERSCAN_BLOCKS: Math.max(
			0,
			Number(source.ENVIRONMENT_OVERSCAN_BLOCKS) || 0,
		),
	};
}

function syncCanvasToSnapshot(rendering) {
	if (canvas.width !== rendering.CANVAS_WIDTH_PX) {
		canvas.width = rendering.CANVAS_WIDTH_PX;
	}
	if (canvas.height !== rendering.CANVAS_HEIGHT_PX) {
		canvas.height = rendering.CANVAS_HEIGHT_PX;
	}
	canvas.style.aspectRatio = `${rendering.CANVAS_WIDTH_PX} / ${rendering.CANVAS_HEIGHT_PX}`;
}

// Draws the checker/grid world background and optional enemy-spawn debug markers
// for a supplied snapshot.
export function drawProceduralEnvironment(
	snapshot,
	rendering,
	debug = normalizedDebugSettings(snapshot),
) {
	const blockSizePx = rendering.BLOCK_SIZE_PX;
	const snapshotCamera = snapshot.camera;
	const overscan = rendering.ENVIRONMENT_OVERSCAN_BLOCKS;
	const startX = Math.floor(snapshotCamera.x);
	const endX = startX + snapshotCamera.widthBlocks + overscan;
	const startY = Math.floor(snapshotCamera.y);
	const endY = startY + snapshotCamera.heightBlocks + overscan;

	ctx.lineWidth = 1;

	for (let x = startX; x < endX; x++) {
		for (let y = startY; y < endY; y++) {
			const px = x * blockSizePx;
			const py = y * blockSizePx;

			ctx.fillStyle = Math.abs(x + y) % 2 === 0 ? "#111111" : "#1a1a1a";
			ctx.fillRect(px, py, blockSizePx, blockSizePx);

			ctx.strokeStyle = "#222222";
			ctx.strokeRect(px, py, blockSizePx, blockSizePx);

			if (
				snapshot.showEditorHelpers &&
				debug.DRAW_GRID_COORDINATES &&
				consumeDebugDrawBudget()
			) {
				ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
				ctx.font = "10px monospace";
				ctx.fillText(`${x},${y}`, px + 4, py + 14);
			}
		}
	}

	if (!snapshot.showEditorHelpers || !debug.DRAW_ENEMY_SPAWNS) return;

	for (const spawn of snapshot.enemySpawns || []) {
		// One unit each for the outline, fill, and label. Skip the whole marker if the
		// shared budget cannot afford a complete representation.
		if (!consumeDebugDrawBudget(3)) break;
		const renderSizePx = (spawn.size || 0.5) * blockSizePx;
		const px = spawn.x * blockSizePx;
		const py = spawn.y * blockSizePx;

		ctx.strokeStyle = "cyan";
		ctx.lineWidth = 2;
		ctx.strokeRect(px, py, renderSizePx, renderSizePx);

		ctx.fillStyle = "rgba(0, 255, 255, 0.2)";
		ctx.fillRect(px, py, renderSizePx, renderSizePx);

		ctx.fillStyle = "cyan";
		ctx.font = "10px monospace";
		ctx.fillText(`SPAWN: ${spawn.type}`, px, py - 4);
	}
}

// Draws a black health-bar background followed by a colored bar proportional to current HP.
export function drawHealthBar(x, y, width, hp, maxHp, color) {
	ctx.fillStyle = "black";
	ctx.fillRect(x, y, width, 5);

	ctx.fillStyle = color;
	ctx.fillRect(x, y, width * (hp / Math.max(1, maxHp)), 5);
}

function drawWalls(snapshot, rendering) {
	const blockSizePx = rendering.BLOCK_SIZE_PX;
	for (const wall of snapshot.walls || []) {
		ctx.fillStyle = wall.color;
		ctx.fillRect(
			wall.x * blockSizePx,
			wall.y * blockSizePx,
			wall.width * blockSizePx,
			wall.height * blockSizePx,
		);
	}
}

function drawActor(actor, blockSizePx, healthColor, includeUi) {
	if (!actor || actor.hp <= 0) return;

	const px = actor.x * blockSizePx;
	const py = actor.y * blockSizePx;
	const sizePx = actor.size * blockSizePx;

	ctx.fillStyle = actor.color;
	ctx.fillRect(px, py, sizePx, sizePx);

	if (includeUi) {
		drawHealthBar(px, py - 10, sizePx, actor.hp, actor.maxHp, healthColor);
	}
}

function drawEnemyAimDebug(enemy, blockSizePx, settings) {
	const debug = enemy?.aimDebug;
	if (!debug) return;

	const originBlocksX = Number.isFinite(debug.originX)
		? debug.originX
		: enemy.x + enemy.size / 2;
	const originBlocksY = Number.isFinite(debug.originY)
		? debug.originY
		: enemy.y + enemy.size / 2;
	const originX = originBlocksX * blockSizePx;
	const originY = originBlocksY * blockSizePx;
	const distanceBlocks = Math.max(
		3,
		Math.min(50, Number(debug.distance) || 0),
	);
	const distancePx = distanceBlocks * blockSizePx;
	const maximumInterval = debug.maximumAimInterval;
	const visibilityProfile = debug.aimVisibilityProfile;
	const interval = debug.visibleInterval;
	const intervalColor = debug.usingCachedCorner
		? "rgba(255, 170, 0, 0.9)"
		: "rgba(0, 255, 255, 0.9)";
	const intervalFill = debug.usingCachedCorner
		? "rgba(255, 170, 0, 0.08)"
		: "rgba(0, 255, 255, 0.08)";

	ctx.save();

	// Draw the projectile-speed limit first so the wall-clipped visible region
	// remains legible as the more specific interval on top of it.
	if (
		settings.DRAW_ENEMY_AIM_MAXIMUM_CONE &&
		maximumInterval &&
		Number.isFinite(maximumInterval.minAngle) &&
		Number.isFinite(maximumInterval.maxAngle) &&
		consumeDebugDrawBudget(3)
	) {
		ctx.fillStyle = "rgba(120, 160, 255, 0.05)";
		ctx.beginPath();
		ctx.moveTo(originX, originY);
		ctx.arc(
			originX,
			originY,
			distancePx,
			maximumInterval.minAngle,
			maximumInterval.maxAngle,
		);
		ctx.closePath();
		ctx.fill();

		ctx.strokeStyle = "rgba(120, 160, 255, 0.65)";
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 5]);
		for (const angle of [
			maximumInterval.minAngle,
			maximumInterval.maxAngle,
		]) {
			ctx.beginPath();
			ctx.moveTo(originX, originY);
			ctx.lineTo(
				originX + Math.cos(angle) * distancePx,
				originY + Math.sin(angle) * distancePx,
			);
			ctx.stroke();
		}
	}

	let visibilityProfileDrawn = false;
	if (
		settings.DRAW_ENEMY_AIM_VISIBILITY_REGION &&
		visibilityProfile?.rays?.length >= 2 &&
		consumeDebugDrawBudget(visibilityProfile.rays.length + 2)
	) {
		const profilePoints = visibilityProfile.rays.map((ray) => {
			const rayDistance = Number.isFinite(ray.distance)
				? Math.max(0, Math.min(distanceBlocks, ray.distance))
				: distanceBlocks;
			return {
				angle: ray.angle,
				distance: rayDistance,
				reachesOuter:
					rayDistance >= distanceBlocks - 1e-7,
			};
		});

		ctx.fillStyle = intervalFill;
		ctx.strokeStyle = intervalColor;
		ctx.lineWidth = 1.5;
		ctx.setLineDash(debug.usingCachedCorner ? [8, 6] : []);
		ctx.beginPath();
		ctx.moveTo(originX, originY);

		for (let index = 0; index < profilePoints.length; index++) {
			const point = profilePoints[index];
			const pointDistancePx = point.distance * blockSizePx;
			if (
				index > 0 &&
				profilePoints[index - 1].reachesOuter &&
				point.reachesOuter
			) {
				ctx.arc(
					originX,
					originY,
					distancePx,
					profilePoints[index - 1].angle,
					point.angle,
				);
			} else {
				ctx.lineTo(
					originX + Math.cos(point.angle) * pointDistancePx,
					originY + Math.sin(point.angle) * pointDistancePx,
				);
			}
		}

		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		visibilityProfileDrawn = true;
	}

	const hasVisibleInterval =
		interval &&
		Number.isFinite(interval.minAngle) &&
		Number.isFinite(interval.maxAngle);
	if (
		settings.DRAW_ENEMY_AIM_VISIBLE_INTERVAL &&
		hasVisibleInterval &&
		consumeDebugDrawBudget(visibilityProfileDrawn ? 2 : 3)
	) {
		if (!visibilityProfileDrawn) {
			ctx.fillStyle = intervalFill;
			ctx.beginPath();
			ctx.moveTo(originX, originY);
			ctx.arc(
				originX,
				originY,
				distancePx,
				interval.minAngle,
				interval.maxAngle,
			);
			ctx.closePath();
			ctx.fill();
		}

		ctx.strokeStyle = intervalColor;
		ctx.lineWidth = 1.5;
		ctx.setLineDash(debug.usingCachedCorner ? [8, 6] : []);
		for (const angle of [interval.minAngle, interval.maxAngle]) {
			ctx.beginPath();
			ctx.moveTo(originX, originY);
			ctx.lineTo(
				originX + Math.cos(angle) * distancePx,
				originY + Math.sin(angle) * distancePx,
			);
			ctx.stroke();
		}
	}

	if (
		settings.DRAW_ENEMY_AIM_BOUNDARY_POINTS &&
		hasVisibleInterval
	) {
		ctx.setLineDash([]);
		ctx.fillStyle = intervalColor;
		for (const point of [
			interval.minBoundaryPoint,
			interval.maxBoundaryPoint,
		]) {
			if (
				!Number.isFinite(point?.x) ||
				!Number.isFinite(point?.y) ||
				!consumeDebugDrawBudget()
			) {
				continue;
			}
			ctx.beginPath();
			ctx.arc(
				point.x * blockSizePx,
				point.y * blockSizePx,
				3,
				0,
				Math.PI * 2,
			);
			ctx.fill();
		}
	}

	if (
		settings.DRAW_ENEMY_AIM_LEAD_ANGLE &&
		Number.isFinite(debug.leadAngle) &&
		consumeDebugDrawBudget()
	) {
		ctx.setLineDash([4, 4]);
		ctx.strokeStyle = "rgba(255, 0, 255, 0.95)";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(originX, originY);
		ctx.lineTo(
			originX + Math.cos(debug.leadAngle) * distancePx,
			originY + Math.sin(debug.leadAngle) * distancePx,
		);
		ctx.stroke();
	}

	if (
		settings.DRAW_ENEMY_AIM_CACHED_CORNER &&
		debug.usingCachedCorner &&
		Number.isFinite(debug.cachedCornerAngle) &&
		consumeDebugDrawBudget()
	) {
		ctx.setLineDash([]);
		ctx.strokeStyle = "rgba(255, 170, 0, 1)";
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(originX, originY);
		ctx.lineTo(
			originX + Math.cos(debug.cachedCornerAngle) * distancePx,
			originY + Math.sin(debug.cachedCornerAngle) * distancePx,
		);
		ctx.stroke();

		if (
			Number.isFinite(debug.cachedCornerPoint?.x) &&
			Number.isFinite(debug.cachedCornerPoint?.y) &&
			consumeDebugDrawBudget()
		) {
			ctx.fillStyle = "rgba(255, 170, 0, 1)";
			ctx.beginPath();
			ctx.arc(
				debug.cachedCornerPoint.x * blockSizePx,
				debug.cachedCornerPoint.y * blockSizePx,
				4,
				0,
				Math.PI * 2,
			);
			ctx.fill();
		}
	}

	ctx.restore();
}

function drawProjectile(projectile, blockSizePx) {
	ctx.beginPath();
	ctx.arc(
		projectile.x * blockSizePx,
		projectile.y * blockSizePx,
		projectile.radius * blockSizePx,
		0,
		Math.PI * 2,
	);
	ctx.fillStyle = projectile.color;
	ctx.fill();
	ctx.closePath();
}

function drawLaserWarmup(warmup, blockSizePx, alphaMultiplier) {
	ctx.save();
	ctx.globalAlpha =
		alphaMultiplier * Math.min(1, Math.max(0, Number(warmup.alpha) || 0));

	if (warmup.type === "cone") {
		const originX = warmup.originX * blockSizePx;
		const originY = warmup.originY * blockSizePx;
		const range = Math.max(0, Number(warmup.range) || 0) * blockSizePx;
		const halfAngle = Math.max(0, Number(warmup.halfAngle) || 0);
		ctx.fillStyle = warmup.color;
		ctx.beginPath();

		if (halfAngle >= Math.PI - 1e-9) {
			ctx.arc(originX, originY, range, 0, Math.PI * 2);
		} else {
			ctx.moveTo(originX, originY);
			ctx.arc(
				originX,
				originY,
				range,
				warmup.centerAngle - halfAngle,
				warmup.centerAngle + halfAngle,
			);
			ctx.closePath();
		}

		ctx.fill();
		ctx.restore();
		return;
	}

	ctx.strokeStyle = warmup.color;
	ctx.lineWidth = Math.max(1, warmup.radius * 2 * blockSizePx);
	ctx.setLineDash([6, 8]);
	ctx.beginPath();
	ctx.moveTo(warmup.x1 * blockSizePx, warmup.y1 * blockSizePx);
	ctx.lineTo(warmup.x2 * blockSizePx, warmup.y2 * blockSizePx);
	ctx.stroke();
	ctx.restore();
}

function drawLaserBeam(beam, blockSizePx, alphaMultiplier) {
	ctx.save();
	ctx.globalAlpha =
		alphaMultiplier * Math.min(1, Math.max(0, Number(beam.alpha) || 0));

	if (beam.type === "cone") {
		const points = beam.points || [];
		if (points.length >= 3) {
			ctx.fillStyle = beam.color;
			ctx.beginPath();
			ctx.moveTo(points[0].x * blockSizePx, points[0].y * blockSizePx);
			for (let i = 1; i < points.length; i++) {
				ctx.lineTo(points[i].x * blockSizePx, points[i].y * blockSizePx);
			}
			ctx.closePath();
			ctx.fill();
		}
		ctx.restore();
		return;
	}

	ctx.strokeStyle = beam.color;
	ctx.lineWidth = Math.max(2, beam.radius * 2 * blockSizePx);
	ctx.beginPath();
	ctx.moveTo(beam.x1 * blockSizePx, beam.y1 * blockSizePx);
	ctx.lineTo(beam.x2 * blockSizePx, beam.y2 * blockSizePx);
	ctx.stroke();
	ctx.restore();
}

function drawExplosion(explosion, blockSizePx, alphaMultiplier) {
	ctx.save();
	ctx.globalAlpha = alphaMultiplier * 0.28;
	ctx.fillStyle = explosion.color;
	ctx.beginPath();
	ctx.arc(
		explosion.x * blockSizePx,
		explosion.y * blockSizePx,
		explosion.radius * blockSizePx,
		0,
		Math.PI * 2,
	);
	ctx.fill();

	ctx.globalAlpha = alphaMultiplier * 0.9;
	ctx.strokeStyle = explosion.color;
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.restore();
}

// Draws only the dynamic part of a snapshot. Trail rendering passes
// includeUi=false so health bars and every other UI layer are rendered only for
// the current frame, never repeated into the trail history.
export function drawDynamicSnapshot(
	snapshot,
	rendering,
	alphaMultiplier = 1,
	{
		includeUi = true,
		debug = normalizedDebugSettings(snapshot),
	} = {},
) {
	const alpha = Math.min(1, Math.max(0, Number(alphaMultiplier) || 0));
	if (alpha <= 0) return;

	const blockSizePx = rendering.BLOCK_SIZE_PX;
	ctx.save();
	ctx.globalAlpha = alpha;

	if (includeUi && snapshot.showEditorHelpers) {
		for (const enemy of snapshot.enemies || []) {
			drawEnemyAimDebug(enemy, blockSizePx, debug);
		}
	}

	drawActor(snapshot.player, blockSizePx, "cyan", includeUi);

	for (const enemy of snapshot.enemies || []) {
		drawActor(enemy, blockSizePx, "red", includeUi);
	}

	for (const projectile of snapshot.projectiles || []) {
		drawProjectile(projectile, blockSizePx);
	}

	for (const warmup of snapshot.laserWarmups || []) {
		drawLaserWarmup(warmup, blockSizePx, alpha);
	}

	for (const beam of snapshot.laserBeams || []) {
		drawLaserBeam(beam, blockSizePx, alpha);
	}

	for (const explosion of snapshot.explosions || []) {
		drawExplosion(explosion, blockSizePx, alpha);
	}

	ctx.restore();
}

const trailColorCache = new Map();

function clamp01(value) {
	return Math.min(1, Math.max(0, Number(value) || 0));
}

// Canvas accepts named colors, hex, rgb(), etc. Resolve each distinct trail
// color once, then cache the numeric RGBA components so swept gradients can
// vary opacity without repeatedly asking the browser to parse CSS colors.
function resolvedTrailColor(color) {
	const key = String(color ?? "white");
	const cached = trailColorCache.get(key);
	if (cached) return cached;

	ctx.save();
	ctx.fillStyle = "#ffffff";
	ctx.fillStyle = key;
	const normalized = String(ctx.fillStyle);
	ctx.restore();

	let result = [255, 255, 255, 1];
	let match = normalized.match(/^#([0-9a-f]{6})$/i);
	if (match) {
		const hex = match[1];
		result = [
			parseInt(hex.slice(0, 2), 16),
			parseInt(hex.slice(2, 4), 16),
			parseInt(hex.slice(4, 6), 16),
			1,
		];
	} else {
		match = normalized.match(
			/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
		);
		if (match) {
			result = [
				Number(match[1]),
				Number(match[2]),
				Number(match[3]),
				match[4] === undefined ? 1 : clamp01(match[4]),
			];
		}
	}

	trailColorCache.set(key, result);
	return result;
}

function trailColorAtAlpha(color, alpha) {
	const [r, g, b, baseAlpha] = resolvedTrailColor(color);
	return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha) * baseAlpha})`;
}

function sweptGradient(
	x1,
	y1,
	x2,
	y2,
	color1,
	color2,
	alpha1,
	alpha2,
) {
	if (Math.hypot(x2 - x1, y2 - y1) < 1e-9) {
		return trailColorAtAlpha(color2 ?? color1, (alpha1 + alpha2) / 2);
	}

	const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
	gradient.addColorStop(0, trailColorAtAlpha(color1, alpha1));
	gradient.addColorStop(1, trailColorAtAlpha(color2 ?? color1, alpha2));
	return gradient;
}

function matchingByRenderId(items) {
	const result = new Map();
	for (const item of items || []) {
		if (item?.renderId !== undefined && item?.renderId !== null) {
			result.set(item.renderId, item);
		}
	}
	return result;
}

function normalizeVector(x, y) {
	const length = Math.hypot(x, y);
	if (length < 1e-9) return null;
	return { x: x / length, y: y / length };
}

// Use the direction through the neighbouring samples instead of the direction
// of an individual segment. Adjacent trail quads therefore reuse exactly the
// same cross-section at their shared sample and touch edge-to-edge rather than
// painting overlapping swept shapes at every join.
function ribbonTangent(samples, index) {
	const current = samples[index];
	const previous = index > 0 ? samples[index - 1] : null;
	const next = index + 1 < samples.length ? samples[index + 1] : null;

	if (previous && next) {
		const through = normalizeVector(
			next.cx - previous.cx,
			next.cy - previous.cy,
		);
		if (through) return through;
	}

	if (next) {
		const outgoing = normalizeVector(next.cx - current.cx, next.cy - current.cy);
		if (outgoing) return outgoing;
	}

	if (previous) {
		const incoming = normalizeVector(
			current.cx - previous.cx,
			current.cy - previous.cy,
		);
		if (incoming) return incoming;
	}

	return null;
}

function ribbonEdges(samples, index) {
	const sample = samples[index];
	const tangent = ribbonTangent(samples, index);
	if (!tangent) return null;

	// Non-circular renderables can provide exact cross-section geometry. Actors
	// use this to anchor the ribbon to the actual vertices of their axis-aligned
	// square instead of points on an imaginary support-radius circle.
	if (typeof sample.edgesForTangent === "function") {
		return sample.edgesForTangent(tangent);
	}

	const normalX = -tangent.y;
	const normalY = tangent.x;
	const halfWidth = Math.max(0, sample.halfWidth(normalX, normalY));
	if (halfWidth <= 0) return null;

	return {
		left: {
			x: sample.cx + normalX * halfWidth,
			y: sample.cy + normalY * halfWidth,
		},
		right: {
			x: sample.cx - normalX * halfWidth,
			y: sample.cy - normalY * halfWidth,
		},
	};
}

function squareSupportVertexSign(normalComponent, tangentComponent, side) {
	const epsilon = 1e-9;

	// Away from an axis-aligned tie, the support point of a square is exactly a
	// corner: choose the coordinate sign that maximises (+1) or minimises (-1)
	// the dot product with the trail normal.
	if (Math.abs(normalComponent) > epsilon) {
		const supportSign = normalComponent > 0 ? 1 : -1;
		return side > 0 ? supportSign : -supportSign;
	}

	// If the normal component is zero, the whole square edge is a support edge.
	// Pick its trailing vertex so horizontal/vertical motion still produces a
	// cross-section made from two real square corners rather than edge midpoints.
	if (Math.abs(tangentComponent) > epsilon) {
		return tangentComponent > 0 ? -1 : 1;
	}

	return side > 0 ? 1 : -1;
}

function actorRibbonSample(actor, alpha, blockSizePx) {
	if (!actor || actor.hp <= 0) return null;

	const sizePx = Math.max(0, Number(actor.size) || 0) * blockSizePx;
	const x = Number(actor.x) * blockSizePx;
	const y = Number(actor.y) * blockSizePx;
	if (!Number.isFinite(x) || !Number.isFinite(y) || sizePx <= 0) return null;

	const halfSize = sizePx / 2;
	const cx = x + halfSize;
	const cy = y + halfSize;

	return {
		renderId: actor.renderId,
		cx,
		cy,
		color: actor.color,
		alpha,
		edgesForTangent: (tangent) => {
			const normalX = -tangent.y;
			const normalY = tangent.x;

			const leftSignX = squareSupportVertexSign(normalX, tangent.x, 1);
			const leftSignY = squareSupportVertexSign(normalY, tangent.y, 1);
			const rightSignX = squareSupportVertexSign(normalX, tangent.x, -1);
			const rightSignY = squareSupportVertexSign(normalY, tangent.y, -1);

			return {
				left: {
					x: cx + leftSignX * halfSize,
					y: cy + leftSignY * halfSize,
				},
				right: {
					x: cx + rightSignX * halfSize,
					y: cy + rightSignY * halfSize,
				},
			};
		},
	};
}

function projectileRibbonSample(projectile, alpha, blockSizePx) {
	if (!projectile) return null;

	const cx = Number(projectile.x) * blockSizePx;
	const cy = Number(projectile.y) * blockSizePx;
	const radius = Math.max(0, Number(projectile.radius) || 0) * blockSizePx;
	if (!Number.isFinite(cx) || !Number.isFinite(cy) || radius <= 0) return null;

	return {
		renderId: projectile.renderId,
		cx,
		cy,
		color: projectile.color,
		alpha,
		halfWidth: () => radius,
	};
}

// Build contiguous runs for each renderId. If an object disappears between two
// sampled frames, its old and new appearances are not bridged by a trail.
function collectRibbonRuns(trailEntries, getItems, makeSample) {
	const activeRuns = new Map();
	const completedRuns = [];

	for (let entryIndex = 0; entryIndex < trailEntries.length; entryIndex++) {
		const entry = trailEntries[entryIndex];
		const itemsById = matchingByRenderId(getItems(entry.snapshot));
		const seenIds = new Set();

		for (const [renderId, item] of itemsById) {
			const sample = makeSample(item, entry.alpha);
			if (!sample) continue;
			seenIds.add(renderId);

			const active = activeRuns.get(renderId);
			if (active && active.lastEntryIndex === entryIndex - 1) {
				active.samples.push(sample);
				active.lastEntryIndex = entryIndex;
				continue;
			}

			if (active?.samples.length >= 2) {
				completedRuns.push(active.samples);
			}
			activeRuns.set(renderId, {
				lastEntryIndex: entryIndex,
				samples: [sample],
			});
		}

		for (const [renderId, active] of activeRuns) {
			if (seenIds.has(renderId)) continue;
			if (active.lastEntryIndex < entryIndex) {
				if (active.samples.length >= 2) completedRuns.push(active.samples);
				activeRuns.delete(renderId);
			}
		}
	}

	for (const active of activeRuns.values()) {
		if (active.samples.length >= 2) completedRuns.push(active.samples);
	}

	return completedRuns;
}

// Projectile trails can contain multiple ordered samples inside one render frame:
// the frame-start position plus exact wall-impact/reversal/terminal checkpoints.
// Unlike matchingByRenderId(), keep every sample for the same renderId so a
// bounce is drawn through the real contact point and a dying projectile reaches
// its final position even though it is absent from the current entity snapshot.
function collectProjectileRibbonRuns(trailEntries, blockSizePx) {
	const activeRuns = new Map();
	const completedRuns = [];

	for (let entryIndex = 0; entryIndex < trailEntries.length; entryIndex++) {
		const entry = trailEntries[entryIndex];
		const samplesById = new Map();

		const appendItem = (item) => {
			const sample = projectileRibbonSample(item, entry.alpha, blockSizePx);
			if (!sample || sample.renderId === undefined || sample.renderId === null) {
				return;
			}

			let samples = samplesById.get(sample.renderId);
			if (!samples) {
				samples = [];
				samplesById.set(sample.renderId, samples);
			}

			const previous = samples.at(-1);
			if (
				previous &&
				Math.hypot(sample.cx - previous.cx, sample.cy - previous.cy) < 1e-9
			) {
				samples[samples.length - 1] = sample;
			} else {
				samples.push(sample);
			}
		};

		for (const event of entry.snapshot.projectileTrailEvents || []) {
			appendItem(event);
		}
		for (const projectile of entry.snapshot.projectiles || []) {
			appendItem(projectile);
		}

		const seenIds = new Set(samplesById.keys());
		for (const [renderId, frameSamples] of samplesById) {
			const active = activeRuns.get(renderId);

			if (active && active.lastEntryIndex === entryIndex - 1) {
				for (const sample of frameSamples) {
					const previous = active.samples.at(-1);
					if (
						previous &&
						Math.hypot(sample.cx - previous.cx, sample.cy - previous.cy) < 1e-9
					) {
						active.samples[active.samples.length - 1] = sample;
					} else {
						active.samples.push(sample);
					}
				}
				active.lastEntryIndex = entryIndex;
				continue;
			}

			if (active?.samples.length >= 2) {
				completedRuns.push(active.samples);
			}
			activeRuns.set(renderId, {
				lastEntryIndex: entryIndex,
				samples: [...frameSamples],
			});
		}

		for (const [renderId, active] of activeRuns) {
			if (seenIds.has(renderId)) continue;
			if (active.lastEntryIndex < entryIndex) {
				if (active.samples.length >= 2) completedRuns.push(active.samples);
				activeRuns.delete(renderId);
			}
		}
	}

	for (const active of activeRuns.values()) {
		if (active.samples.length >= 2) completedRuns.push(active.samples);
	}

	return completedRuns;
}

function drawGradientQuad(previous, next, oldEdges, newEdges) {
	ctx.save();
	ctx.globalAlpha = 1;
	ctx.fillStyle = sweptGradient(
		previous.cx,
		previous.cy,
		next.cx,
		next.cy,
		previous.color,
		next.color,
		previous.alpha,
		next.alpha,
	);
	ctx.beginPath();
	ctx.moveTo(oldEdges.left.x, oldEdges.left.y);
	ctx.lineTo(newEdges.left.x, newEdges.left.y);
	ctx.lineTo(newEdges.right.x, newEdges.right.y);
	ctx.lineTo(oldEdges.right.x, oldEdges.right.y);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

// One trajectory is a ribbon made from edge-sharing quads. Every sample's
// left/right cross-section is calculated once and reused by the quad before it
// and the quad after it. Adjacent trail pieces therefore share only an edge;
// there is no endpoint circle/rectangle and no overlapping capsule/hull area.
function drawRibbonRun(samples) {
	if (samples.length < 2) return;
	const edges = samples.map((_, index) => ribbonEdges(samples, index));

	for (let index = 0; index < samples.length - 1; index++) {
		const previous = samples[index];
		const next = samples[index + 1];
		const oldEdges = edges[index];
		const newEdges = edges[index + 1];
		if (!oldEdges || !newEdges) continue;
		if (Math.hypot(next.cx - previous.cx, next.cy - previous.cy) < 1e-9) {
			continue;
		}

		drawGradientQuad(previous, next, oldEdges, newEdges);
	}
}

// Straight projectile legs can be collapsed into one ribbon strip regardless
// of how many trail samples they contain. Bounces and boomerang reversals are
// discrete corners, so they are split into separate straight legs and stay on
// this fast path. Quads are reserved for projectiles whose direction changes
// on consecutive sampled movements (continuous/per-frame turning).
function straightProjectileDirection(samples) {
	let direction = null;

	for (let index = 0; index < samples.length - 1; index++) {
		const current = samples[index];
		const next = samples[index + 1];
		const segment = normalizeVector(next.cx - current.cx, next.cy - current.cy);
		if (!segment) continue;

		if (!direction) {
			direction = segment;
			continue;
		}

		const cross = direction.x * segment.y - direction.y * segment.x;
		const dot = direction.x * segment.x + direction.y * segment.y;
		if (Math.abs(cross) > 1e-5 || dot <= 0.99999) return null;
	}

	return direction;
}

function sameForwardProjectileDirection(a, b) {
	const cross = a.x * b.y - a.y * b.x;
	const dot = a.x * b.x + a.y * b.y;
	return Math.abs(cross) <= 1e-5 && dot > 0.99999;
}

// A bounce/reversal creates one isolated direction change and then continues
// straight. A continuously curving/homing projectile changes direction again
// on the very next movement; only that case needs the quad renderer.
function projectileTurnsOnConsecutiveMovements(samples) {
	let previousDirection = null;
	let previousMovementTurned = false;

	for (let index = 0; index < samples.length - 1; index++) {
		const current = samples[index];
		const next = samples[index + 1];
		const direction = normalizeVector(next.cx - current.cx, next.cy - current.cy);
		if (!direction) continue;

		if (!previousDirection) {
			previousDirection = direction;
			continue;
		}

		const turned = !sameForwardProjectileDirection(previousDirection, direction);
		if (turned && previousMovementTurned) return true;

		previousMovementTurned = turned;
		previousDirection = direction;
	}

	return false;
}

// Split a bouncing/boomerang path at each discrete corner. The corner sample is
// deliberately shared by the two legs so each strip reaches the exact impact
// or reversal position; there are still no historical projectile circles.
function splitStraightProjectileLegs(samples) {
	const legs = [];
	let leg = [];
	let legDirection = null;

	for (let index = 0; index < samples.length - 1; index++) {
		const current = samples[index];
		const next = samples[index + 1];
		const direction = normalizeVector(next.cx - current.cx, next.cy - current.cy);

		if (!direction) {
			if (leg.length === 0) leg.push(current);
			leg.push(next);
			continue;
		}

		if (!legDirection) {
			if (leg.length === 0) leg.push(current);
			else if (leg.at(-1) !== current) leg.push(current);
			leg.push(next);
			legDirection = direction;
			continue;
		}

		if (sameForwardProjectileDirection(legDirection, direction)) {
			leg.push(next);
			continue;
		}

		if (leg.length >= 2) legs.push(leg);
		leg = [current, next];
		legDirection = direction;
	}

	if (leg.length >= 2) legs.push(leg);
	return legs;
}

function straightProjectileGradient(samples, firstIndex, lastIndex) {
	const first = samples[firstIndex];
	const last = samples[lastIndex];
	const totalDistance = Math.hypot(last.cx - first.cx, last.cy - first.cy);
	if (totalDistance < 1e-9) {
		return trailColorAtAlpha(last.color ?? first.color, last.alpha);
	}

	const gradient = ctx.createLinearGradient(first.cx, first.cy, last.cx, last.cy);
	const stops = [];

	for (let index = firstIndex; index <= lastIndex; index++) {
		const sample = samples[index];
		const distance = Math.hypot(sample.cx - first.cx, sample.cy - first.cy);
		const offset = clamp01(distance / totalDistance);
		const color = trailColorAtAlpha(sample.color, sample.alpha);

		// Multiple source frames can occupy the exact same position. Keep the
		// newest value at that position instead of creating overlapping paint.
		if (stops.length > 0 && Math.abs(stops.at(-1).offset - offset) < 1e-9) {
			stops[stops.length - 1] = { offset, color };
		} else {
			stops.push({ offset, color });
		}
	}

	if (stops[0]?.offset > 0) {
		stops.unshift({
			offset: 0,
			color: trailColorAtAlpha(first.color, first.alpha),
		});
	}
	if (stops.at(-1)?.offset < 1) {
		stops.push({
			offset: 1,
			color: trailColorAtAlpha(last.color, last.alpha),
		});
	}

	for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
	return gradient;
}

function drawStraightProjectileRun(samples) {
	if (samples.length < 2 || !straightProjectileDirection(samples)) return false;

	let firstIndex = 0;
	let lastIndex = samples.length - 1;
	while (
		firstIndex < lastIndex &&
		Math.hypot(
			samples[firstIndex + 1].cx - samples[firstIndex].cx,
			samples[firstIndex + 1].cy - samples[firstIndex].cy,
		) < 1e-9
	) {
		firstIndex += 1;
	}
	while (
		lastIndex > firstIndex &&
		Math.hypot(
			samples[lastIndex].cx - samples[lastIndex - 1].cx,
			samples[lastIndex].cy - samples[lastIndex - 1].cy,
		) < 1e-9
	) {
		lastIndex -= 1;
	}
	if (lastIndex <= firstIndex) return false;

	const trimmed = samples.slice(firstIndex, lastIndex + 1);
	const firstEdges = ribbonEdges(trimmed, 0);
	const lastEdges = ribbonEdges(trimmed, trimmed.length - 1);
	if (!firstEdges || !lastEdges) return false;

	ctx.save();
	ctx.globalAlpha = 1;
	ctx.fillStyle = straightProjectileGradient(
		samples,
		firstIndex,
		lastIndex,
	);
	ctx.beginPath();
	ctx.moveTo(firstEdges.left.x, firstEdges.left.y);
	ctx.lineTo(lastEdges.left.x, lastEdges.left.y);
	ctx.lineTo(lastEdges.right.x, lastEdges.right.y);
	ctx.lineTo(firstEdges.right.x, firstEdges.right.y);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
	return true;
}

function drawPiecewiseStraightProjectileRun(samples) {
	if (samples.length < 2 || projectileTurnsOnConsecutiveMovements(samples)) {
		return false;
	}

	const legs = splitStraightProjectileLegs(samples);
	if (legs.length === 0) return false;

	let drewAny = false;
	for (const leg of legs) {
		if (drawStraightProjectileRun(leg)) drewAny = true;
	}
	return drewAny;
}

function drawTrailRibbons(trailEntries, rendering, excludedProjectileIds = null) {
	if (trailEntries.length < 2) return;
	const blockSizePx = rendering.BLOCK_SIZE_PX;

	const playerRuns = collectRibbonRuns(
		trailEntries,
		(snapshot) => (snapshot.player ? [snapshot.player] : []),
		(actor, alpha) => actorRibbonSample(actor, alpha, blockSizePx),
	);
	const enemyRuns = collectRibbonRuns(
		trailEntries,
		(snapshot) => snapshot.enemies || [],
		(actor, alpha) => actorRibbonSample(actor, alpha, blockSizePx),
	);
	const projectileRuns = collectProjectileRibbonRuns(
		trailEntries,
		blockSizePx,
	);

	for (const run of playerRuns) drawRibbonRun(run);
	for (const run of enemyRuns) drawRibbonRun(run);
	for (const run of projectileRuns) {
		if (excludedProjectileIds?.has(run[0]?.renderId)) continue;
		drawRibbonRun(run);
	}
}

// TRAIL_DETAIL feeds all piecewise-straight projectile legs, including normal
// bullets, wall bounces, and boomerang reversals. TRAIL_QUAD_DETAIL is used for
// player/enemy ribbons and only for projectiles that continuously turn between
// consecutive sampled movements.
function drawTrailsHybrid(trailEntries, quadTrailEntries, rendering) {
	const blockSizePx = rendering.BLOCK_SIZE_PX;
	const straightProjectileIds = new Set();

	if (trailEntries.length >= 2) {
		const projectileRuns = collectProjectileRibbonRuns(
			trailEntries,
			blockSizePx,
		);

		for (const run of projectileRuns) {
			if (drawPiecewiseStraightProjectileRun(run)) {
				straightProjectileIds.add(run[0].renderId);
			}
		}
	}

	drawTrailRibbons(quadTrailEntries, rendering, straightProjectileIds);
}

// Draws a minimal active-weapon indicator in screen space.
export function drawWeaponHud(snapshot) {
	if (!snapshot.player || snapshot.player.hp <= 0) return;

	const label = `Weapon ${Number(snapshot.activeWeaponIndex || 0) + 1}`;
	ctx.font = "16px monospace";
	const textWidth = ctx.measureText(label).width;
	const padding = 10;
	const width = textWidth + padding * 2;
	const height = 34;
	const x = canvas.width - width - 12;
	const y = 12;

	ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
	ctx.fillRect(x, y, width, height);
	ctx.strokeStyle = "cyan";
	ctx.lineWidth = 1;
	ctx.strokeRect(x, y, width, height);
	ctx.fillStyle = "white";
	ctx.fillText(label, x + padding, y + 22);
}

// Renders one visual snapshot. Historical trail snapshots are transformed by
// the current snapshot's camera, so trails stay anchored to world coordinates
// rather than sticking to screen pixels while the camera moves.
export function draw(snapshot, trailEntries = [], options = {}) {
	if (!snapshot) return;

	const rendering = normalizedRendering(snapshot);
	const debug = normalizedDebugSettings(snapshot);
	resetDebugDrawBudget(snapshot, debug);
	syncCanvasToSnapshot(rendering);
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	ctx.scale(rendering.ZOOM, rendering.ZOOM);
	ctx.translate(
		-Math.floor(snapshot.camera.x * rendering.BLOCK_SIZE_PX),
		-Math.floor(snapshot.camera.y * rendering.BLOCK_SIZE_PX),
	);

	drawProceduralEnvironment(snapshot, rendering, debug);
	drawWalls(snapshot, rendering);

	if (trailEntries.length > 0 || options.quadTrailEntries?.length > 0) {
		drawTrailsHybrid(
			trailEntries,
			options.quadTrailEntries || trailEntries,
			rendering,
		);
	}

	// Current-frame UI is rendered exactly once. Historical/swept trail frames
	// intentionally omit health bars and all other UI elements.
	drawDynamicSnapshot(snapshot, rendering, 1, {
		includeUi: true,
		debug,
	});
	ctx.restore();

	drawWeaponHud(snapshot);

	const replayActive = Boolean(options.replayActive);
	respawnBtn.hidden = replayActive || snapshot.player.hp > 0;

	if (snapshot.player.hp <= 0) {
		const sourceStatus = (source) =>
			source === "factory"
				? "UNEDITED"
				: source === "session"
					? "SESSION EDITABLE"
					: "UNKNOWN";

		ctx.save();
		ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.textAlign = "center";
		ctx.fillStyle = "red";
		ctx.font = "40px sans-serif";
		ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2);
		ctx.fillStyle = "white";
		ctx.font = "24px sans-serif";
		ctx.fillText(
			`Max Distance: ${Math.floor(snapshot.maxDistance)}`,
			canvas.width / 2,
			canvas.height / 2 + 40,
		);
		ctx.font = "20px monospace";
		ctx.fillText(
			`config.json: ${sourceStatus(snapshot.configSource)}`,
			canvas.width / 2,
			canvas.height / 2 + 75,
		);
		ctx.fillText(
			`level.json: ${sourceStatus(snapshot.levelSource)}`,
			canvas.width / 2,
			canvas.height / 2 + 105,
		);
		ctx.restore();
	}
}
