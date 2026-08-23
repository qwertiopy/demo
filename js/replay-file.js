// Shared replay-file validation, compression, loading, and download helpers.

export const REPLAY_VERSION = 3;
const SUPPORTED_REPLAY_VERSIONS = new Set([1, 2, REPLAY_VERSION]);
const GZIP_MAGIC_FIRST = 0x1f;
const GZIP_MAGIC_SECOND = 0x8b;

const V3_FRAME = Object.freeze({
	TIME_MS: 0,
	ENVIRONMENT_REVISION: 1,
	PLAYER: 6,
	ENEMIES: 7,
	PROJECTILES: 8,
	PROJECTILE_TRAIL_EVENTS: 9,
	LASER_WARMUPS: 10,
	LASER_BEAMS: 11,
	EXPLOSIONS: 12,
	LENGTH: 13,
});

function validateV2Environment(environment, index) {
	if (!environment || typeof environment !== "object") {
		throw new Error(`Replay environment revision ${index} is invalid.`);
	}
	if (!Array.isArray(environment.walls) || !Array.isArray(environment.enemySpawns)) {
		throw new Error(
			`Replay environment revision ${index} is missing walls/spawn data.`,
		);
	}
	return Number(environment.revision);
}

function validateWallTuples(walls, index, field) {
	for (const wall of walls) {
		if (!Array.isArray(wall) || wall.length < 5) {
			throw new Error(
				`Replay environment revision ${index} has invalid ${field} wall data.`,
			);
		}
	}
}

function validateV3Environment(environment, index) {
	if (!environment || typeof environment !== "object") {
		throw new Error(`Replay environment revision ${index} is invalid.`);
	}

	const hasKeyframe = Array.isArray(environment.k);
	const hasDelta = Array.isArray(environment.a) && Array.isArray(environment.d);
	if (!hasKeyframe && !hasDelta) {
		throw new Error(
			`Replay environment revision ${index} has neither a keyframe nor a delta.`,
		);
	}
	if (index === 0 && !hasKeyframe) {
		throw new Error("Replay's first environment revision must be a keyframe.");
	}

	if (hasKeyframe) validateWallTuples(environment.k, index, "keyframe");
	if (hasDelta) {
		validateWallTuples(environment.a, index, "added");
		validateWallTuples(environment.d, index, "removed");
	}
	return Number(environment.r);
}

function validateDefinitionTable(definitions, label) {
	if (!Array.isArray(definitions)) {
		throw new Error(`Replay is missing ${label} definitions.`);
	}

	const ids = new Set();
	for (const definition of definitions) {
		const id = Number(definition?.[0]);
		if (!Array.isArray(definition) || !Number.isInteger(id) || id < 1) {
			throw new Error(`Replay contains an invalid ${label} definition.`);
		}
		if (ids.has(id)) {
			throw new Error(`Replay ${label} definition id ${id} is duplicated.`);
		}
		ids.add(id);
	}
	return ids;
}

function validateV3Metadata(data) {
	if (
		!Array.isArray(data.viewport) ||
		data.viewport.length < 2 ||
		!data.viewport.every((value) => Number.isFinite(Number(value)))
	) {
		throw new Error("Replay is missing its recorded viewport.");
	}
	if (!Array.isArray(data.playerStyle) || data.playerStyle.length < 3) {
		throw new Error("Replay is missing its player style definition.");
	}
	if (!data.sources || typeof data.sources !== "object") {
		throw new Error("Replay is missing source provenance.");
	}
	if (!data.entityDefinitions || typeof data.entityDefinitions !== "object") {
		throw new Error("Replay is missing entity definitions.");
	}

	return {
		enemies: validateDefinitionTable(
			data.entityDefinitions.enemies,
			"enemy",
		),
		projectiles: validateDefinitionTable(
			data.entityDefinitions.projectiles,
			"projectile",
		),
	};
}

function validateTupleReferences(tuples, validIds, label, frameIndex) {
	if (!Array.isArray(tuples)) {
		throw new Error(`Replay frame ${frameIndex} has invalid ${label} data.`);
	}
	for (const tuple of tuples) {
		const id = Number(tuple?.[0]);
		if (!Array.isArray(tuple) || !validIds.has(id)) {
			throw new Error(
				`Replay frame ${frameIndex} references an undefined ${label} id.`,
			);
		}
	}
}

function validateV3Frame(frame, index, validEnvironmentRevisions, definitions) {
	if (!Array.isArray(frame) || frame.length < V3_FRAME.LENGTH) {
		throw new Error(`Replay frame ${index} has invalid compact frame data.`);
	}

	const environmentRevision = Number(frame[V3_FRAME.ENVIRONMENT_REVISION]);
	if (
		!Number.isInteger(environmentRevision) ||
		!validEnvironmentRevisions.has(environmentRevision)
	) {
		throw new Error(
			`Replay frame ${index} references an invalid environment revision.`,
		);
	}
	if (!Array.isArray(frame[V3_FRAME.PLAYER])) {
		throw new Error(`Replay frame ${index} is missing player data.`);
	}

	validateTupleReferences(
		frame[V3_FRAME.ENEMIES],
		definitions.enemies,
		"enemy",
		index,
	);
	validateTupleReferences(
		frame[V3_FRAME.PROJECTILES],
		definitions.projectiles,
		"projectile",
		index,
	);
	validateTupleReferences(
		frame[V3_FRAME.PROJECTILE_TRAIL_EVENTS],
		definitions.projectiles,
		"projectile trail",
		index,
	);

	for (const field of [
		V3_FRAME.LASER_WARMUPS,
		V3_FRAME.LASER_BEAMS,
		V3_FRAME.EXPLOSIONS,
	]) {
		if (!Array.isArray(frame[field])) {
			throw new Error(`Replay frame ${index} is missing visual effect data.`);
		}
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
	let definitions = null;
	if (replayVersion >= 2) {
		if (!data.rendering || typeof data.rendering !== "object") {
			throw new Error("Replay is missing shared rendering settings.");
		}
		if (!Array.isArray(data.environments) || data.environments.length === 0) {
			throw new Error("Replay contains no environment revisions.");
		}

		validEnvironmentRevisions = new Set();
		for (const [index, environment] of data.environments.entries()) {
			const revision = replayVersion >= 3
				? validateV3Environment(environment, index)
				: validateV2Environment(environment, index);
			if (!Number.isInteger(revision) || revision < 0) {
				throw new Error(`Replay environment revision ${index} has an invalid id.`);
			}
			if (validEnvironmentRevisions.has(revision)) {
				throw new Error(`Replay environment revision id ${revision} is duplicated.`);
			}
			validEnvironmentRevisions.add(revision);
		}
	}
	if (replayVersion >= 3) definitions = validateV3Metadata(data);

	let previousTime = -Infinity;
	for (const [index, frame] of data.frames.entries()) {
		const timeMs = Number(
			replayVersion >= 3 ? frame?.[V3_FRAME.TIME_MS] : frame?.timeMs,
		);
		if (!Number.isFinite(timeMs) || timeMs < previousTime) {
			throw new Error(`Replay frame ${index} has an invalid timestamp.`);
		}

		if (replayVersion === 1) {
			if (!frame?.camera || !frame?.player || !frame.rendering) {
				throw new Error(`Replay frame ${index} is missing visual snapshot data.`);
			}
		} else if (replayVersion === 2) {
			if (!frame?.camera || !frame?.player) {
				throw new Error(`Replay frame ${index} is missing visual snapshot data.`);
			}
			const environmentRevision = Number(frame.environmentRevision);
			if (
				!Number.isInteger(environmentRevision) ||
				!validEnvironmentRevisions.has(environmentRevision)
			) {
				throw new Error(
					`Replay frame ${index} references an invalid environment revision.`,
				);
			}
		} else {
			validateV3Frame(
				frame,
				index,
				validEnvironmentRevisions,
				definitions,
			);
		}

		previousTime = timeMs;
	}

	return data;
}

async function replayFileText(file) {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const gzipped =
		bytes.length >= 2 &&
		bytes[0] === GZIP_MAGIC_FIRST &&
		bytes[1] === GZIP_MAGIC_SECOND;
	if (!gzipped) return new TextDecoder().decode(bytes);

	if (typeof DecompressionStream !== "function") {
		throw new Error("This browser cannot decompress gzip replay files.");
	}
	const stream = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return new Response(stream).text();
}

export async function readReplayFile(file) {
	if (!file) throw new Error("No replay file selected.");
	const text = await replayFileText(file);
	return validateReplayData(JSON.parse(text));
}

export function replayFileName(replay = null) {
	const createdAt = replay?.createdAt ? new Date(replay.createdAt) : new Date();
	const safeDate = Number.isFinite(createdAt.getTime()) ? createdAt : new Date();
	return `demo-${safeDate.toISOString().replace(/[:.]/g, "-")}.replay`;
}

async function compressedReplayBlob(replay) {
	const jsonBlob = new Blob([JSON.stringify(replay)], {
		type: "application/json",
	});
	if (typeof CompressionStream !== "function") return jsonBlob;

	const stream = jsonBlob.stream().pipeThrough(new CompressionStream("gzip"));
	return new Blob([await new Response(stream).arrayBuffer()], {
		type: "application/gzip",
	});
}

export async function downloadReplay(replay, filename = replayFileName(replay)) {
	validateReplayData(replay);
	const blob = await compressedReplayBlob(replay);
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
	return blob.size;
}
