import { GameState, player, TEAM_PLAYER } from "../../state.js";
import { queryWallsAlongSegment } from "../../spatial/wall-index.js";
import {
	findChainTarget,
	getAngleToTarget,
	getTargetCenter,
	isTargetWithinChainRange,
} from "../targeting.js";
import { rayRoundedRectIntersection } from "../visibility.js";
import { getProjectileDirectionAngle } from "./helpers.js";

function redirectProjectileTowardTarget(projectile, target) {
	const angle = getAngleToTarget(projectile.x, projectile.y, target);
	const dirX = Math.cos(angle);
	const dirY = Math.sin(angle);

	if (projectile.throwable) {
		projectile.throwDirX = dirX;
		projectile.throwDirY = dirY;
		return;
	}

	const speed = Math.hypot(projectile.vx, projectile.vy);
	projectile.vx = dirX * speed;
	projectile.vy = dirY * speed;
}

export function isProjectileChainPathRadiusClear(projectile, target) {
	if (!target) return false;

	const center = getTargetCenter(target);
	const moveX = center.x - projectile.x;
	const moveY = center.y - projectile.y;
	const distance = Math.hypot(moveX, moveY);
	if (distance <= 1e-10) return true;

	const radius = Math.max(0, Number(projectile.radius) || 0);
	const dirX = moveX / distance;
	const dirY = moveY / distance;
	const candidateWalls = queryWallsAlongSegment(
		projectile.x,
		projectile.y,
		center.x,
		center.y,
		radius,
	);

	return !candidateWalls.some((wall) => {
		const hit = rayRoundedRectIntersection(
			projectile.x,
			projectile.y,
			dirX,
			dirY,
			wall,
			radius,
		);
		return hit && hit.entryDistance <= distance + 1e-10;
	});
}

function isActiveProjectileChainTarget(projectile, target) {
	if (
		!target ||
		(Number(target.hp) || 0) <= 0 ||
		projectile.chainVisitedTargets?.has(target)
	) {
		return false;
	}

	const isActiveTarget = projectile.team === TEAM_PLAYER
		? GameState.enemies.includes(target)
		: target === player;

	return isActiveTarget && isProjectileChainPathRadiusClear(projectile, target);
}

// Active chain projectiles greedily home along the direct current line to their
// acquired target. An untargeted projectile scans once per simulation frame;
// after a target is acquired it retains that target until the target is hit,
// dies, or leaves the active target list. Returns true only when this acquisition
// consumes a post-hit chain redirect, so impact modifiers trigger once rather
// than on every steering adjustment.
export function updateProjectileChainAim(projectile) {
	if (Math.max(0, Number(projectile.chain) || 0) <= 0) return false;

	projectile.chainVisitedTargets ??= new Set();
	if (isActiveProjectileChainTarget(projectile, projectile.chainTarget)) {
		redirectProjectileTowardTarget(projectile, projectile.chainTarget);
		return false;
	}

	projectile.chainTarget = null;
	const isPostHitRedirect = projectile.chainVisitedTargets.size > 0;
	if (isPostHitRedirect && (projectile.chainsRemaining ?? 0) <= 0) {
		return false;
	}

	const referenceAngle = projectile.chainReferenceAngle ??
		getProjectileDirectionAngle(projectile);
	const maximumRangeBlocks = Math.max(
		0,
		Number(projectile.chainMaximumRangeBlocks) || 0,
	);
	const pathIsRadiusClear = (target) =>
		isProjectileChainPathRadiusClear(projectile, target);
	const target = projectile.team === TEAM_PLAYER
		? findChainTarget(
			projectile.x,
			projectile.y,
			referenceAngle,
			projectile.chainVisitedTargets,
			isPostHitRedirect ? "distance" : "angle",
			pathIsRadiusClear,
			maximumRangeBlocks,
		)
		: player.hp > 0 &&
			!projectile.chainVisitedTargets.has(player) &&
			isTargetWithinChainRange(
				projectile.x,
				projectile.y,
				player,
				maximumRangeBlocks,
			) &&
			pathIsRadiusClear(player)
			? player
			: null;

	if (!target) return false;

	projectile.chainTarget = target;
	if (isPostHitRedirect) projectile.chainsRemaining--;
	redirectProjectileTowardTarget(projectile, target);
	return isPostHitRedirect;
}
