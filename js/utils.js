// Shared simulation helpers.

import { GameState } from "./state.js";

// Advances the deterministic level RNG stored in GameState and returns a value in [0, 1).
export function seededRandom() {
    GameState.currentSeed =
        (GameState.currentSeed * 9301 + 49297) % 233280;

    return GameState.currentSeed / 233280;
}

// Performs axis-aligned bounding-box collision detection for entities or rectangles using width/height or size.
export function isColliding(rect1, rect2) {
    return rect1.x < rect2.x + (rect2.width || rect2.size) &&
           rect1.x + (rect1.width || rect1.size) > rect2.x &&
           rect1.y < rect2.y + (rect2.height || rect2.size) &&
           rect1.y + (rect1.height || rect1.size) > rect2.y;
}

// Moves an entity one axis at a time and resolves overlap against every wall, producing sliding-style wall collision.
export function handleWallCollisions(entity, dx, dy) {
    entity.x += dx;

    GameState.walls.forEach(w => {
        if (isColliding(entity, w)) {
            if (dx > 0) entity.x = w.x - entity.size;
            if (dx < 0) entity.x = w.x + w.width;
        }
    });

    entity.y += dy;

    GameState.walls.forEach(w => {
        if (isColliding(entity, w)) {
            if (dy > 0) entity.y = w.y - entity.size;
            if (dy < 0) entity.y = w.y + w.height;
        }
    });
}
