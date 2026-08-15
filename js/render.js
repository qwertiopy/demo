// Rendering.

import { Config } from "./config.js";
import { GameState, player, camera } from "./state.js";
import { canvas, ctx } from "./dom.js";
import { getActiveWeaponIndex } from "./weapons.js";
import { isRectOffScreen } from "./utils.js";

// needed to fix rendering issues at extremely high coordinate values
function worldToScreenX(x) {
	return Math.round((x - camera.x) * Config.BLOCK_SIZE_PX);
}

function worldToScreenY(y) {
	return Math.round((y - camera.y) * Config.BLOCK_SIZE_PX);
}

// Draws the checker/grid-like world background and optional enemy-spawn
// debug markers within the camera viewport.
export function drawProceduralEnvironment() {
	const startX = Math.floor(camera.x);
	const endX = startX + camera.widthBlocks + 2;

	const startY = Math.floor(camera.y);
	const endY = startY + camera.heightBlocks + 2;

	ctx.lineWidth = 1;

	for (let x = startX; x < endX; x++) {
		for (let y = startY; y < endY; y++) {
			// Convert world coordinates directly to local screen coordinates.
			const px = worldToScreenX(x);
			const py = worldToScreenY(y);

			ctx.fillStyle = Math.abs(x + y) % 2 === 0 ? "#111111" : "#1a1a1a";

			ctx.fillRect(px, py, Config.BLOCK_SIZE_PX, Config.BLOCK_SIZE_PX);

			ctx.strokeStyle = "#222222";

			ctx.strokeRect(px, py, Config.BLOCK_SIZE_PX, Config.BLOCK_SIZE_PX);

			if (GameState.showEditorHelpers) {
				ctx.fillStyle = "rgba(255, 255, 255, 0.25)";

				ctx.font = "10px monospace";

				ctx.fillText(`${x},${y}`, px + 4, py + 14);
			}
		}
	}

	if (GameState.showEditorHelpers) {
		GameState.enemySpawns.forEach((spawn) => {
			const renderSizePx =
				(spawn.size || Config.PLAYER_SIZE_BLOCKS) *
				Config.BLOCK_SIZE_PX;

			const px = worldToScreenX(spawn.x);
			const py = worldToScreenY(spawn.y);

			ctx.strokeStyle = "cyan";
			ctx.lineWidth = 2;

			ctx.strokeRect(px, py, renderSizePx, renderSizePx);

			ctx.fillStyle = "rgba(0, 255, 255, 0.2)";

			ctx.fillRect(px, py, renderSizePx, renderSizePx);

			ctx.fillStyle = "cyan";
			ctx.font = "10px monospace";

			ctx.fillText(`SPAWN: ${spawn.type}`, px, py - 4);
		});
	}
}

// Draws a black health-bar background followed by a colored bar proportional to current HP.
export function drawHealthBar(x, y, width, hp, maxHp, color) {
	ctx.fillStyle = "black";
	ctx.fillRect(x, y, width, 5);

	ctx.fillStyle = color;
	ctx.fillRect(x, y, width * (hp / maxHp), 5);
}

// Draws a minimal active-weapon indicator in screen space.
export function drawWeaponHud() {
	if (player.hp <= 0) return;

	const label = `Weapon ${getActiveWeaponIndex() + 1}`;

	ctx.font = "16px monospace";

	const textWidth = ctx.measureText(label).width;

	const padding = 10;
	const width = textWidth + padding * 2;

	const height = 34;

	const x = canvas.width - width - 12;

	const y = 12;

	ctx.fillStyle = "rgba(0, 0, 0, 0.72)";

	ctx.fillRect(x, y, width, height);

	ctx.strokeStyle = "cyan";
	ctx.lineWidth = 1;

	ctx.strokeRect(x, y, width, height);

	ctx.fillStyle = "white";

	ctx.fillText(label, x + padding, y + 22);
}

// Renders the complete frame.
//
// World objects are converted directly from world-block coordinates
// into camera-relative screen pixels. No large Canvas translation is
// used, preventing precision loss at very large world coordinates.
export function draw() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	drawProceduralEnvironment();

	GameState.walls.forEach((w) => {
		//don't draw if block is off screen
		if (isRectOffScreen(w.x, w.y, w, w.width, w.height, camera)) {
			return;
		}

		const px = worldToScreenX(w.x);
		const py = worldToScreenY(w.y);

		const width = w.width * Config.BLOCK_SIZE_PX;

		const height = w.height * Config.BLOCK_SIZE_PX;

		ctx.fillStyle = w.color;

		ctx.fillRect(px, py, width, height);
	});

	if (player.hp > 0) {
		const pPxX = worldToScreenX(player.x);

		const pPxY = worldToScreenY(player.y);

		const pPxSize = player.size * Config.BLOCK_SIZE_PX;

		ctx.fillStyle = player.color;

		ctx.fillRect(pPxX, pPxY, pPxSize, pPxSize);

		drawHealthBar(
			pPxX,
			pPxY - 10,
			pPxSize,
			player.hp,
			player.maxHp,
			"cyan",
		);
	}

	GameState.enemies.forEach((e) => {
		if (isRectOffScreen(e.x, e.y, e.size, e.size, camera)) {
			return;
		}

		const ePxX = worldToScreenX(e.x);
		const ePxY = worldToScreenY(e.y);

		const ePxSize = e.size * Config.BLOCK_SIZE_PX;

		ctx.fillStyle = e.color;

		ctx.fillRect(ePxX, ePxY, ePxSize, ePxSize);

		drawHealthBar(ePxX, ePxY - 10, ePxSize, e.hp, e.maxHp, "red");
	});

	[...GameState.bullets, ...GameState.enemyBullets].forEach((b) => {
		if (isRectOffScreen(b.x, b.y, b.radius * 2, b.radius * 2, camera)) {
			return;
		}
		ctx.beginPath();

		ctx.arc(
			worldToScreenX(b.x),
			worldToScreenY(b.y),
			b.radius * Config.BLOCK_SIZE_PX,
			0,
			Math.PI * 2,
		);

		ctx.fillStyle = b.color;

		ctx.fill();

		ctx.closePath();
	});

	drawWeaponHud();

	if (player.hp <= 0) {
		ctx.fillStyle = "rgba(0, 0, 0, 0.7)";

		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.fillStyle = "red";
		ctx.font = "40px sans-serif";

		ctx.fillText("GAME OVER", canvas.width / 2 - 120, canvas.height / 2);

		ctx.font = "24px sans-serif";

		ctx.fillText(
			`Max Distance: ${Math.floor(GameState.MaxDistance)}`,
			canvas.width / 2 - 100,
			canvas.height / 2 + 40,
		);
	}
}
