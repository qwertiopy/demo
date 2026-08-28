# Full project refactor: beta validation guide

This guide validates the full-project refactor without relying on assumptions
about intended behavior. It records the agreed semantics, gives repeatable test
procedures, and defines the evidence needed for useful bug reports.

## 1. What this beta changes

The refactor standardizes the simulation clock, combat execution, geometry,
teams, configuration validation, procedural-level lifecycle, replay storage,
and runtime profiling. It also adds characterization and regression tests.

The intended outcomes are:

- The simulation advances by one fixed nominal step per scheduler callback.
- Delayed browser wall time is discarded; it is never caught up.
- In localhost, pausing the server tab pauses the game.
- Every cooldown and timed effect uses the same internal simulation clock.
- Started laser shots complete atomically, even when the soft calculation
  budget is exceeded.
- Projectile effects resolve in this order: bounce, chain, explosion, split,
  terminal impact.
- Collision is processed before projectile expiry.
- Exact tangency, including corner tangency, is not a collision.
- Actors collide using their rendered circle or simple polygon; projectiles
  use circle collision.
- Detection LOS is a thin line. Aim/path clearance accounts for the complete
  projectile radius.
- Slow projectiles use direct point-and-shoot LOS rather than interception.
- Chained projectiles continuously scan, steer, and use radius-safe greedy
  corner waypoints.
- Explicit levels never run procedural generation or procedural cleanup.
- Spawn delays do not create a catch-up backlog.
- Dead actors become ineligible immediately.
- Projectiles retain separate `ownerId` and `team`; hostility is relationship
  based and projectile limits remain per owner.
- Respawns are marked as segments inside the same replay recording.
- Imported data is automatically migrated, then strictly validated.
- Combat randomness remains intentionally unseeded.
- Non-native aspect ratios are letterboxed rather than stretched.

## 2. Prerequisites and installation

Test on a copy or clean branch. Export any config, level, or replay data that
must be retained before starting. Record the pre-beta commit or archive name.

This patch is incremental. Apply
`behavior-preserving-tests-profiler-refactor.patch` first, then apply
`full-project-refactor.patch` from the project directory.

PowerShell:

```powershell
git status --short
git apply --check --ignore-space-change --whitespace=nowarn --exclude=config.json "C:\Users\Felix\Downloads\full-project-refactor.patch"
if ($LASTEXITCODE -eq 0) {
    git apply --ignore-space-change --whitespace=nowarn --exclude=config.json "C:\Users\Felix\Downloads\full-project-refactor.patch"
}
npm test
npm run profile
node .\polyomino-structures.mjs --validate
```

Do not continue if `git apply --check` fails. Save its complete output and the
result of `git status --short` in the report.

`config.json` is deliberately excluded. `level.json` is migrated to level
schema version 1 by the patch. User-imported data is migrated at load time and
then validated; migration does not make invalid values valid.

## 3. Required test environment record

Complete this once per tester/environment:

- [ ] Beta patch filename and checksum recorded.
- [ ] Pre-beta commit/archive recorded.
- [ ] Operating system and version recorded.
- [ ] Browser and exact version recorded.
- [ ] CPU, memory, and GPU recorded for performance reports.
- [ ] Display resolution and browser zoom recorded.
- [ ] Test mode recorded: localhost tab, hosted client, or dedicated server.
- [ ] Config source recorded: factory, existing migrated, or imported.
- [ ] Console begins without uncaught errors.
- [ ] `npm test` passes.
- [ ] `npm run profile` completes.
- [ ] Polyomino validation completes successfully.

## 4. Smoke test

1. Start the project by the normal local procedure.
2. Open the main menu, configuration editor, Sandbox, Endless, and one explicit
   level.
3. Exercise every player weapon slot, pause/resume, die, respawn, and return to
   the menu.
4. Start and stop one replay recording, then open and seek through the replay.

Expected:

- [ ] No uncaught console error.
- [ ] No blank or permanently frozen canvas while the tab is active.
- [ ] Menus and configured hotkeys still work.
- [ ] Every weapon produces its configured projectile or laser.
- [ ] Death and respawn remain usable.
- [ ] The replay loads, plays, pauses, seeks, and reaches its final frame.

Any failure in this section is a release blocker.

## 5. Simulation and timing

### 5.1 Fixed nominal step and discarded backlog

1. Run with `?profile=1` in localhost.
2. Fire a weapon with an obvious cooldown and observe normal cadence.
3. Pause JavaScript in Developer Tools for 3–10 seconds, then resume. Repeat by
   backgrounding or suspending the tab if the browser throttles background tabs.
4. In the console, run `GameProfiler.snapshot()`.

Expected:

- [ ] The game does not simulate a burst of missed frames after resume.
- [ ] Actors, projectiles, spawns, cooldowns, and timers remain paused for the
      discarded interval.
- [ ] At most one simulation step occurs per scheduler callback.
- [ ] `discarded scheduler wall time`/delayed-callback metrics increase.
- [ ] Cooldowns retain their order and are delayed equally.

### 5.2 Server distinction

For localhost, the tab is the server and therefore pausing the tab must pause
the game. If a separate dedicated-server runtime exists outside this project,
repeat the pause test against it.

Expected for a dedicated server:

- [ ] Pausing only the client tab does not pause authoritative server state.
- [ ] The server also discards its own delayed scheduler backlog rather than
      deterministically catching up.

Dedicated-server testing is conditional because this browser project does not
include or launch that server.

### 5.3 Exact boundaries

Use short cooldowns, lifetimes, split delays, and explosion delays that land on
whole 60 Hz steps. Capture a replay if possible.

- [ ] Cooldowns become ready on the standardized internal-clock boundary.
- [ ] Projectile collision is evaluated before expiry on the same step.
- [ ] No timer uses resumed wall time to jump ahead.
- [ ] Enemy spawn stalls produce no multi-spawn catch-up burst.

## 6. Projectile behavior

### 6.1 Effect order

Create shots where a bounce also has chain, explosion, and split effects.
Arrange a target near the bounce point and capture video frame-by-frame.

Expected order:

1. Bounce direction is resolved.
2. Chain acquisition/redirection uses the outgoing state.
3. Explosion occurs.
4. Split children are created.
5. Terminal impact/removal occurs only when applicable.

- [ ] Each effect runs no more than once for one trigger.
- [ ] A successful bounce is not treated as terminal impact.
- [ ] Child projectiles inherit `ownerId`, `team`, and shot-local upgrade state.

### 6.2 Collision before expiry

Fire a projectile whose lifetime ends on the same step that it reaches a wall
or target.

- [ ] The collision/effect occurs before expiry removes the projectile.
- [ ] An already expired projectile does not survive into another step.

### 6.3 Shapes and tangency

Test circle, triangle, square, and another convex simple polygon actor. Fire at
the visible interior, just outside an edge, exactly tangent to an edge, and
exactly tangent to a corner.

- [ ] Interior overlap hits.
- [ ] Visible empty space outside a polygon does not hit its bounding box.
- [ ] Exact edge tangency does not hit.
- [ ] Exact corner tangency does not hit.
- [ ] A minute inward offset hits and a minute outward offset misses.
- [ ] Projectile-to-wall tests use the projectile circle radius.

Attach the exact shape JSON and coordinates for every disputed result.

### 6.4 LOS and radius clearance

Place a target behind a narrow corner or gap.

- [ ] Thin detection LOS may see through a path that a nonzero-radius projectile
      cannot traverse.
- [ ] Aim/path selection rejects routes without full radius clearance.
- [ ] A zero-radius projectile behaves as a point for clearance.
- [ ] A larger radius never receives a route that only the smaller radius can
      clear.

### 6.5 Slow projectile aiming

Set projectile speed equal to or below the target's maximum movement speed.

- [ ] The aimer points directly at the current visible target position.
- [ ] No intercept/prediction calculation is attempted.
- [ ] If radius-aware direct LOS is blocked, the shot is not treated as clear.

### 6.6 Active chaining and corners

1. Fire a chaining projectile when no eligible target exists.
2. Add or reveal a target while the projectile remains active.
3. Move the target after acquisition.
4. Move it behind a rectangular blocker with two possible routes.

- [ ] Targetless projectiles scan every simulation step.
- [ ] A chain charge is consumed only when a target is actually acquired.
- [ ] Aim readjusts toward the target's current position each step.
- [ ] Speed magnitude is preserved while steering.
- [ ] The projectile chooses a radius-safe exposed-corner waypoint when direct
      clearance is blocked.
- [ ] It commits to a side rather than oscillating each frame.
- [ ] It returns to direct homing as soon as safe clearance returns.
- [ ] A killed/removed target is dropped and does not receive another hit.

## 7. Lasers and calculation budget

Temporarily test a very low `LASER_CALCULATION_BUDGET_PER_FRAME`, such as 1,
with a complex chained/bouncing laser. Keep a copy of the original defaults.
Use `?profile=1` and inspect `GameProfiler.snapshot()`.

- [ ] A shot that starts always finishes atomically in the same simulation step.
- [ ] The result is not truncated merely because the soft budget was exceeded.
- [ ] A partial laser is never rendered as a completed shot.
- [ ] The budget-overrun metric increases.
- [ ] The next shot still obeys its owner/weapon cooldown.
- [ ] Two enemies using the same weapon definition have independent cooldowns.
- [ ] Per-owner projectile/laser FIFO accounting remains isolated.

A temporary frame-time spike is allowed when an atomic shot exceeds the soft
budget. A missing or partial shot is not allowed.

## 8. Teams, ownership, damage, and death

Test player, enemy, and—if configured—neutral or allied relationships.

- [ ] `team` determines hostility and hit eligibility.
- [ ] `ownerId` determines attribution, cooldowns, and per-owner FIFO limits.
- [ ] Changing team does not silently change owner attribution.
- [ ] Friendly/neutral relationships do not take hostile damage.
- [ ] Directional relationships behave as configured.
- [ ] A lethal hit deactivates the actor immediately.
- [ ] Later projectiles/lasers in the same step cannot hit or chain through that
      dead actor.
- [ ] Player invincibility behavior remains player-specific.

## 9. Procedural and explicit levels

### 9.1 Explicit levels

Use an authored non-procedural level and travel beyond the normal procedural
generation and cleanup distances, then return.

- [ ] No procedural wall, structure, or enemy is added.
- [ ] No authored wall, structure, or enemy is removed by procedural cleanup.
- [ ] The configured player spawn and authored geometry remain exact.

Regional culling for explicit levels is intentionally not implemented.

### 9.2 Procedural levels

Run many fresh Endless seeds and inspect the starting region.

- [ ] Player spawn stays within the safe subset of `0 < x < 2` and
      `0 < y < corridorHeight`, accounting for the full rendered hitbox.
- [ ] Structure origins satisfy `x > 2 + maximum structure width`.
- [ ] Corridor walls still exist in the reserved start region.
- [ ] Wide structures are neither duplicated nor clipped when generation and
      cleanup boundaries move.
- [ ] Cleanup preserves live projectile collection identity.
- [ ] A scheduler stall causes at most the normal next spawn attempt, never a
      backlog burst.

## 10. Configuration, levels, and imports

Test factory files, an older valid export, and deliberately invalid files.

- [ ] Older supported config and level schemas migrate automatically.
- [ ] Migrated values are fully and strictly validated before state is changed.
- [ ] Unknown fields are rejected where the schema is strict.
- [ ] Unsafe projectile overrides are rejected recursively in split children.
- [ ] Invalid shape polygons/circles are rejected with a useful error.
- [ ] Invalid numeric values (`NaN`, infinity, negative constrained values) are
      rejected.
- [ ] Unsupported future schema versions are rejected.
- [ ] Oversized JSON and replay files are rejected before excessive allocation.
- [ ] A failed import leaves the currently loaded game/config intact.
- [ ] Factory `config.json` remains unchanged by patch application.

Preserve one accepted and one rejected fixture with the report.

## 11. Replay and respawn

1. Record a run, die, respawn at least twice, and continue playing.
2. Stop and save the replay.
3. Reload it, seek before and after every respawn, and play across each marker.
4. Also load one legacy replay from before the refactor.
5. Test a long replay while repeatedly seeking between distant points.

- [ ] Respawns appear as marked segments in one recording.
- [ ] Playback state reconstructs correctly on both sides of a segment marker.
- [ ] Legacy supported replay versions still load.
- [ ] Actor circle/polygon shapes replay correctly.
- [ ] Environment walls reconstruct correctly after distant seeks.
- [ ] Trail state resets correctly after seeks.
- [ ] Repeated seeking does not grow memory without bound; hydrated frames and
      environments remain limited by their LRU caches.
- [ ] Invalid or decompression-bomb-like replay inputs are rejected cleanly.

## 12. Aspect ratio and rendering

Test at least 16:9, 4:3, 16:10, ultrawide, portrait, and a resized window.

- [ ] The configured world aspect ratio is preserved.
- [ ] Extra viewport area is letterboxed.
- [ ] The image is not stretched.
- [ ] Pointer input remains aligned with rendered world coordinates.
- [ ] Exact actor polygons/circles match both collision and replay rendering.
- [ ] Projectiles, ribbons, lasers, UI, and debug overlays remain visible.

## 13. Performance and soak testing

Launch with `?profile=1`. Run a repeatable 10-minute scenario and a 60-minute
soak with many actors, structures, projectiles, lasers, explosions, and replay
recording. Capture `GameProfiler.snapshot()` at the beginning and end.

- [ ] No progressive frame-time or memory growth after activity stabilizes.
- [ ] Entity broad-phase results preserve correct hit/target behavior.
- [ ] Wall feature/corner caching updates after generation and cleanup.
- [ ] Laser soft-budget spent and overrun counters are credible.
- [ ] Discarded wall-time counters increase only after delayed callbacks.
- [ ] Replay playback caches remain bounded during distant seeking.
- [ ] Disabling the profiler stops clock sampling and retained measurements.

Performance results must include the scenario, actor/projectile counts, browser,
hardware, resolution, profiler state, and before/after snapshots. Do not compare
profile-enabled and profile-disabled runs as if they were equivalent.

## 14. Regression matrix

Mark every relevant row. Use N/A only with a reason.

| Area | Pass | Fail | N/A | Notes/evidence |
|---|:---:|:---:|:---:|---|
| Main menu and navigation | [ ] | [ ] | [ ] | |
| Config editor/import/export | [ ] | [ ] | [ ] | |
| Sandbox | [ ] | [ ] | [ ] | |
| Endless | [ ] | [ ] | [ ] | |
| Explicit level | [ ] | [ ] | [ ] | |
| Every player weapon | [ ] | [ ] | [ ] | |
| Every enemy weapon | [ ] | [ ] | [ ] | |
| Projectile FIFO limits | [ ] | [ ] | [ ] | |
| Lasers and chained lasers | [ ] | [ ] | [ ] | |
| Bounce/chain/explosion/split | [ ] | [ ] | [ ] | |
| Exact actor shapes | [ ] | [ ] | [ ] | |
| Procedural generation/cleanup | [ ] | [ ] | [ ] | |
| Death and respawn | [ ] | [ ] | [ ] | |
| Replay record/load/seek | [ ] | [ ] | [ ] | |
| Hotkeys and pointer input | [ ] | [ ] | [ ] | |
| Letterboxing/resizing | [ ] | [ ] | [ ] | |
| Profiling disabled/enabled | [ ] | [ ] | [ ] | |
| 60-minute soak | [ ] | [ ] | [ ] | |

## 15. Bug report and tester debrief

Submit one report per independently reproducible issue.

### Identification

- Beta patch/checksum:
- Pre-beta commit/archive:
- OS/browser/version:
- Hardware and display:
- Mode and URL parameters:
- Config/level/replay fixture:

### Result

- Severity: blocker / high / medium / low
- Area:
- Expected result:
- Actual result:
- First observed simulation time/frame, if known:
- Reproduction rate (for example, 5/5):

### Minimal reproduction

1.
2.
3.

### Evidence

- Console output or stack trace:
- Screenshot/video:
- Replay file and relevant segment/time:
- `GameProfiler.snapshot()`:
- Config/level fixture:
- Does it reproduce without `?profile=1`?
- Does it reproduce before this patch?

### Debrief questions

- Which scenarios were completed?
- Which scenarios were skipped, and why?
- Did any behavior feel different despite passing the expected result?
- Was any migration or validation error unclear?
- Did any stall cause a catch-up burst?
- Did any laser appear partial or disappear under load?
- Did any projectile hit a visibly clear tangent/corner route?
- Did memory or frame time progressively worsen?
- Would you approve promotion from beta? Why or why not?

## 16. Severity and sign-off

- **Blocker:** cannot boot/play, data corruption, invalid migration, crash,
  authoritative desync, missing/partial atomic shot, or reproducible wrong
  damage/collision affecting normal play.
- **High:** major semantic regression with a workaround, unbounded memory growth,
  replay corruption, or common severe performance regression.
- **Medium:** limited gameplay, compatibility, tooling, or rendering regression.
- **Low:** cosmetic, diagnostic, documentation, or uncommon minor issue.

Promotion criteria:

- [ ] Automated suite, microbenchmarks, and polyomino validation pass.
- [ ] Smoke and regression matrix pass on at least two current browsers.
- [ ] Local pause/no-catch-up semantics pass.
- [ ] Dedicated-server distinction passes if that runtime is available.
- [ ] Geometry/tangency, effect order, and atomic laser tests pass.
- [ ] Explicit/procedural level separation passes.
- [ ] Import migration, respawn replay, and aspect-ratio tests pass.
- [ ] A 60-minute soak finds no unbounded growth.
- [ ] No open blocker or high-severity issue remains.
- [ ] Skipped tests and accepted risks are documented.

## 17. Intentional behavior and current non-goals

The following are not beta defects unless their agreed semantics are violated:

- Paused localhost tabs pause the game; missed wall time is discarded.
- Combat RNG is not deterministic or replay-seeded.
- Exact tangency is clear, not a hit.
- Thin detection LOS and radius-aware aiming can disagree by design.
- Slow projectiles aim directly instead of predicting interception.
- A laser shot may exceed its soft calculation budget, but cannot be partial.
- Explicit levels have no procedural cleanup or regional culling.
- The beta does not add a dedicated-server implementation.

## 18. Rollback

Stop the game and preserve failing fixtures/replays first. On a clean worktree,
reverse the patch:

```powershell
git apply --check -R --ignore-space-change --whitespace=nowarn --exclude=config.json "C:\Users\Felix\Downloads\full-project-refactor.patch"
if ($LASTEXITCODE -eq 0) {
    git apply -R --ignore-space-change --whitespace=nowarn --exclude=config.json "C:\Users\Felix\Downloads\full-project-refactor.patch"
}
```

If the reverse check fails, do not force it. Restore the saved branch/archive or
report the worktree state. Imported browser data may have been migrated in
memory or saved separately; retain the pre-beta export when comparing versions.
