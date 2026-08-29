// DOM UI synchronization associated with rendered game/replay snapshots.

import { respawnBtn } from "../dom.js";

export function syncRespawnButton(snapshot, { replayActive = false } = {}) {
	if (!snapshot) return;
	respawnBtn.hidden = Boolean(replayActive) || snapshot.player.hp > 0;
}
