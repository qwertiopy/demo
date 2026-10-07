import {
    HOTKEY_ACTIONS, fetchDefaultHotkeys, formatInputCode,
    normalizeHotkeyConfig, readLocalHotkeys, saveLocalHotkeys,
    keyboardEventToInputCode, mouseEventToInputCode,
} from "./hotkeys.js";
import { readJsonObjectFile } from "./json-file.js";
import { replaceBinding, validateImportedBindings } from "./hotkey-editing.js";

const $ = (id) => document.getElementById(id);
const dialog = $("bindingDialog");
let defaultHotkeys = null;
let hotkeys = null;
let selected = null;
let capture = null;
let dirty = false;
let mouseFollowupUntil = 0;

// Side buttons can navigate on mouseup/auxclick after the modal has closed.
for (const type of ["mouseup", "auxclick", "contextmenu"]) {
    window.addEventListener(type, (event) => {
        if (performance.now() > mouseFollowupUntil) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

function showStatus(message, error = false) {
    $("statusMessage").textContent = message;
    $("statusMessage").classList.toggle("error", error);
}

function stopCapture() {
    capture = null;
    window.removeEventListener("keydown", captureKey, true);
    if (dialog.open) dialog.close();
}

function render(focus = null) {
    const container = $("hotkeyGroups");
    container.replaceChildren();
    let section;
    let group;
    for (const action of HOTKEY_ACTIONS) {
        if (action.group !== group) {
            group = action.group;
            section = document.createElement("section");
            section.className = "hotkey-group";
            const heading = document.createElement("h2");
            heading.textContent = group;
            section.append(heading);
            container.append(section);
        }
        const row = document.createElement("div");
        row.className = "hotkey-row";
        const label = document.createElement("span");
        label.className = "hotkey-action-label";
        label.id = `label-${action.id}`;
        label.textContent = action.label;
        const list = document.createElement("div");
        list.className = "hotkey-bindings";
        list.setAttribute("role", "group");
        list.setAttribute("aria-labelledby", label.id);
        (hotkeys.bindings[action.id] || []).forEach((code, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "hotkey-bind-btn";
            button.id = `binding-${action.id}-${index}`;
            button.textContent = formatInputCode(code);
            button.title = code;
            button.setAttribute("aria-pressed", selected?.actionId === action.id && selected.index === index);
            button.addEventListener("click", () => {
                selected = { actionId: action.id, index };
                render(button.id);
            });
            list.append(button);
        });
        const add = document.createElement("button");
        add.type = "button";
        add.id = `add-${action.id}`;
        add.className = "hotkey-add-btn";
        add.textContent = "+";
        add.setAttribute("aria-label", `Add binding for ${action.label}`);
        add.addEventListener("click", () => startCapture(action.id));
        list.append(add);
        row.append(label, list);
        if (selected?.actionId === action.id) {
            const actions = document.createElement("div");
            actions.className = "hotkey-selection-actions";
            const change = document.createElement("button");
            change.type = "button";
            change.textContent = "Change";
            change.addEventListener("click", () => startCapture(action.id, selected.index));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove";
            remove.addEventListener("click", () => {
                hotkeys.bindings[action.id].splice(selected.index, 1);
                selected = null;
                dirty = true;
                render(add.id);
                showStatus("Binding removed. Save to apply.");
            });
            actions.append(change, remove);
            row.append(actions);
        }
        section.append(row);
    }
    if (focus) $(focus)?.focus();
}

function startCapture(actionId, index = null) {
    stopCapture();
    capture = { actionId, index };
    const action = HOTKEY_ACTIONS.find((item) => item.id === actionId);
    $("captureTitle").textContent = `${index === null ? "Add" : "Change"} · ${action.label}`;
    dialog.showModal();
    window.addEventListener("keydown", captureKey, true);
}

function acceptInput(code) {
    if (!capture || !code || code === "Unidentified") return;
    const { actionId, index } = capture;
    hotkeys.bindings[actionId] = replaceBinding(hotkeys.bindings[actionId], index, code);
    selected = { actionId, index: hotkeys.bindings[actionId].indexOf(code) };
    dirty = true;
    stopCapture();
    render(`binding-${actionId}-${selected.index}`);
    showStatus("Binding changed. Save to apply.");
}

function captureKey(event) {
    if (!capture) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) acceptInput(keyboardEventToInputCode(event));
}

// Mouse capture is scoped to this pad so Cancel never becomes a binding.
$("captureMouseArea").addEventListener("mousedown", (event) => {
    if (!capture) return;
    event.preventDefault();
    event.stopPropagation();
    mouseFollowupUntil = performance.now() + 500;
    acceptInput(mouseEventToInputCode(event));
});
$("captureMouseArea").addEventListener("contextmenu", (event) => event.preventDefault());
$("captureMouseArea").addEventListener("auxclick", (event) => event.preventDefault());
dialog.addEventListener("cancel", (event) => event.preventDefault());
dialog.addEventListener("close", () => { if (!dialog.open) stopCapture(); });
$("cancelCaptureBtn").addEventListener("click", stopCapture);

function save() {
    if (!hotkeys) return;
    try {
        const normalized = normalizeHotkeyConfig(defaultHotkeys, hotkeys);
        saveLocalHotkeys(normalized);
        hotkeys = normalized;
        dirty = false;
        showStatus("Saved");
    } catch (error) {
        showStatus(`Could not save: ${error.message}`, true);
    }
}

$("saveHotkeysBtn").addEventListener("click", save);
$("resetHotkeysBtn").addEventListener("click", () => {
    if (!defaultHotkeys) return;
    stopCapture();
    hotkeys = normalizeHotkeyConfig(defaultHotkeys);
    selected = null;
    dirty = true;
    render();
    showStatus("Defaults restored. Save to apply.");
});
$("importHotkeysBtn").addEventListener("click", () => $("importHotkeysFileInput").click());
$("importHotkeysFileInput").addEventListener("change", async () => {
    const file = $("importHotkeysFileInput").files?.[0];
    $("importHotkeysFileInput").value = "";
    if (!file || !defaultHotkeys) return;
    try {
        const imported = await readJsonObjectFile(file, "hotkeys.json");
        validateImportedBindings(imported.bindings);
        hotkeys = normalizeHotkeyConfig(defaultHotkeys, imported);
        selected = null;
        dirty = true;
        render();
        showStatus(`Imported ${file.name}. Save to apply.`);
    } catch (error) {
        showStatus(`Could not import: ${error.message}`, true);
    }
});
$("exportHotkeysBtn").addEventListener("click", () => {
    if (!hotkeys) return;
    const normalized = normalizeHotkeyConfig(defaultHotkeys, hotkeys);
    const url = URL.createObjectURL(new Blob([JSON.stringify(normalized, null, 4)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "hotkeys.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus("Exported hotkeys.json");
});
window.addEventListener("beforeunload", (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
});

async function init() {
    try {
        defaultHotkeys = await fetchDefaultHotkeys();
        hotkeys = normalizeHotkeyConfig(defaultHotkeys, readLocalHotkeys());
        render();
        for (const id of ["saveHotkeysBtn", "importHotkeysBtn", "exportHotkeysBtn", "resetHotkeysBtn"]) $(id).disabled = false;
        showStatus("");
    } catch (error) {
        showStatus(`Could not load controls: ${error.message}`, true);
    }
}
init();
