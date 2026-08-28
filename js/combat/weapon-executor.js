import { GameState } from "../state.js";
import { requestLaserShot } from "./lasers.js";
import { shoot } from "./projectiles.js";
import {
	isWeaponReady,
	setWeaponCooldownUntil,
} from "./weapon-cooldowns.js";

// Neutral firing entry point used by players and enemies. ownerId controls
// attribution/caps, while team controls target relationships.
export function executeWeaponFire({
	shooter,
	targetX,
	targetY,
	stats,
	weaponSlot = 0,
	currentTime = GameState.simulationTimeMs,
	ignoreCooldown = false,
	options = {},
}) {
	if (!shooter || shooter.active === false || Number(shooter.hp) <= 0) return false;
	const ownerId = options.ownerId ?? shooter.id;
	const slot = Math.max(0, Math.floor(Number(weaponSlot) || 0));
	const now = Number.isFinite(Number(currentTime))
		? Number(currentTime)
		: GameState.simulationTimeMs;

	if (!ignoreCooldown && !isWeaponReady(ownerId, slot, now)) return false;

	if (stats.laser === true) {
		return requestLaserShot(
			shooter,
			targetX,
			targetY,
			stats,
			slot,
			now,
			{ ...options, ownerId, ignoreCooldown },
		);
	}

	shoot(shooter, targetX, targetY, stats, {
		...options,
		ownerId,
		currentTime: now,
	});
	if (!ignoreCooldown) {
		setWeaponCooldownUntil(
			ownerId,
			slot,
			now + Math.max(0, Number(stats.cooldownMs ?? 0) || 0),
		);
	}
	return true;
}
