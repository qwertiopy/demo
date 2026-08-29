// Projectile, laser, and explosion rendering.

import { ctx } from "../dom.js";

export function drawProjectile(projectile, blockSizePx) {
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

export function drawLaserWarmup(warmup, blockSizePx, alphaMultiplier) {
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

export function drawLaserBeam(beam, blockSizePx, alphaMultiplier) {
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

export function drawExplosion(explosion, blockSizePx, alphaMultiplier) {
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
