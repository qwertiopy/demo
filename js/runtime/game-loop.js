// Browser frame scheduling and runtime tick orchestration.

import { Config } from "../config.js";
import {
	beginProfileFrame,
	beginProfileSection,
	endProfileFrame,
	endProfileSection,
} from "../performance/profiler.js";
import { FramePacer } from "./frame-pacing.js";
import { updateGame } from "./game-update.js";
import { updatePerformanceUi } from "./performance-ui.js";
import { renderGameFrame } from "./render-frame.js";

const framePacer = new FramePacer();

export function getTargetFps() {
	return Math.max(
		1,
		Math.round(Number(Config.RENDERING?.TARGET_FPS ?? 60) || 60),
	);
}

// requestAnimationFrame loop with an explicit target tick/render rate. rAF is
// still used for browser scheduling, but simulation + rendering only run when
// enough target-frame time has accumulated. Actual FPS therefore cannot exceed
// the browser/display's rAF rate.
export function gameLoop(currentTime) {
	requestAnimationFrame(gameLoop);

	const targetFps = getTargetFps();
	if (!framePacer.advanceAnimationFrame(currentTime, targetFps)) {
		return;
	}

	beginProfileFrame(currentTime);
	framePacer.consumeTick(currentTime);
	updatePerformanceUi(currentTime, framePacer.tickDurationMs, targetFps);

	if (framePacer.dt > 0) {
		const updateProfile = beginProfileSection();
		updateGame(currentTime, framePacer.dt);
		endProfileSection("update-total", updateProfile);
	}

	renderGameFrame(currentTime);
	endProfileFrame();
}
