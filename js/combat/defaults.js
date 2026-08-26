// Mode-aware loading for editable combat algorithm constants.

export const COMBAT_DEFAULTS_URL = "js/combat/defaults.json";
export const COMBAT_DEFAULTS_STORAGE_KEY = "demoGameCombatDefaults";

export const CombatDefaults = {};

const REQUIRED_DEFAULT_KEYS = [
	"DEFAULT_MAXIMUM_PROJECTILE_COUNT",
	"MAXIMUM_PROJECTILE_COUNT_SAFEGUARD",
	"PROJECTILE_MAX_STEP_BLOCKS",
	"MAX_WALL_IMPACTS_PER_SUBSTEP",
	"MIN_THROW_DECELERATION",
	"WALL_TOI_EPSILON",
	"WALL_APPROACH_EPSILON",
	"WALL_CONTACT_NUDGE",
	"GEOMETRY_EPSILON",
	"LASER_CALCULATION_BUDGET_PER_FRAME",
	"ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME",
	"MAX_CHAINED_LASER_SEGMENTS",
];

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function validateDefaults(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("defaults.json must contain one JSON object.");
	}
	for (const key of REQUIRED_DEFAULT_KEYS) {
		if (!(key in value)) throw new Error(`${key} is required.`);
	}

	for (const [key, rawValue] of Object.entries(value)) {
		if (!Number.isFinite(Number(rawValue)) || Number(rawValue) < 0) {
			throw new Error(`${key} must be a non-negative finite number.`);
		}
	}

	if (!Number.isInteger(Number(value.DEFAULT_MAXIMUM_PROJECTILE_COUNT))) {
		throw new Error("DEFAULT_MAXIMUM_PROJECTILE_COUNT must be an integer.");
	}
	if (!Number.isInteger(Number(value.MAXIMUM_PROJECTILE_COUNT_SAFEGUARD))) {
		throw new Error("MAXIMUM_PROJECTILE_COUNT_SAFEGUARD must be an integer.");
	}
	if (
		Number(value.DEFAULT_MAXIMUM_PROJECTILE_COUNT) >
		Number(value.MAXIMUM_PROJECTILE_COUNT_SAFEGUARD)
	) {
		throw new Error(
			"DEFAULT_MAXIMUM_PROJECTILE_COUNT cannot exceed the safeguard.",
		);
	}

	return value;
}

export async function loadFactoryCombatDefaults() {
	const response = await fetch(COMBAT_DEFAULTS_URL, { cache: "no-store" });
	if (!response.ok) {
		throw new Error(
			`Failed to load ${COMBAT_DEFAULTS_URL} (HTTP ${response.status}).`,
		);
	}
	return clone(validateDefaults(await response.json()));
}

export async function loadCombatDefaults({ allowLocal = true } = {}) {
	const factoryDefaults = await loadFactoryCombatDefaults();
	let loaded = factoryDefaults;

	if (allowLocal) {
		try {
			const saved = localStorage.getItem(COMBAT_DEFAULTS_STORAGE_KEY);
			if (saved) loaded = validateDefaults(JSON.parse(saved));
		} catch (error) {
			console.warn("Could not load local combat defaults; using factory.", error);
		}
	}

	for (const key of Object.keys(CombatDefaults)) delete CombatDefaults[key];
	Object.assign(CombatDefaults, clone(loaded));
	return clone(CombatDefaults);
}

export function getCombatDefault(key) {
	const value = CombatDefaults[key];
	if (!Number.isFinite(Number(value))) {
		throw new Error(`Combat default ${key} has not been loaded.`);
	}
	return Number(value);
}

export function saveLocalCombatDefaults(value) {
	const validated = clone(validateDefaults(value));
	localStorage.setItem(
		COMBAT_DEFAULTS_STORAGE_KEY,
		JSON.stringify(validated),
	);
	return validated;
}

export function resetLocalCombatDefaults() {
	localStorage.removeItem(COMBAT_DEFAULTS_STORAGE_KEY);
}

export { validateDefaults as validateCombatDefaults };
