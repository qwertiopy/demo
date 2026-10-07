// Exercise editor event handling and persistence without requiring a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HOTKEY_STORAGE_KEY } from '../js/hotkeys.js';

class Element extends EventTarget {
    children = [];
    attributes = {};
    open = false;
    classList = { toggle() {} };
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
    click() { this.dispatchEvent(new Event('click')); }
}
const ids = ['bindingDialog', 'captureTitle', 'captureHint', 'captureMouseArea', 'cancelCaptureBtn', 'hotkeyGroups', 'statusMessage', 'saveHotkeysBtn', 'resetHotkeysBtn', 'importHotkeysBtn', 'importHotkeysFileInput', 'exportHotkeysBtn'];
const elements = new Map(ids.map(id => [id, Object.assign(new Element(), { id })]));
function descendants(element) { return [element, ...element.children.flatMap(descendants)]; }
const $ = id => elements.get(id) || descendants(elements.get('hotkeyGroups')).find(el => el.id === id);
globalThis.document = { getElementById: $, createElement: () => new Element() };
globalThis.window = new EventTarget();
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
const defaults = JSON.parse(await readFile(new URL('../hotkeys.json', import.meta.url), 'utf8'));
globalThis.fetch = async () => ({ ok: true, json: async () => defaults });
await import('../js/hotkey-editor.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
await settle();
function input(code) {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, key: code, repeat: false });
    window.dispatchEvent(event);
    return event;
}
function saveAndRead() { $('saveHotkeysBtn').click(); return JSON.parse(storage.get(HOTKEY_STORAGE_KEY)); }

test('editor adds special keys, selects/edits/removes buttons, cancels, and imports many bindings', async () => {
    for (const code of ['Escape', 'Delete', 'Tab', 'ShiftRight', 'F12']) {
        $('add-shoot').click();
        assert.equal($('bindingDialog').open, true);
        assert.equal(input(code).defaultPrevented, true);
        assert.equal($('bindingDialog').open, false);
    }
    assert.deepEqual(saveAndRead().bindings.shoot, ['Mouse0', 'Space', 'Escape', 'Delete', 'Tab', 'ShiftRight', 'F12']);
    $('binding-shoot-2').click();
    assert.equal($('binding-shoot-2').attributes['aria-pressed'], 'true');
    const actionButton = label => descendants($('hotkeyGroups')).find(el => el.textContent === label);
    actionButton('Change').click();
    input('ControlLeft');
    assert.equal(saveAndRead().bindings.shoot[2], 'ControlLeft');
    actionButton('Remove').click();
    assert.equal(saveAndRead().bindings.shoot.includes('ControlLeft'), false);
    const before = saveAndRead();
    $('add-shoot').click();
    $('cancelCaptureBtn').click();
    input('KeyX');
    assert.deepEqual(saveAndRead(), before);
    $('add-shoot').click();
    const mouse = new Event('mousedown', { cancelable: true });
    Object.assign(mouse, { button: 4 });
    $('captureMouseArea').dispatchEvent(mouse);
    assert.equal(mouse.defaultPrevented, true);
    assert.equal(saveAndRead().bindings.shoot.at(-1), 'Mouse4');
    const keys = Array.from({ length: 40 }, (_, i) => `Key${i}`);
    $('importHotkeysFileInput').files = [{ name: 'many.json', text: async () => JSON.stringify({ bindings: { shoot: keys } }) }];
    $('importHotkeysFileInput').dispatchEvent(new Event('change'));
    await settle();
    assert.deepEqual(saveAndRead().bindings.shoot, keys);
    $('resetHotkeysBtn').click();
    assert.deepEqual(saveAndRead().bindings.shoot, defaults.bindings.shoot);
});
