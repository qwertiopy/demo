// Game-mode registry. Add future modes here without changing menu navigation.
// A mode can optionally transform the launch level, choose its config policy,
// and configure runtime state.

const GAME_MODE_DEFINITIONS = [
	{
		id: "sandbox",
		label: "Sandbox",
		description: "Editable sandbox gameplay using the saved browser config and configured level.",
		available: true,
		allowsEditedConfig: true,
		allowsEditedLevel: true,
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
		prepareLevel(level) {
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

export function prepareLevelForGameMode(modeId, level) {
	const mode = getGameMode(modeId);
	const clonedLevel = JSON.parse(JSON.stringify(level));
	return mode.prepareLevel ? mode.prepareLevel(clonedLevel) : clonedLevel;
}

export function configureGameModeRuntime(modeId, context) {
	const mode = getGameMode(modeId);
	mode.configureRuntime?.(context);
	return mode;
}
