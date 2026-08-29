import assert from "node:assert/strict";
import test from "node:test";

const drawCalls = [];
const styleState = Object.create(null);

function resetDrawCalls() {
	drawCalls.length = 0;
}

const ctx = new Proxy(
	{
		measureText(text) {
			drawCalls.push(["measureText", String(text)]);
			return { width: String(text).length * 8 };
		},
		createLinearGradient(...args) {
			drawCalls.push(["createLinearGradient", ...args]);
			return {
				addColorStop(offset, color) {
					drawCalls.push(["addColorStop", offset, color]);
				},
			};
		},
	},
	{
		get(target, property) {
			if (property in target) return target[property];
			if (
				[
					"save",
					"restore",
					"clearRect",
					"scale",
					"translate",
					"fillRect",
					"strokeRect",
					"fillText",
					"beginPath",
					"moveTo",
					"lineTo",
					"arc",
					"closePath",
					"fill",
					"stroke",
					"setLineDash",
				].includes(property)
			) {
				return (...args) => drawCalls.push([property, ...args]);
			}
			return styleState[property];
		},
		set(_target, property, value) {
			styleState[property] = value;
			drawCalls.push(["set", property, value]);
			return true;
		},
	},
);

const canvas = {
	width: 10,
	height: 10,
	style: {},
	getContext() {
		return ctx;
	},
};
const respawnBtn = { hidden: false };
const genericElement = {
	textContent: "",
	hidden: false,
	disabled: false,
	addEventListener() {},
	focus() {},
	classList: { toggle() {} },
};

globalThis.document = {
	getElementById(id) {
		if (id === "gameCanvas") return canvas;
		if (id === "respawnBtn") return respawnBtn;
		return genericElement;
	},
};

const render = await import("../js/render.js");
const { syncRespawnButton } = await import("../js/runtime/game-ui.js");

function makeSnapshot({ hp = 10 } = {}) {
	return {
		camera: { x: 0.25, y: 0.5, widthBlocks: 2, heightBlocks: 2 },
		rendering: {
			CANVAS_WIDTH_PX: 320,
			CANVAS_HEIGHT_PX: 240,
			BLOCK_SIZE_PX: 32,
			ZOOM: 1,
			ENVIRONMENT_OVERSCAN_BLOCKS: 0,
		},
		debug: { MAX_DRAWS_PER_FRAME: 0 },
		showEditorHelpers: false,
		player: {
			renderId: "player",
			x: 1,
			y: 1,
			size: 0.5,
			hp,
			maxHp: 10,
			color: "blue",
		},
		enemies: [],
		projectiles: [],
		laserWarmups: [],
		laserBeams: [],
		explosions: [],
		enemySpawns: [],
		walls: [{ x: 0, y: 0, width: 1, height: 1, color: "gray" }],
		activeWeaponIndex: 1,
		maxDistance: 12.9,
		configSource: "factory",
		levelSource: "session",
	};
}

test("render facade preserves the established public exports", () => {
	assert.deepEqual(
		Object.keys(render).sort(),
		[
			"draw",
			"drawDynamicSnapshot",
			"drawHealthBar",
			"drawProceduralEnvironment",
			"drawWeaponHud",
		].sort(),
	);
});

test("render orchestration preserves canvas sizing, world transform, and HUD order", () => {
	resetDrawCalls();
	const snapshot = makeSnapshot();
	render.draw(snapshot);

	assert.equal(canvas.width, 320);
	assert.equal(canvas.height, 240);
	assert.equal(canvas.style.aspectRatio, "320 / 240");

	const names = drawCalls.map((entry) => entry[0]);
	assert.equal(names[0], "clearRect");
	assert.ok(names.indexOf("scale") < names.indexOf("translate"));
	assert.ok(drawCalls.some((entry) => entry[0] === "fillText" && entry[1] === "Weapon 2"));
});

test("game-over overlay remains a canvas concern after DOM UI extraction", () => {
	resetDrawCalls();
	render.draw(makeSnapshot({ hp: 0 }));

	assert.ok(drawCalls.some((entry) => entry[0] === "fillText" && entry[1] === "GAME OVER"));
	assert.ok(
		drawCalls.some(
			(entry) => entry[0] === "fillText" && entry[1] === "config.json: UNEDITED",
		),
	);
	assert.ok(
		drawCalls.some(
			(entry) =>
				entry[0] === "fillText" && entry[1] === "level.json: SESSION EDITABLE",
		),
	);
});

test("respawn button synchronization is explicit and preserves live/replay semantics", () => {
	syncRespawnButton(makeSnapshot({ hp: 10 }));
	assert.equal(respawnBtn.hidden, true);

	syncRespawnButton(makeSnapshot({ hp: 0 }));
	assert.equal(respawnBtn.hidden, false);

	syncRespawnButton(makeSnapshot({ hp: 0 }), { replayActive: true });
	assert.equal(respawnBtn.hidden, true);
});
