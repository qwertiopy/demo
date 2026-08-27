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
