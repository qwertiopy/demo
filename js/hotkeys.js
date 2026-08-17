// Hotkey definitions, local persistence, input-code helpers, and action lookup.

export const HOTKEY_STORAGE_KEY = "demoGameHotkeys";
export const MAX_BINDINGS_PER_ACTION = 2;

export const HOTKEY_ACTIONS = [
	{ id: "moveUp", label: "Move Up", group: "Movement" },
	{ id: "moveDown", label: "Move Down", group: "Movement" },
	{ id: "moveLeft", label: "Move Left", group: "Movement" },
	{ id: "moveRight", label: "Move Right", group: "Movement" },
	{ id: "shoot", label: "Shoot", group: "Combat" },
	{ id: "autofire", label: "Auto Fire", group: "Combat" },
	{ id: "respawn", label: "Respawn", group: "Interface" },
	{ id: "toggleUI", label: "Toggle Debug UI", group: "Interface" },
	{ id: "weapon1", label: "Select Weapon 1", group: "Weapons" },
	{ id: "weapon2", label: "Select Weapon 2", group: "Weapons" },
	{ id: "weapon3", label: "Select Weapon 3", group: "Weapons" },
	{ id: "weapon4", label: "Select Weapon 4", group: "Weapons" },
	{ id: "weapon5", label: "Select Weapon 5", group: "Weapons" },
	{ id: "weapon6", label: "Select Weapon 6", group: "Weapons" },
	{ id: "weapon7", label: "Select Weapon 7", group: "Weapons" },
	{ id: "weapon8", label: "Select Weapon 8", group: "Weapons" },
	{ id: "weapon9", label: "Select Weapon 9", group: "Weapons" },
	{ id: "weapon10", label: "Select Weapon 10", group: "Weapons" },
];

const ACTION_IDS = new Set(HOTKEY_ACTIONS.map((action) => action.id));

export const Hotkeys = { HOTKEY_SCHEMA_VERSION: 2, bindings: {} };

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

export function normalizeBindings(bindings, defaults = {}) {
	const normalized = {};

	HOTKEY_ACTIONS.forEach(({ id }) => {
		const source = Array.isArray(bindings?.[id])
			? bindings[id]
			: Array.isArray(defaults?.[id])
				? defaults[id]
				: [];

		normalized[id] = [];

		for (const binding of source) {
			if (typeof binding !== "string" || binding.length === 0) continue;
			if (normalized[id].includes(binding)) continue;

			normalized[id].push(binding);

			if (normalized[id].length >= MAX_BINDINGS_PER_ACTION) break;
		}
	});

	return normalized;
}

export function normalizeHotkeyConfig(defaultConfig, override = null) {
	if (!isPlainObject(defaultConfig)) {
		throw new Error("hotkeys.json must contain a JSON object.");
	}

	const normalized = {
		HOTKEY_SCHEMA_VERSION: defaultConfig.HOTKEY_SCHEMA_VERSION ?? 1,
		bindings: normalizeBindings(defaultConfig.bindings),
	};

	if (!isPlainObject(override)) return normalized;

	normalized.bindings = normalizeBindings(
		override.bindings,
		normalized.bindings,
	);

	return normalized;
}

export function readLocalHotkeys() {
	try {
		const savedJson = localStorage.getItem(HOTKEY_STORAGE_KEY);
		if (!savedJson) return null;

		const saved = JSON.parse(savedJson);
		return isPlainObject(saved) ? saved : null;
	} catch (error) {
		console.warn("Could not read locally saved hotkeys.", error);
		return null;
	}
}

export function saveLocalHotkeys(hotkeyConfig) {
	localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(hotkeyConfig));
}

export function clearLocalHotkeys() {
	localStorage.removeItem(HOTKEY_STORAGE_KEY);
}

export async function fetchDefaultHotkeys() {
	const response = await fetch("hotkeys.json", { cache: "no-store" });

	if (!response.ok) {
		throw new Error(
			`Failed to load hotkeys.json (HTTP ${response.status}).`,
		);
	}

	return response.json();
}

export async function loadHotkeys() {
	const defaults = await fetchDefaultHotkeys();
	const saved = readLocalHotkeys();
	const loaded = normalizeHotkeyConfig(defaults, saved);

	Object.assign(Hotkeys, clone(loaded));

	if (
		saved &&
		saved.HOTKEY_SCHEMA_VERSION !== defaults.HOTKEY_SCHEMA_VERSION
	) {
		saveLocalHotkeys(loaded);
	}

	window.Hotkeys = Hotkeys;
	return Hotkeys;
}

export function getBindings(actionId) {
	return Array.isArray(Hotkeys.bindings[actionId])
		? Hotkeys.bindings[actionId]
		: [];
}

export function getActionsForInput(inputCode) {
	if (typeof inputCode !== "string") return [];

	return HOTKEY_ACTIONS.filter(({ id }) =>
		getBindings(id).includes(inputCode),
	).map(({ id }) => id);
}

export function isActionDown(actionId, pressedInputs) {
	const bindings = getBindings(actionId);

	return bindings.some((binding) => pressedInputs.has(binding));
}

export function keyboardEventToInputCode(event) {
	return event.code || event.key;
}

export function mouseEventToInputCode(event) {
	return `Mouse${event.button}`;
}

export function isKnownAction(actionId) {
	return ACTION_IDS.has(actionId);
}

export function formatInputCode(inputCode) {
	if (!inputCode) return "Unbound";

	const mouseLabels = {
		Mouse0: "Mouse Left",
		Mouse1: "Mouse Middle",
		Mouse2: "Mouse Right",
		Mouse3: "Mouse Back",
		Mouse4: "Mouse Forward",
	};

	if (mouseLabels[inputCode]) return mouseLabels[inputCode];
	if (inputCode === "Space") return "Space";
	if (inputCode.startsWith("Key")) return inputCode.slice(3);
	if (inputCode.startsWith("Digit")) return inputCode.slice(5);

	return inputCode
		.replace("Arrow", "Arrow ")
		.replace("Left", " Left")
		.replace("Right", " Right")
		.trim();
}
