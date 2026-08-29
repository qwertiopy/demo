// Shared enemy runtime helpers.

import { player } from "../../state.js";

export function getMaximumPlayerMovementSpeed() {
	// Movement is applied independently on each axis, so holding one horizontal
	// and one vertical direction produces the true maximum speed: speed * sqrt(2).
	return Math.max(0, Number(player.speed) || 0) * Math.SQRT2;
}
