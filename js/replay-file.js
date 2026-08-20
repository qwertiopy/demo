// Shared replay-file validation and download helpers.

export const REPLAY_VERSION = 2;
const SUPPORTED_REPLAY_VERSIONS = new Set([1, REPLAY_VERSION]);

function validateEnvironmentRevision(environment, index) {
	if (!environment || typeof environment !== "object") {
		throw new Error(`Replay environment revision ${index} is invalid.`);
	}
	if (!Array.isArray(environment.walls) || !Array.isArray(environment.enemySpawns)) {
		throw new Error(
			`Replay environment revision ${index} is missing walls/spawn data.`,
		);
	}
}

export function validateReplayData(data) {
	if (!data || typeof data !== "object") {
		throw new Error("Replay file must contain a JSON object.");
	}

	const replayVersion = Number(data.replayVersion);
	if (!SUPPORTED_REPLAY_VERSIONS.has(replayVersion)) {
		throw new Error(
			`Unsupported replay version ${data.replayVersion ?? "unknown"}.`,
		);
	}
	if (!Array.isArray(data.frames) || data.frames.length === 0) {
		throw new Error("Replay file contains no frames.");
	}

	let validEnvironmentRevisions = null;
	if (replayVersion >= 2) {
		if (!data.rendering || typeof data.rendering !== "object") {
			throw new Error("Replay is missing shared rendering settings.");
		}
		if (!Array.isArray(data.environments) || data.environments.length === 0) {
			throw new Error("Replay contains no environment revisions.");
		}

		validEnvironmentRevisions = new Set();
		for (const [index, environment] of data.environments.entries()) {
			validateEnvironmentRevision(environment, index);
			const revision = Number(environment.revision);
			if (!Number.isInteger(revision) || revision < 0) {
				throw new Error(`Replay environment revision ${index} has an invalid id.`);
			}
			if (validEnvironmentRevisions.has(revision)) {
				throw new Error(`Replay environment revision id ${revision} is duplicated.`);
			}
			validEnvironmentRevisions.add(revision);
		}
	}

	let previousTime = -Infinity;
	for (const [index, frame] of data.frames.entries()) {
		const timeMs = Number(frame?.timeMs);
		if (!Number.isFinite(timeMs) || timeMs < previousTime) {
			throw new Error(`Replay frame ${index} has an invalid timestamp.`);
		}
		if (!frame?.camera || !frame?.player) {
			throw new Error(`Replay frame ${index} is missing visual snapshot data.`);
		}

		if (replayVersion === 1) {
			if (!frame.rendering) {
				throw new Error(`Replay frame ${index} is missing rendering data.`);
			}
		} else {
			const environmentRevision = Number(frame.environmentRevision);
			if (
				!Number.isInteger(environmentRevision) ||
				!validEnvironmentRevisions.has(environmentRevision)
			) {
				throw new Error(
					`Replay frame ${index} references an invalid environment revision.`,
				);
			}
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
