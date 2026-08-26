// Game-mode registry. Add future modes here without changing menu navigation.
// A mode can optionally transform the launch level, choose its config policy,
// and configure runtime state.

// seededRandom() reduces every procedural seed into this state space on its
// first step. Generate within the same range so each displayed seed identifies
// one distinct procedural sequence.
const PROCEDURAL_SEED_MODULUS = 233280;

function randomIntegerBelow(limit) {
	const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
	const crypto = globalThis.crypto;

	if (crypto?.getRandomValues) {
		const sample = new Uint32Array(1);
		const sampleRange = 0x100000000;
		const rejectionLimit =
			Math.floor(sampleRange / normalizedLimit) * normalizedLimit;

		do {
			crypto.getRandomValues(sample);
		} while (sample[0] >= rejectionLimit);

		return sample[0] % normalizedLimit;
	}

	return Math.floor(Math.random() * normalizedLimit);
}

// Chooses a procedural seed different from the preceding run. Excluding the
// old seed avoids the rare but confusing case where "new run" repeats it.
export function createProceduralRunSeed(previousSeed = null) {
	const numericPreviousSeed = Number(previousSeed);
	const hasPreviousSeed =
		previousSeed !== null &&
		previousSeed !== undefined &&
		Number.isFinite(numericPreviousSeed);
	const normalizedPreviousSeed = hasPreviousSeed
		? ((Math.trunc(numericPreviousSeed) % PROCEDURAL_SEED_MODULUS) +
				PROCEDURAL_SEED_MODULUS) %
			PROCEDURAL_SEED_MODULUS
		: null;
	const availableSeedCount = hasPreviousSeed
		? PROCEDURAL_SEED_MODULUS - 1
		: PROCEDURAL_SEED_MODULUS;
	let seed = randomIntegerBelow(availableSeedCount);

	if (hasPreviousSeed && seed >= normalizedPreviousSeed) seed += 1;
	return seed;
}

const GAME_MODE_DEFINITIONS = [
	{
		id: "sandbox",
		label: "Sandbox",
		description: "Editable sandbox gameplay using the saved browser config and configured level.",
		available: true,
		allowsEditedConfig: true,
		allowsEditedLevel: true,
		allowsEditedDefaults: true,
		prepareLevel(level) {
			return level;
		},
		configureRuntime() {},
	},
	{
		id: "endless",
		label: "Endless",
		description: "Endless gameplay using the factory config.json and level.json. Browser edits are ignored.",
		available: true,
		allowsEditedConfig: false,
		allowsEditedLevel: false,
		allowsEditedDefaults: false,
		prepareLevel(level, { newRun = false, previousSeed = null } = {}) {
			if (newRun && level.seed !== undefined) {
				level.seed = createProceduralRunSeed(previousSeed ?? level.seed);
			}
			return level;
		},
		configureRuntime() {},
	},
];

function normalizeLegacyGameModeId(id) {
	// The original menu called Sandbox "standard". Keep old session/replay links
	// working while making sandbox the canonical mode id going forward.
	return id === "standard" ? "sandbox" : id;
}

export function getGameModes() {
	return GAME_MODE_DEFINITIONS.map((mode) => ({ ...mode }));
}

export function getGameMode(id) {
	const normalizedId = normalizeLegacyGameModeId(id);
	return (
		GAME_MODE_DEFINITIONS.find(
			(mode) => mode.id === normalizedId && mode.available,
		) || GAME_MODE_DEFINITIONS[0]
	);
}

export function resolveGameModeId(search = window.location.search, fallbackId = "sandbox") {
	const params = new URLSearchParams(search);
	const requested = params.get("mode") || fallbackId;
	return getGameMode(requested).id;
}

export function prepareLevelForGameMode(modeId, level, context = {}) {
	const mode = getGameMode(modeId);
	const clonedLevel = JSON.parse(JSON.stringify(level));
	return mode.prepareLevel
		? mode.prepareLevel(clonedLevel, context)
		: clonedLevel;
}

export function configureGameModeRuntime(modeId, context) {
	const mode = getGameMode(modeId);
	mode.configureRuntime?.(context);
	return mode;
}
