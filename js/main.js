// Browser entry point and compatibility exports for runtime orchestration.

import { Config } from "./config.js";
import { player } from "./state.js";
import { initGame } from "./runtime/game-init.js";

// Preserve the public module API that previously lived directly in main.js.
export { updateGame as update } from "./runtime/game-update.js";
export { syncCameraViewport, initGame } from "./runtime/game-init.js";
export { gameLoop, getTargetFps } from "./runtime/game-loop.js";
export { MAX_DT_SECONDS } from "./runtime/frame-pacing.js";

// Serializes the current Config object into a downloadable custom_config.json browser download.
export function exportConfig() {
	const dataStr =
		"data:text/json;charset=utf-8," +
		encodeURIComponent(JSON.stringify(Config, null, 4));

	const anchor = document.createElement("a");
	anchor.href = dataStr;
	anchor.download = "custom_config.json";

	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
}

initGame();

// Preserve the original global API used by the config/editor UI.
window.Config = Config;
window.player = player;

if (window.syncConfigToUI) {
	window.syncConfigToUI();
}
