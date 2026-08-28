import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const updateSourceUrl = new URL("../js/runtime/game-update.js", import.meta.url);
const loopSourceUrl = new URL("../js/runtime/game-loop.js", import.meta.url);
const mainSourceUrl = new URL("../js/main.js", import.meta.url);

function assertAppearsInOrder(source, snippets) {
	let cursor = -1;
	for (const snippet of snippets) {
		const next = source.indexOf(snippet, cursor + 1);
		assert.notEqual(next, -1, `missing orchestration step: ${snippet}`);
		assert.ok(next > cursor, `orchestration step out of order: ${snippet}`);
		cursor = next;
	}
}

test("runtime update preserves the established gameplay subsystem order", async () => {
	const source = await readFile(updateSourceUrl, "utf8");

	assertAppearsInOrder(source, [
		"resetLaserCalculationBudget();",
		"updateProceduralGeneration(player.x);",
		"cleanupProceduralGeneration(player.x);",
		"handleWallCollisions(player, dx, dy);",
		"updateProgressiveEnemySpawnRate(player.x);",
		"updateEnemies(currentTime, dt);",
		"resolveEnemyVectorCollisions(dt);",
		"camera.x =",
		"processAutofire(currentTime);",
		"processProjectiles(currentTime, dt);",
		"resolveProjectileVectorCollisions();",
		"processLasers(currentTime);",
		"processExplosions(currentTime);",
	]);
});

test("runtime loop preserves profiling, update, and render ordering", async () => {
	const source = await readFile(loopSourceUrl, "utf8");

	assertAppearsInOrder(source, [
		"requestAnimationFrame(gameLoop);",
		"framePacer.advanceAnimationFrame(currentTime, targetFps)",
		"beginProfileFrame(currentTime);",
		"framePacer.consumeTick(currentTime);",
		"updatePerformanceUi(currentTime, framePacer.tickDurationMs, targetFps);",
		"updateGame(currentTime, framePacer.dt);",
		"renderGameFrame(currentTime);",
		"endProfileFrame();",
	]);
	assert.doesNotMatch(source, /SimulationClock|SIMULATION_HZ/);
});

test("main remains a thin runtime entry point without subsystem orchestration", async () => {
	const source = await readFile(mainSourceUrl, "utf8");

	assert.match(source, /runtime\/game-init\.js/);
	assert.match(source, /updateGame as update/);
	assert.match(source, /MAX_DT_SECONDS/);
	assert.doesNotMatch(source, /updateProceduralGeneration/);
	assert.doesNotMatch(source, /processProjectiles/);
	assert.doesNotMatch(source, /processLasers/);
	assert.doesNotMatch(source, /processExplosions/);
});
