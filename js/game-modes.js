// Game-mode registry. Add future modes here without changing menu navigation.
// A mode can optionally transform the launch level and configure runtime state.

const GAME_MODE_DEFINITIONS = [
	{
		id: "standard",
		label: "Standard",
		description: "Default sandbox/procedural gameplay using the configured level and weapons.",
		available: true,
		prepareLevel(level) {
			return level;
		},
		configureRuntime() {},
	},
];

export function getGameModes() {
	return GAME_MODE_DEFINITIONS.map((mode) => ({ ...mode }));
}

export function getGameMode(id) {
	return (
		GAME_MODE_DEFINITIONS.find((mode) => mode.id === id && mode.available) ||
		GAME_MODE_DEFINITIONS[0]
	);
}

export function resolveGameModeId(search = window.location.search, fallbackId = "standard") {
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
