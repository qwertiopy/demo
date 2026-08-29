// Rendering from JSON-safe visual snapshots. The same renderer is used by live
// gameplay, trails, and replay playback.

export {
	draw,
	drawDynamicSnapshot,
	drawHealthBar,
	drawProceduralEnvironment,
	drawWeaponHud,
} from "./render/index.js";
