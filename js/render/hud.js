// Screen-space HUD and game-over overlays.

import { canvas, ctx } from "../dom.js";

// Draws a minimal active-weapon indicator in screen space.
export function drawWeaponHud(snapshot) {
	if (!snapshot.player || snapshot.player.hp <= 0) return;

	const label = `Weapon ${Number(snapshot.activeWeaponIndex || 0) + 1}`;
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

export function drawGameOverOverlay(snapshot) {
	if (snapshot.player.hp > 0) return;

	const sourceStatus = (source) =>
		source === "factory"
			? "UNEDITED"
			: source === "session"
				? "SESSION EDITABLE"
				: "UNKNOWN";

	ctx.save();
	ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.textAlign = "center";
	ctx.fillStyle = "red";
	ctx.font = "40px sans-serif";
	ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2);
	ctx.fillStyle = "white";
	ctx.font = "24px sans-serif";
	ctx.fillText(
		`Max Distance: ${Math.floor(snapshot.maxDistance)}`,
		canvas.width / 2,
		canvas.height / 2 + 40,
	);
	ctx.font = "20px monospace";
	ctx.fillText(
		`config.json: ${sourceStatus(snapshot.configSource)}`,
		canvas.width / 2,
		canvas.height / 2 + 75,
	);
	ctx.fillText(
		`level.json: ${sourceStatus(snapshot.levelSource)}`,
		canvas.width / 2,
		canvas.height / 2 + 105,
	);
	ctx.restore();
}
