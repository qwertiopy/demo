// Canvas and UI element references.

const pageDocument = globalThis.document;

// Canvas element used as the game's rendering surface.
export const canvas = pageDocument?.getElementById("gameCanvas") ?? null;
// 2D rendering context used by render.js to draw the game.
export const ctx = canvas?.getContext?.("2d") ?? null;

export const debugUI = pageDocument?.getElementById("debugUI") ?? null;

export const performanceFps = pageDocument?.getElementById("performanceFps") ?? null;
export const performanceTargetFps = pageDocument?.getElementById("performanceTargetFps") ?? null;
export const performanceMsPerTick = pageDocument?.getElementById("performanceMsPerTick") ?? null;
export const performanceEntityCount = pageDocument?.getElementById("performanceEntityCount") ?? null;
export const performanceEnemyCount = pageDocument?.getElementById("performanceEnemyCount") ?? null;
export const performanceBulletCount = pageDocument?.getElementById("performanceBulletCount") ?? null;

export const respawnBtn = pageDocument?.getElementById("respawnBtn") ?? null;

export const replayRecordBtn = pageDocument?.getElementById("replayRecordBtn") ?? null;
export const replayStopRecordingBtn = pageDocument?.getElementById("replayStopRecordingBtn") ?? null;
export const replayPlayPauseBtn = pageDocument?.getElementById("replayPlayPauseBtn") ?? null;
export const replayStopBtn = pageDocument?.getElementById("replayStopBtn") ?? null;
export const replayStatus = pageDocument?.getElementById("replayStatus") ?? null;
