import {
    HOTKEY_ACTIONS,
    MAX_BINDINGS_PER_ACTION,
    clearLocalHotkeys,
    fetchDefaultHotkeys,
    formatInputCode,
    isKnownAction,
    mouseEventToInputCode,
    normalizeHotkeyConfig,
    readLocalHotkeys,
    saveLocalHotkeys,
    keyboardEventToInputCode,
} from "./hotkeys.js";
import { readJsonObjectFile } from "./json-file.js";

let defaultHotkeys = null;
let hotkeys = null;
let capture = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function showStatus(message, error = false) {
    const status = document.getElementById("statusMessage");
    status.textContent = message;
    status.classList.toggle("error", error);
}

function groupActions() {
    const groups = new Map();

    HOTKEY_ACTIONS.forEach((action) => {
        if (!groups.has(action.group)) groups.set(action.group, []);
        groups.get(action.group).push(action);
    });

    return groups;
}

function stopCapture() {
    if (!capture) return;

    capture.button.classList.remove("listening");
    capture = null;
    window.removeEventListener("keydown", handleCaptureKeyDown, true);
    window.removeEventListener("mousedown", handleCaptureMouseDown, true);
}

function assignBinding(actionId, slot, inputCode) {
    const bindings = [...(hotkeys.bindings[actionId] || [])];

    while (bindings.length < MAX_BINDINGS_PER_ACTION) bindings.push(null);

    // Do not store the exact same input twice on one action. The same input is
    // intentionally allowed on different actions.
    bindings.forEach((binding, index) => {
        if (index !== slot && binding === inputCode) bindings[index] = null;
    });

    bindings[slot] = inputCode;
    hotkeys.bindings[actionId] = bindings.filter(Boolean);
}

function handleCaptureKeyDown(event) {
    event.preventDefault();
    event.stopPropagation();

    const { actionId, slot } = capture;
    assignBinding(actionId, slot, keyboardEventToInputCode(event));
    stopCapture();
    render();
    showStatus("Binding changed. Click Save Locally to persist it.");
}

function handleCaptureMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();

    const { actionId, slot } = capture;
    assignBinding(actionId, slot, mouseEventToInputCode(event));
    stopCapture();
    render();
    showStatus("Binding changed. Click Save Locally to persist it.");
}

function startCapture(actionId, slot, button) {
    stopCapture();

    capture = { actionId, slot, button };
    button.classList.add("listening");
    button.textContent = "Press key / mouse…";
    showStatus("Waiting for an input…");

    // Delay listener installation so the click that opened capture is not
    // itself captured as Mouse0.
    requestAnimationFrame(() => {
        if (!capture) return;
        window.addEventListener("keydown", handleCaptureKeyDown, true);
        window.addEventListener("mousedown", handleCaptureMouseDown, true);
    });
}

function clearBinding(actionId, slot) {
    const bindings = [...(hotkeys.bindings[actionId] || [])];

    if (slot < bindings.length) bindings.splice(slot, 1);

    hotkeys.bindings[actionId] = bindings.slice(0, MAX_BINDINGS_PER_ACTION);
    render();
    showStatus("Binding cleared. Click Save Locally to persist it.");
}

function createBindingButton(actionId, slot, inputCode) {
    const wrapper = document.createElement("div");
    wrapper.className = "hotkey-slot";

    const bindButton = document.createElement("button");
    bindButton.type = "button";
    bindButton.className = "hotkey-bind-btn";
    bindButton.textContent = formatInputCode(inputCode);
    bindButton.addEventListener("click", () =>
        startCapture(actionId, slot, bindButton),
    );

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "hotkey-clear-btn";
    clearButton.textContent = "Clear";
    clearButton.disabled = !inputCode;
    clearButton.addEventListener("click", () => clearBinding(actionId, slot));

    wrapper.append(bindButton, clearButton);
    return wrapper;
}

function render() {
    if (!hotkeys) return;

    stopCapture();

    const container = document.getElementById("hotkeyGroups");
    container.replaceChildren();

    groupActions().forEach((actions, groupName) => {
        const section = document.createElement("div");
        section.className = "hotkey-group";

        const heading = document.createElement("h3");
        heading.textContent = groupName;
        section.appendChild(heading);

        actions.forEach((action) => {
            const row = document.createElement("div");
            row.className = "hotkey-row";

            const label = document.createElement("div");
            label.className = "hotkey-action-label";
            label.textContent = action.label;
            row.appendChild(label);

            const bindings = hotkeys.bindings[action.id] || [];

            for (let slot = 0; slot < MAX_BINDINGS_PER_ACTION; slot++) {
                row.appendChild(
                    createBindingButton(action.id, slot, bindings[slot] || null),
                );
            }

            section.appendChild(row);
        });

        container.appendChild(section);
    });
}

function save() {
    try {
        const normalized = normalizeHotkeyConfig(defaultHotkeys, hotkeys);
        hotkeys = clone(normalized);
        saveLocalHotkeys(hotkeys);
        render();
        showStatus("Hotkeys saved locally. Reload the game to apply them.");
    } catch (error) {
        showStatus("Could not save hotkeys: " + error.message, true);
    }
}

function exportHotkeys() {
    const normalized = normalizeHotkeyConfig(defaultHotkeys, hotkeys);
    const blob = new Blob([JSON.stringify(normalized, null, 4)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "hotkeys.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showStatus("hotkeys.json exported successfully.");
}

async function importHotkeysFile() {
    const input = document.getElementById("importHotkeysFileInput");
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (!defaultHotkeys) {
        showStatus("Hotkeys have not finished loading yet.", true);
        return;
    }

    try {
        const importedHotkeys = await readJsonObjectFile(file, "hotkeys.json");
        const bindings = importedHotkeys.bindings;

        if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
            throw new Error("hotkeys.json.bindings must be a JSON object.");
        }

        for (const [actionId, actionBindings] of Object.entries(bindings)) {
            if (!isKnownAction(actionId)) {
                throw new Error(`Unknown hotkey action: ${actionId}.`);
            }
            if (!Array.isArray(actionBindings)) {
                throw new Error(`Bindings for ${actionId} must be an array.`);
            }
            if (actionBindings.length > MAX_BINDINGS_PER_ACTION) {
                throw new Error(
                    `${actionId} has more than ${MAX_BINDINGS_PER_ACTION} bindings.`,
                );
            }
            if (
                actionBindings.some(
                    (binding) => typeof binding !== "string" || !binding.trim(),
                )
            ) {
                throw new Error(
                    `Every binding for ${actionId} must be a non-empty string.`,
                );
            }
        }

        hotkeys = clone(normalizeHotkeyConfig(defaultHotkeys, importedHotkeys));
        saveLocalHotkeys(hotkeys);
        render();
        showStatus(`Imported and saved ${file.name}. Reload the game to apply it.`);
    } catch (error) {
        showStatus(`Could not import hotkeys.json: ${error.message}`, true);
    }
}

function reset() {
    if (!defaultHotkeys) return;

    clearLocalHotkeys();
    hotkeys = normalizeHotkeyConfig(defaultHotkeys);
    render();
    showStatus("Local hotkeys cleared. Restored hotkeys.json defaults.");
}

async function init() {
    try {
        defaultHotkeys = await fetchDefaultHotkeys();
        hotkeys = normalizeHotkeyConfig(defaultHotkeys, readLocalHotkeys());
        render();
        showStatus(
            readLocalHotkeys()
                ? "Locally saved hotkeys loaded."
                : "hotkeys.json defaults loaded. No local save yet.",
        );
    } catch (error) {
        showStatus(error.message, true);
    }
}

document.getElementById("saveHotkeysBtn").addEventListener("click", save);
document.getElementById("importHotkeysBtn").addEventListener("click", () => {
    document.getElementById("importHotkeysFileInput").click();
});
document
    .getElementById("importHotkeysFileInput")
    .addEventListener("change", importHotkeysFile);
document
    .getElementById("exportHotkeysBtn")
    .addEventListener("click", exportHotkeys);
document.getElementById("resetHotkeysBtn").addEventListener("click", reset);

init();
