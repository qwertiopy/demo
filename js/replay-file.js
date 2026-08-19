// Shared replay-file validation and download helpers.

export const REPLAY_VERSION = 1;

export function validateReplayData(data) {
	if (!data || typeof data !== "object") {
		throw new Error("Replay file must contain a JSON object.");
	}
	if (Number(data.replayVersion) !== REPLAY_VERSION) {
		throw new Error(
			`Unsupported replay version ${data.replayVersion ?? "unknown"}.`,
		);
	}
	if (!Array.isArray(data.frames) || data.frames.length === 0) {
		throw new Error("Replay file contains no frames.");
	}

	let previousTime = -Infinity;
	for (const [index, frame] of data.frames.entries()) {
		const timeMs = Number(frame?.timeMs);
		if (!Number.isFinite(timeMs) || timeMs < previousTime) {
			throw new Error(`Replay frame ${index} has an invalid timestamp.`);
		}
		if (!frame?.camera || !frame?.player || !frame?.rendering) {
			throw new Error(`Replay frame ${index} is missing visual snapshot data.`);
		}
		previousTime = timeMs;
	}

	return data;
}

export async function readReplayFile(file) {
	if (!file) throw new Error("No replay file selected.");
	const text = await file.text();
	return validateReplayData(JSON.parse(text));
}

export function replayFileName(replay = null) {
	const createdAt = replay?.createdAt ? new Date(replay.createdAt) : new Date();
	const safeDate = Number.isFinite(createdAt.getTime()) ? createdAt : new Date();
	return `demo-${safeDate.toISOString().replace(/[:.]/g, "-")}.replay`;
}

export function downloadReplay(replay, filename = replayFileName(replay)) {
	validateReplayData(replay);
	const blob = new Blob([JSON.stringify(replay)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
	return blob.size;
}
