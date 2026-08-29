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
					"rect",
					"clip",
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
const { drawTrailsHybrid } = await import("../js/render/trails.js");
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


test("projectile trail checkpoints render per-leg circles while synthetic path starts do not", () => {
	resetDrawCalls();
	const snapshot = makeSnapshot();
	const trailEntries = [
		{
			alpha: 0.5,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{ renderId: "p1", x: 1, y: 1, radius: 0.25, color: "red" },
					{ renderId: "p1", x: 2, y: 1, radius: 0.25, color: "red", checkpoint: true },
				],
			},
		},
		{
			alpha: 1,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{ renderId: "p1", x: 3, y: 1, radius: 0.25, color: "red", checkpoint: true },
				],
			},
		},
	];

	render.draw(snapshot, trailEntries);

	const arcs = drawCalls.filter((entry) => entry[0] === "arc");
	assert.deepEqual(
		arcs.map((entry) => entry.slice(1, 4)),
		[
			[64, 32, 8],
			[64, 32, 8],
			[96, 32, 8],
		],
	);
	assert.equal(drawCalls.filter((entry) => entry[0] === "fill").length, 2);
	assert.equal(drawCalls.filter((entry) => entry[0] === "clip").length, 0);
});


test("checkpoint circles use ribbon-compatible winding inside compound fills", () => {
	resetDrawCalls();
	const rendering = { BLOCK_SIZE_PX: 32 };
	const trailEntries = [
		{
			alpha: 0.5,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{ renderId: "winding", x: 1, y: 1, radius: 0.25, color: "red" },
				],
			},
		},
		{
			alpha: 1,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{
						renderId: "winding",
						x: 2,
						y: 1,
						radius: 0.25,
						color: "red",
						checkpoint: true,
					},
				],
			},
		},
	];

	drawTrailsHybrid(trailEntries, trailEntries, rendering);

	const arcs = drawCalls.filter((entry) => entry[0] === "arc");
	assert.equal(arcs.length, 1);
	assert.equal(arcs[0][4], 0);
	assert.equal(arcs[0][5], -Math.PI * 2);
	assert.equal(arcs[0][6], true);
});


test("terminal checkpoint is combined with its incoming ribbon in one fill", () => {
	resetDrawCalls();
	const rendering = { BLOCK_SIZE_PX: 32 };
	const trailEntries = [
		{
			alpha: 0.5,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{ renderId: "terminal", x: 1, y: 1, radius: 0.25, color: "red" },
				],
			},
		},
		{
			alpha: 1,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{
						renderId: "terminal",
						x: 2,
						y: 1,
						radius: 0.25,
						color: "red",
						checkpoint: true,
					},
				],
			},
		},
	];

	drawTrailsHybrid(trailEntries, trailEntries, rendering);

	assert.equal(drawCalls.filter((entry) => entry[0] === "clip").length, 0);
	assert.equal(drawCalls.filter((entry) => entry[0] === "fill").length, 1);

	const arcIndexes = drawCalls
		.map((entry, index) => (entry[0] === "arc" ? index : -1))
		.filter((index) => index >= 0);
	assert.equal(arcIndexes.length, 1);
	const fillIndex = drawCalls.findIndex((entry) => entry[0] === "fill");
	assert.ok(arcIndexes[0] < fillIndex);
});


test("both bounce legs paint their own shared checkpoint circles and blend normally", () => {
	resetDrawCalls();
	const rendering = { BLOCK_SIZE_PX: 32 };
	const trailEntries = [
		{
			alpha: 0.4,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{ renderId: "bounce", x: 1, y: 1, radius: 0.25, color: "red" },
				],
			},
		},
		{
			alpha: 0.7,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{
						renderId: "bounce",
						x: 2,
						y: 1,
						radius: 0.25,
						color: "red",
						checkpoint: true,
					},
				],
			},
		},
		{
			alpha: 1,
			snapshot: {
				player: null,
				enemies: [],
				projectiles: [],
				projectileTrailEvents: [
					{
						renderId: "bounce",
						x: 2,
						y: 2,
						radius: 0.25,
						color: "red",
						checkpoint: true,
					},
				],
			},
		},
	];

	drawTrailsHybrid(trailEntries, trailEntries, rendering);

	assert.equal(drawCalls.filter((entry) => entry[0] === "clip").length, 0);
	const fillIndexes = drawCalls
		.map((entry, index) => (entry[0] === "fill" ? index : -1))
		.filter((index) => index >= 0);
	assert.equal(fillIndexes.length, 2);
	const arcs = drawCalls.filter((entry) => entry[0] === "arc");
	assert.deepEqual(
		arcs.map((entry) => entry.slice(1, 4)),
		[
			[64, 32, 8],
			[64, 32, 8],
			[64, 64, 8],
		],
	);
	assert.ok(fillIndexes[0] < fillIndexes[1]);
});

test("player trail marks initial position, turns, and stops with square checkpoints", () => {
	resetDrawCalls();
	const rendering = { BLOCK_SIZE_PX: 32 };
	const playerTrailEntries = [
		[0, 0, 0, 0.2],
		[1, 1, 0, 0.4],
		[2, 2, 0, 0.6],
		[3, 2, 1, 0.8],
		[4, 2, 1, 1],
	].map(([frameNumber, x, y, alpha]) => ({
		frameNumber,
		alpha,
		snapshot: {
			player: {
				renderId: "player",
				x,
				y,
				size: 0.5,
				color: "blue",
				hp: 10,
			},
			enemies: [],
			projectiles: [],
			projectileTrailEvents: [],
		},
	}));

	drawTrailsHybrid([], [], rendering, playerTrailEntries);

	// Rightward and downward movement are two independent legs. The turn square
	// belongs to both legs and is therefore painted twice; initial/stop squares
	// are painted once each.
	assert.equal(drawCalls.filter((entry) => entry[0] === "fill").length, 2);
	const squareStarts = drawCalls
		.map((entry, index) => {
			if (entry[0] !== "moveTo") return null;
			const [x, y] = entry.slice(1, 3);
			const size = 16;
			return (
				drawCalls[index + 1]?.[0] === "lineTo" &&
				drawCalls[index + 1]?.[1] === x &&
				drawCalls[index + 1]?.[2] === y + size &&
				drawCalls[index + 2]?.[0] === "lineTo" &&
				drawCalls[index + 2]?.[1] === x + size &&
				drawCalls[index + 2]?.[2] === y + size &&
				drawCalls[index + 3]?.[0] === "lineTo" &&
				drawCalls[index + 3]?.[1] === x + size &&
				drawCalls[index + 3]?.[2] === y &&
				drawCalls[index + 4]?.[0] === "closePath"
					? [x, y]
					: null
			);
		})
		.filter(Boolean);
	assert.deepEqual(squareStarts, [
		[0, 0],
		[64, 0],
		[64, 0],
		[64, 32],
	]);
});

test("player trail marks a stationary-to-moving transition at the exact start point", () => {
	resetDrawCalls();
	const rendering = { BLOCK_SIZE_PX: 32 };
	const playerTrailEntries = [
		[0, 0, 0, 0.4],
		[1, 0, 0, 0.7],
		[2, 1, 0, 1],
	].map(([frameNumber, x, y, alpha]) => ({
		frameNumber,
		alpha,
		snapshot: {
			player: {
				renderId: "player",
				x,
				y,
				size: 0.5,
				color: "blue",
				hp: 10,
			},
			enemies: [],
			projectiles: [],
			projectileTrailEvents: [],
		},
	}));

	drawTrailsHybrid([], [], rendering, playerTrailEntries);

	// The old initial checkpoint and the later start-moving checkpoint occupy the
	// same world position but are distinct historical states and may blend.
	const squareStartsAtOrigin = drawCalls.filter(
		(entry) => entry[0] === "moveTo" && entry[1] === 0 && entry[2] === 0,
	);
	assert.equal(squareStartsAtOrigin.length, 2);
});
