// Canvas and UI element references.

// Canvas element used as the game's rendering surface.
export const canvas = document.getElementById("gameCanvas");
// 2D rendering context used by render.js to draw the game.
export const ctx = canvas.getContext("2d");

export const configUI = document.getElementById("configUI");
export const debugUI = document.getElementById("debugUI");
export const cycleUIBtn = document.getElementById("cycleUIBtn");
export const levelDataInput = document.getElementById("levelData");
export const loadLevelBtn = document.getElementById("loadLevelBtn");
export const godModeToggle = document.getElementById("godModeToggle");

export const performanceFps = document.getElementById("performanceFps");
export const performanceTargetFps = document.getElementById("performanceTargetFps");
export const performanceMsPerTick = document.getElementById("performanceMsPerTick");
export const performanceEntityCount = document.getElementById("performanceEntityCount");
export const performanceEnemyCount = document.getElementById("performanceEnemyCount");
export const performanceBulletCount = document.getElementById("performanceBulletCount");

export const respawnBtn = document.getElementById("respawnBtn");

export const replayRecordBtn = document.getElementById("replayRecordBtn");
export const replayStopSaveBtn = document.getElementById("replayStopSaveBtn");
export const replayLoadBtn = document.getElementById("replayLoadBtn");
export const replayFileInput = document.getElementById("replayFileInput");
export const replayPlayPauseBtn = document.getElementById("replayPlayPauseBtn");
export const replayStopBtn = document.getElementById("replayStopBtn");
export const replayStatus = document.getElementById("replayStatus");
