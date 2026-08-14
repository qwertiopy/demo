// Canvas and UI element references.

// Canvas element used as the game's rendering surface.
export const canvas = document.getElementById("gameCanvas");
// 2D rendering context used by render.js to draw the game.
export const ctx = canvas.getContext("2d");

export const editorUI = document.getElementById("editorUI");
export const hideUIBtn = document.getElementById("hideUIBtn");
export const levelDataInput = document.getElementById("levelData");
export const loadLevelBtn = document.getElementById("loadLevelBtn");
export const godModeToggle = document.getElementById("godModeToggle");
