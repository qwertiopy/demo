// Browser replay recording controls.

import { replayRecordBtn, replayStopRecordingBtn } from "../dom.js";
import { startReplayRecording, stopReplayRecording } from "./recorder.js";
import { setReplayStatus, syncReplayButtons } from "./ui.js";

export function initReplayControls() {
	if (!replayRecordBtn) return;

	replayRecordBtn.addEventListener("click", () => startReplayRecording());
	replayStopRecordingBtn?.addEventListener("click", async () => {
		await stopReplayRecording();
	});

	setReplayStatus("Replay recording idle.");
	syncReplayButtons();
}
