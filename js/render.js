// Rendering.

import { Config } from "./config.js";
import {
    GameState,
    player,
    camera
} from "./state.js";
import { canvas, ctx } from "./dom.js";

// Draws the checker/grid-like world background and optional enemy-spawn debug markers within the camera viewport.
export function drawProceduralEnvironment() {
    const startX = Math.floor(camera.x);
    const endX =
        startX + camera.widthBlocks + 2;
    const startY = Math.floor(camera.y);
    const endY =
        startY + camera.heightBlocks + 2;

    ctx.lineWidth = 1;

    for (let x = startX; x < endX; x++) {
        for (let y = startY; y < endY; y++) {
            const px =
                x * Config.BLOCK_SIZE_PX;
            const py =
                y * Config.BLOCK_SIZE_PX;

            ctx.fillStyle =
                Math.abs(x + y) % 2 === 0
                    ? "#111111"
                    : "#1a1a1a";

            ctx.fillRect(
                px,
                py,
                Config.BLOCK_SIZE_PX,
                Config.BLOCK_SIZE_PX
            );

            ctx.strokeStyle = "#222222";
            ctx.strokeRect(
                px,
                py,
                Config.BLOCK_SIZE_PX,
                Config.BLOCK_SIZE_PX
            );

            if (GameState.showEditorHelpers) {
                ctx.fillStyle =
                    "rgba(255, 255, 255, 0.25)";
                ctx.font = "10px monospace";
                ctx.fillText(
                    `${x},${y}`,
                    px + 4,
                    py + 14
                );
            }
        }
    }

    if (GameState.showEditorHelpers) {
        GameState.enemySpawns.forEach(spawn => {
            const renderSizePx =
                (spawn.size ||
                    Config.PLAYER_SIZE_BLOCKS) *
                Config.BLOCK_SIZE_PX;

            const px =
                spawn.x * Config.BLOCK_SIZE_PX;
            const py =
                spawn.y * Config.BLOCK_SIZE_PX;

            ctx.strokeStyle = "cyan";
            ctx.lineWidth = 2;
            ctx.strokeRect(
                px,
                py,
                renderSizePx,
                renderSizePx
            );

            ctx.fillStyle =
                "rgba(0, 255, 255, 0.2)";
            ctx.fillRect(
                px,
                py,
                renderSizePx,
                renderSizePx
            );

            ctx.fillStyle = "cyan";
            ctx.font = "10px monospace";
            ctx.fillText(
                `SPAWN: ${spawn.type}`,
                px,
                py - 4
            );
        });
    }
}

// Draws a black health-bar background followed by a colored bar proportional to current HP.
export function drawHealthBar(
    x,
    y,
    width,
    hp,
    maxHp,
    color
) {
    ctx.fillStyle = "black";
    ctx.fillRect(x, y, width, 5);

    ctx.fillStyle = color;
    ctx.fillRect(
        x,
        y,
        width * (hp / maxHp),
        5
    );
}

// Renders the complete frame: environment, walls, player, enemies, bullets, camera transform, and the game-over overlay.
export function draw() {
    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.save();

    ctx.translate(
        -Math.floor(
            camera.x * Config.BLOCK_SIZE_PX
        ),
        -Math.floor(
            camera.y * Config.BLOCK_SIZE_PX
        )
    );

    drawProceduralEnvironment();

    GameState.walls.forEach(w => {
        ctx.fillStyle = w.color;
        ctx.fillRect(
            w.x * Config.BLOCK_SIZE_PX,
            w.y * Config.BLOCK_SIZE_PX,
            w.width * Config.BLOCK_SIZE_PX,
            w.height * Config.BLOCK_SIZE_PX
        );
    });

    if (player.hp > 0) {
        const pPxX =
            player.x * Config.BLOCK_SIZE_PX;
        const pPxY =
            player.y * Config.BLOCK_SIZE_PX;
        const pPxSize =
            player.size * Config.BLOCK_SIZE_PX;

        ctx.fillStyle = player.color;
        ctx.fillRect(
            pPxX,
            pPxY,
            pPxSize,
            pPxSize
        );

        drawHealthBar(
            pPxX,
            pPxY - 10,
            pPxSize,
            player.hp,
            player.maxHp,
            "cyan"
        );
    }

    GameState.enemies.forEach(e => {
        const ePxX =
            e.x * Config.BLOCK_SIZE_PX;
        const ePxY =
            e.y * Config.BLOCK_SIZE_PX;
        const ePxSize =
            e.size * Config.BLOCK_SIZE_PX;

        ctx.fillStyle = e.color;
        ctx.fillRect(
            ePxX,
            ePxY,
            ePxSize,
            ePxSize
        );

        drawHealthBar(
            ePxX,
            ePxY - 10,
            ePxSize,
            e.hp,
            e.maxHp,
            "red"
        );
    });

    [
        ...GameState.bullets,
        ...GameState.enemyBullets
    ].forEach(b => {
        ctx.beginPath();

        ctx.arc(
            b.x * Config.BLOCK_SIZE_PX,
            b.y * Config.BLOCK_SIZE_PX,
            b.radius * Config.BLOCK_SIZE_PX,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.closePath();
    });

    ctx.restore();

    if (player.hp <= 0) {
        ctx.fillStyle =
            "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        ctx.fillStyle = "red";
        ctx.font = "40px sans-serif";
        ctx.fillText(
            "GAME OVER",
            canvas.width / 2 - 120,
            canvas.height / 2
        );
    }
}
