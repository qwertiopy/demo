# Testing and profiling

The test suite uses Node's built-in test runner and has no package dependencies.

```powershell
npm test
```

The tests lock the agreed runtime semantics, including a fixed nominal
simulation step with discarded wall-time backlog, strict non-colliding
tangency, radius-aware aim clearance, exact rendered actor shapes, direct aim
for slow projectiles, relationship-based damage, half-open structure bounds,
wall-array result order, and per-owner FIFO projectile caps.

Run the repeatable microbenchmarks with:

```powershell
npm run profile
```

For browser profiling, append `?profile=1` to the game URL. The profiler keeps
the latest 600 completed frames and records update, procedural generation,
enemy, projectile, laser, explosion, snapshot/replay, and render durations. It
also records soft laser-budget overrun and discarded scheduler wall time.
Inspect it from the developer console:

```js
GameProfiler.snapshot()
GameProfiler.reset()
GameProfiler.disable()
GameProfiler.enable({ sampleLimit: 1200 })
```

Profiling is disabled by default. When disabled it does not sample the clock or
retain frame measurements.
