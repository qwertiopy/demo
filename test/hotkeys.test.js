import test from 'node:test';
import assert from 'node:assert/strict';
import { Hotkeys, normalizeHotkeyConfig, normalizeBindings, getActionsForInput, isActionDown, keyboardEventToInputCode, mouseEventToInputCode, saveLocalHotkeys, readLocalHotkeys } from '../js/hotkeys.js';
import { replaceBinding, validateImportedBindings } from '../js/hotkey-editing.js';

test('bindings survive normalization, storage and runtime lookup without truncation', () => {
    const keys = ['KeyW', 'ArrowUp', 'Space', 'Escape', 'Delete', 'Tab', 'ShiftRight', 'F12', 'Mouse4', ...Array.from({ length: 100 }, (_, i) => `Custom${i}`)];
    const config = normalizeHotkeyConfig({ bindings: { moveUp: keys, shoot: ['Mouse4'] } });
    const stored = new Map();
    globalThis.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
    saveLocalHotkeys(config);
    assert.deepEqual(readLocalHotkeys().bindings.moveUp, keys);
    Object.assign(Hotkeys, normalizeHotkeyConfig({ bindings: {} }, readLocalHotkeys()));
    assert.equal(isActionDown('moveUp', new Set(['Custom99'])), true);
    assert.deepEqual(getActionsForInput('Mouse4'), ['moveUp', 'shoot']);
});

test('adding and replacing bindings deduplicates without removing unrelated keys', () => {
    const original = ['KeyA', 'KeyB', 'KeyC', 'KeyD'];
    assert.deepEqual(replaceBinding(original, null, 'Escape'), [...original, 'Escape']);
    assert.deepEqual(replaceBinding(original, 2, 'KeyA'), ['KeyA', 'KeyB', 'KeyD']);
    assert.deepEqual(original, ['KeyA', 'KeyB', 'KeyC', 'KeyD']);
    assert.deepEqual(normalizeBindings({ shoot: ['Space', 'Space', null, '', 'Mouse0', 'Escape'] }).shoot, ['Space', 'Mouse0', 'Escape']);
});

test('imports allow long lists and unbinding while rejecting malformed actions', () => {
    validateImportedBindings({ shoot: ['KeyA', 'KeyB', 'Mouse0', 'Escape', 'Delete'], moveUp: [] });
    assert.throws(() => validateImportedBindings({ notAnAction: [] }));
    assert.throws(() => validateImportedBindings({ shoot: [''] }));
    assert.throws(() => validateImportedBindings({ shoot: 'Space' }));
    const normalized = normalizeHotkeyConfig({ bindings: { moveUp: ['KeyW'] } }, { bindings: { moveUp: [] } });
    assert.deepEqual(normalized.bindings.moveUp, []);
});

test('physical special keys and additional mouse buttons retain their codes', () => {
    for (const code of ['Escape', 'Delete', 'Tab', 'ControlLeft', 'ShiftRight', 'F12']) {
        assert.equal(keyboardEventToInputCode({ code, key: 'ignored' }), code);
    }
    assert.equal(mouseEventToInputCode({ button: 7 }), 'Mouse7');
});
