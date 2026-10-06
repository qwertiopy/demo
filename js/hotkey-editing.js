import { isKnownAction } from "./hotkeys.js";

// null means append. Replacing with an existing key collapses the duplicate.
export function replaceBinding(bindings, index, inputCode) {
    const next = [...bindings];
    if (index === null) next.push(inputCode);
    else next[index] = inputCode;
    return [...new Set(next)];
}

export function validateImportedBindings(bindings) {
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
        throw new Error("Bindings must be an object.");
    }
    for (const [actionId, entries] of Object.entries(bindings)) {
        if (!isKnownAction(actionId)) throw new Error(`Unknown action: ${actionId}.`);
        if (!Array.isArray(entries) || entries.some((code) => typeof code !== "string" || !code.trim())) {
            throw new Error(`Bindings for ${actionId} must be a list of keys.`);
        }
    }
}
