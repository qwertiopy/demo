// Player/enemy rendering and enemy aim debug overlays.

import { ctx } from "../dom.js";
import { consumeDebugDrawBudget } from "./settings.js";

// Draws a black health-bar background followed by a colored bar proportional to current HP.
export function drawHealthBar(x, y, width, hp, maxHp, color) {
	ctx.fillStyle = "black";
	ctx.fillRect(x, y, width, 5);

	ctx.fillStyle = color;
	ctx.fillRect(x, y, width * (hp / Math.max(1, maxHp)), 5);
}

export function drawActor(actor, blockSizePx, healthColor, includeUi) {
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

export function drawEnemyAimDebug(enemy, blockSizePx, settings) {
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
