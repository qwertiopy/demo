// Loads the factory level definition from level.json.

export const DEFAULT_LEVEL_URL = "level.json";

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function validateLevelDefinition(level) {
	if (!level || typeof level !== "object" || Array.isArray(level)) {
		throw new Error("level.json must contain one JSON object.");
	}
	return level;
}

let cachedDefaultLevel = null;

export async function loadDefaultLevelDefinition({ reload = false } = {}) {
	if (!reload && cachedDefaultLevel !== null) {
		return clone(cachedDefaultLevel);
	}

	const response = await fetch(DEFAULT_LEVEL_URL, { cache: "no-store" });
	if (!response.ok) {
		throw new Error(
			`Failed to load ${DEFAULT_LEVEL_URL} (HTTP ${response.status}).`,
		);
	}

	const level = validateLevelDefinition(await response.json());
	cachedDefaultLevel = clone(level);
	return clone(cachedDefaultLevel);
}
