// Launch options shared between the main menu and the game runtime.

export const LAUNCH_OPTIONS_STORAGE_KEY = "demoGameLaunchOptions";

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

export function createDefaultLaunchOptions() {
	return {
		gameModeId: "sandbox",
		level: null,
	};
}

export function normalizeLaunchOptions(value) {
	const defaults = createDefaultLaunchOptions();
	if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;

	const requestedGameModeId =
		typeof value.gameModeId === "string" && value.gameModeId.length > 0
			? value.gameModeId
			: defaults.gameModeId;

	const level =
		value.level && typeof value.level === "object" && !Array.isArray(value.level)
			? clone(value.level)
			: defaults.level;

	// Migrate the old launch-option checkbox into the level definition once.
	if (level && level.invincibility === undefined && value.godMode === true) {
		level.invincibility = true;
	}

	return {
		gameModeId:
			requestedGameModeId === "standard" ? "sandbox" : requestedGameModeId,
		level,
	};
}

export function readLaunchOptions() {
	try {
		const saved = sessionStorage.getItem(LAUNCH_OPTIONS_STORAGE_KEY);
		if (!saved) return createDefaultLaunchOptions();
		return normalizeLaunchOptions(JSON.parse(saved));
	} catch (error) {
		console.warn("Could not read launch options; using defaults.", error);
		return createDefaultLaunchOptions();
	}
}

export function writeLaunchOptions(options) {
	const normalized = normalizeLaunchOptions(options);
	sessionStorage.setItem(LAUNCH_OPTIONS_STORAGE_KEY, JSON.stringify(normalized));
	return normalized;
}

export function resetLaunchOptions() {
	const defaults = createDefaultLaunchOptions();
	writeLaunchOptions(defaults);
	return defaults;
}
