# Testing and profiling

The test suite uses Node's built-in test runner and has no package dependencies.

```powershell
npm test
```

The tests intentionally characterize current behaviour, including strict LOS
segment endpoints, inclusive circle tangency, infinite flee-intercept distance,
half-open structure bounds, wall-array result order, and FIFO projectile caps.
Changing one of those assertions is a gameplay decision, not a mechanical
refactor.

Run the repeatable microbenchmarks with:

```powershell
npm run profile
```

For browser profiling, append `?profile=1` to the game URL. The profiler keeps
the latest 600 completed frames and records update, procedural generation,
enemy, projectile, laser, explosion, snapshot/replay, and render durations.
Inspect it from the developer console:

```js
GameProfiler.snapshot()
GameProfiler.reset()
GameProfiler.disable()
GameProfiler.enable({ sampleLimit: 1200 })
```

Profiling is disabled by default. When disabled it does not sample the clock or
retain frame measurements.

## Map editor

Open `menu.html` → **Map Editor** (or `editor.html`) through the same static server as the game.

- Draw with pencil, eraser, fill, line, rectangle, and ellipse. Test shape outlines and the Filled option, brush size, and right-drag erasing.
- Select a region, drag it, copy/paste it, and delete it. Check undo/redo after each operation. Escape should cancel an in-progress gesture.
- Pan with Space-drag/middle-drag and zoom with the wheel. Grid and Fit only change the view.
- Save a map with a player and bot spawns, reload, export JSON, and open the exported file. The tiles should match. New/Open can be undone.
- Play launches Sandbox. Authored maps must not gain corridor walls or lose distant walls/spawns. Endless still uses factory procedural levels.

A tile is one world block. Map dimensions are 2–256 cells on each axis. JSON imports require non-negative integer geometry and supported bot types; procedural levels are not rasterized. The map canvas is an editing extent, not an automatic collision boundary: paint perimeter walls if desired. Save stores the draft in this browser and supplies Sandbox launch options; Export downloads a portable `level.json`.

Automated coverage: `npm test` includes map conversion/fill tests and an authored-level runtime regression test. Visual browser checks must be run manually if Chromium is unavailable.

## Minimal UI and controls

The main menu is a viewport-sized Play target below the top bar. The centered selector changes game mode; the top-right selector opens setup, controls, the map editor, replays, or combat defaults. Opening a dropdown or changing setup must not launch the game. Settings are grouped in collapsed sections; only the selected section is shown. Sandbox-only settings do not alter Endless.

The controls editor shows each action's configured bindings as buttons with an Add (+) button. Select an existing binding to reveal Change/Remove. Add/Change opens input capture: all delivered keyboard codes (including Escape, Tab, Delete, modifiers, and function keys) are assignable. Mouse bindings are captured on the modal's mouse pad; Cancel does not bind a mouse button. There is no binding-count limit. Save applies edits; imports and Reset can be reviewed before saving. Keys may be shared between actions, while duplicates within one action are collapsed.

Automated tests cover long binding lists through normalization/storage/runtime lookup, editor input events, selection/edit/removal/cancel/import/reset, menu dropdown navigation, and Sandbox/Endless launch isolation. The DOM event tests use a lightweight test fixture, not a browser renderer. Manually check desktop/narrow layouts, native dropdowns, actual keyboard and side-mouse capture, and browser-reserved shortcuts. Chromium was unavailable in this execution environment, so visual browser checks remain outstanding.
