// Canvas and UI element references.

// Canvas element used as the game's rendering surface.
export const canvas = document.getElementById("gameCanvas");
// 2D rendering context used by render.js to draw the game.
export const ctx = canvas.getContext("2d");

export const debugUI = document.getElementById("debugUI");

export const performanceFps = document.getElementById("performanceFps");
export const performanceTargetFps = document.getElementById("performanceTargetFps");
export const performanceMsPerTick = document.getElementById("performanceMsPerTick");
export const performanceEntityCount = document.getElementById("performanceEntityCount");
export const performanceEnemyCount = document.getElementById("performanceEnemyCount");
export const performanceBulletCount = document.getElementById("performanceBulletCount");

export const respawnBtn = document.getElementById("respawnBtn");

export const replayRecordBtn = document.getElementById("replayRecordBtn");
export const replayStopRecordingBtn = document.getElementById("replayStopRecordingBtn");
export const replayPlayPauseBtn = document.getElementById("replayPlayPauseBtn");
export const replayStopBtn = document.getElementById("replayStopBtn");
export const replayStatus = document.getElementById("replayStatus");
