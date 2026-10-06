import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAUNCH_OPTIONS_STORAGE_KEY } from '../js/launch-options.js';

class Element extends EventTarget {
    children = [];
    value = '';
    hidden = false;
    disabled = false;
    dataset = {};
    classList = { toggle() {}, remove() {}, add() {} };
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    click() { this.dispatchEvent(new Event('click')); }
}
const html = await readFile(new URL('../menu.html', import.meta.url), 'utf8');
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
const panels = ['play', 'level', 'replays', 'config'].map(id => Object.assign(new Element(), { dataset: { menuPanel: id } }));
const $ = id => elements.get(id);
globalThis.document = {
    getElementById: $, createElement: () => new Element(),
    querySelectorAll: selector => selector === '[data-menu-panel]' ? panels : [],
    body: new Element(),
};
globalThis.window = Object.assign(new EventTarget(), { location: { href: 'menu.html', hash: '' } });
globalThis.history = { replaceState: (_state, _title, hash) => { window.location.hash = hash; } };
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
const factoryLevel = JSON.parse(await readFile(new URL('../level.json', import.meta.url), 'utf8'));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(factoryLevel) });
// No replay in the browser store; fulfill the same request lifecycle as IndexedDB.
globalThis.indexedDB = { open() {
    const request = {};
    request.result = {
        close() {}, transaction() { return { objectStore() { return { get() {
            const result = { result: null };
            queueMicrotask(() => result.onsuccess());
            return result;
        } }; } }; },
    };
    queueMicrotask(() => request.onsuccess());
    return request;
} };
await import('../js/menu.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
await settle();
function change(id, value) { $(id).value = value; $(id).dispatchEvent(new Event('change')); }
function visiblePanel() { return panels.find(p => !p.hidden)?.dataset.menuPanel; }

test('menu dropdowns navigate independently and launch the selected mode', async () => {
    assert.equal(visiblePanel(), 'play');
    assert.equal($('launchGameBtn').disabled, false);
    assert.deepEqual($('gameModeSelect').children.map(option => option.value), ['sandbox', 'endless']);
    change('setupSelect', 'config');
    assert.equal(visiblePanel(), 'config');
    assert.equal($('backToPlay').hidden, false);
    assert.equal(window.location.href, 'menu.html');
    $('backToPlay').click();
    assert.equal(visiblePanel(), 'play');
    change('setupSelect', 'hotkeys.html');
    assert.equal(window.location.href, 'hotkeys.html');
    // Returning from another page restores the menu selector.
    window.dispatchEvent(new Event('pageshow'));
    assert.equal($('setupSelect').value, 'play');
    window.location.href = 'menu.html';
    $('menuLevelData').value = '{bad json';
    change('gameModeSelect', 'endless');
    $('launchGameBtn').click();
    assert.equal(window.location.href, 'index.html?mode=endless');
    window.location.href = 'menu.html';
    change('gameModeSelect', 'sandbox');
    $('launchGameBtn').click();
    assert.equal(window.location.href, 'menu.html');
    assert.equal(visiblePanel(), 'level');
    assert.equal($('levelJsonDetails').open, true);
    const level = { player: { spawn: { x: 3, y: 2 } }, walls: [], enemySpawns: [] };
    $('menuLevelData').value = JSON.stringify(level);
    $('launchGameBtn').click();
    assert.equal(window.location.href, 'index.html?mode=sandbox');
    assert.deepEqual(JSON.parse(storage.get(LAUNCH_OPTIONS_STORAGE_KEY)).level, level);
    $('resetLaunchOptionsBtn').click();
    await settle();
    assert.equal($('gameModeSelect').value, 'sandbox');
    assert.equal(JSON.parse($('menuLevelData').value).seed, factoryLevel.seed);
});
