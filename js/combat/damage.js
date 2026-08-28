import { GameState, player } from "../state.js";
import { isDamageableTarget } from "./team-relations.js";

// Central damage boundary. Team relationships decide eligibility; the player
// invincibility toggle suppresses only damage to the player, regardless of the
// attacker's team. A lethal hit deactivates the target immediately so later
// effects in the same simulation tick cannot select or damage it again.
export function applyCombatDamage(sourceTeam, target, amount) {
	if (!isDamageableTarget(sourceTeam, target)) {
		return { eligible: false, applied: false, killed: false };
	}
	if (target === player && GameState.isInvincible) {
		return { eligible: true, applied: false, killed: false };
	}

	const damage = Math.max(0, Number(amount) || 0);
	target.hp -= damage;
	const killed = target.hp <= 0;
	if (killed) target.active = false;
	return { eligible: true, applied: true, killed };
}
