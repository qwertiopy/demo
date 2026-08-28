// Mode-aware loading for editable combat algorithm constants.

export const COMBAT_DEFAULTS_URL = "js/combat/defaults.json";
export const COMBAT_DEFAULTS_STORAGE_KEY = "demoGameCombatDefaults";

export const CombatDefaults = {};
export const DEFAULTS_SCHEMA_VERSION = 1;

const REQUIRED_DEFAULT_KEYS = [
	"DEFAULTS_SCHEMA_VERSION",
	"SIMULATION_HZ",
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
	for (const key of Object.keys(value)) {
		if (!REQUIRED_DEFAULT_KEYS.includes(key)) {
			throw new Error(`Unknown combat default ${key}.`);
		}
	}

	for (const [key, rawValue] of Object.entries(value)) {
		if (!Number.isFinite(Number(rawValue)) || Number(rawValue) < 0) {
			throw new Error(`${key} must be a non-negative finite number.`);
		}
	}

	if (!Number.isInteger(Number(value.DEFAULT_MAXIMUM_PROJECTILE_COUNT))) {
		throw new Error("DEFAULT_MAXIMUM_PROJECTILE_COUNT must be an integer.");
	}
	if (Number(value.DEFAULTS_SCHEMA_VERSION) !== DEFAULTS_SCHEMA_VERSION) {
		throw new Error(`Unsupported defaults schema ${value.DEFAULTS_SCHEMA_VERSION}.`);
	}
	if (!Number.isInteger(Number(value.SIMULATION_HZ)) || Number(value.SIMULATION_HZ) <= 0) {
		throw new Error("SIMULATION_HZ must be a positive integer.");
	}
	if (!Number.isInteger(Number(value.MAXIMUM_PROJECTILE_COUNT_SAFEGUARD))) {
		throw new Error("MAXIMUM_PROJECTILE_COUNT_SAFEGUARD must be an integer.");
	}
	for (const key of [
		"PROJECTILE_MAX_STEP_BLOCKS",
		"MIN_THROW_DECELERATION",
		"WALL_TOI_EPSILON",
		"WALL_APPROACH_EPSILON",
		"WALL_CONTACT_NUDGE",
		"GEOMETRY_EPSILON",
	]) {
		if (Number(value[key]) <= 0) throw new Error(`${key} must be greater than zero.`);
	}
	for (const key of [
		"MAX_WALL_IMPACTS_PER_SUBSTEP",
		"LASER_CALCULATION_BUDGET_PER_FRAME",
		"ENEMY_AIM_CALCULATION_BUDGET_PER_FRAME",
		"MAX_CHAINED_LASER_SEGMENTS",
	]) {
		if (!Number.isInteger(Number(value[key]))) {
			throw new Error(`${key} must be an integer.`);
		}
	}
	if (Number(value.MAX_WALL_IMPACTS_PER_SUBSTEP) <= 0) {
		throw new Error("MAX_WALL_IMPACTS_PER_SUBSTEP must be greater than zero.");
	}
	if (Number(value.MAX_CHAINED_LASER_SEGMENTS) <= 0) {
		throw new Error("MAX_CHAINED_LASER_SEGMENTS must be greater than zero.");
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
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Number(parsed.DEFAULTS_SCHEMA_VERSION) !== DEFAULTS_SCHEMA_VERSION) {
					loaded = validateDefaults({
						...factoryDefaults,
						...parsed,
						DEFAULTS_SCHEMA_VERSION,
					});
					localStorage.setItem(
						COMBAT_DEFAULTS_STORAGE_KEY,
						JSON.stringify(loaded),
					);
				} else {
					loaded = validateDefaults(parsed);
				}
			}
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

export function getCombatDefaultOr(key, fallback) {
	const value = Number(CombatDefaults[key]);
	return Number.isFinite(value) ? value : Number(fallback);
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
