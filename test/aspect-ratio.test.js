import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("canvas CSS letterboxes through the runtime aspect-ratio variable", () => {
	const css = fs.readFileSync(new URL("../css/style.css", import.meta.url), "utf8");
	assert.match(css, /aspect-ratio:\s*var\(--game-aspect-ratio/);
	assert.match(css, /width:\s*min\(100vw,\s*calc\(100vh \* var\(--game-aspect-ratio/);
	assert.match(css, /height:\s*auto/);
});
