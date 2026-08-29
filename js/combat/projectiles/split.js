import { Config } from "../../config.js";
import { getSplitChildDefinition } from "../projectile-schema.js";
import { shoot } from "./spawn.js";

let splitLaserFirer = null;

export function registerSplitLaserFirer(firer) {
	splitLaserFirer = typeof firer === "function" ? firer : null;
}

function getSplitAngles(baseAngle, count, spread) {
	if (count <= 0) return [];
	if (count === 1) return [baseAngle];
	const cappedSpread = Math.min(Math.PI * 2, Math.max(0, Number(spread)));
	if (cappedSpread >= Math.PI * 2) {
		return Array.from(
			{ length: count },
			(_, index) => baseAngle - Math.PI + index * Math.PI * 2 / count,
		);
	}
	return Array.from(
		{ length: count },
		(_, index) => baseAngle - cappedSpread / 2 + index * cappedSpread / (count - 1),
	);
}

function selectSplitChildEntries(children, count) {
	if (!Array.isArray(children) || children.length === 0) {
		return Array.from({ length: count }, () => null);
	}
	const weights = children.map((entry) => Math.max(0, Number(entry?.weight) || 0));
	const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
	if (weightTotal <= 0) {
		return Array.from({ length: count }, (_, index) => children[index % children.length]);
	}
	return Array.from({ length: count }, () => {
		let roll = Math.random() * weightTotal;
		let lastPositive = children[0];
		for (let index = 0; index < children.length; index++) {
			if (weights[index] <= 0) continue;
			lastPositive = children[index];
			roll -= weights[index];
			if (roll <= 0) return children[index];
		}
		return lastPositive;
	});
}

export function fireSplitChildren(projectile, baseAngle, currentTime) {
	if (!projectile.splitEnabled || projectile.splitCount <= 0) return false;
	const angles = getSplitAngles(baseAngle, projectile.splitCount, projectile.splitSpread);
	const entries = selectSplitChildEntries(projectile.splitChildren, angles.length);
	const origin = { x: projectile.x, y: projectile.y, size: 0 };

	for (let index = 0; index < angles.length; index++) {
		const childStats = getSplitChildDefinition(Config.BASE_PROJECTILE, entries[index]);
		const angle = angles[index];
		if (childStats.laser) {
			splitLaserFirer?.({
				shooter: origin,
				ownerId: projectile.ownerId,
				team: projectile.team,
				variationLuckUpgrade: projectile.variationLuckUpgrade,
				angle,
				stats: childStats,
				currentTime,
			});
		} else {
			shoot(
				origin,
				origin.x + Math.cos(angle),
				origin.y + Math.sin(angle),
				childStats,
				{
					ownerId: projectile.ownerId,
					team: projectile.team,
					variationLuckUpgrade: projectile.variationLuckUpgrade,
					splitCreated: true,
					forcedBaseAngle: angle,
				},
			);
		}
	}
	return true;
}
