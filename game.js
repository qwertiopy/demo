// ==========================================
// 1. DOM ELEMENTS & SETUP
// ==========================================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const editorUI = document.getElementById("editorUI");
const hideUIBtn = document.getElementById("hideUIBtn");
const levelDataInput = document.getElementById("levelData");
const loadLevelBtn = document.getElementById("loadLevelBtn");

// ==========================================
// 2. GAME STATE & ENTITIES (Logic Units: Blocks)
// ==========================================
const keys = { w: false, a: false, s: false, d: false };
const bullets = [];
const enemyBullets = [];
let enemies = [];
let walls = [];

// Base Unit Scale Configuration
const BLOCK_SIZE_PX = 64; // Renderer base scale: 1 Block = 64 Pixels

// Entity sizes measured in blocks (logical units)
const PLAYER_SIZE_BLOCKS = 0.5;         // 32px equivalent (0.5 * 64)
const MIN_SPAWN_DISTANCE_BLOCKS = 15;   // 640px equivalent
const MAX_SPAWN_DISTANCE_BLOCKS = 25;   // 1280px equivalent
const STRUCTURE_DENSITY_BLOCKS = 5;     // 320px equivalent

// UI Visibility toggle state for editor helpers
let showEditorHelpers = true;

// Structure library with grid composition array 
const STRUCTURE_LIBRARY = [
    { 
        type: "pillar", 
        widthBlocks: 1, 
        heightBlocks: 2, 
        color: "dimgray",
        grid: [
            [1],
            [1]
        ]
    },
    { 
        type: "archway", 
        widthBlocks: 2, 
        heightBlocks: 3, 
        color: "slategray",
        grid: [
            [1, 1],
            [1, 0],
            [1, 1]
        ]
    },
    { 
        type: "platform", 
        widthBlocks: 3, 
        heightBlocks: 1, 
        color: "darkslategray",
        grid: [
            [1, 1, 1]
        ]
    },
    {
        type: "stair",
        widthBlocks: 2,
        heightBlocks: 2,
        color: "peru",
        grid: [
            [0, 1],
            [1, 1]
        ]
    }
];

// Level variables (stored in logical blocks)
let enemySpawns = [];
let enemySpawnRate = 0; 
let lastSpawnTime = 0;

const player = {
    x: 0, y: 0, // Logical block coordinates
    size: PLAYER_SIZE_BLOCKS, speed: 0.1, color: "royalblue",
    hp: 10, maxHp: 10
};

let isInvincible = false;

document.getElementById("godModeToggle").addEventListener("change", (e) => {
    isInvincible = e.target.checked;
});

const ENEMY_TYPES = {
    "g-bot": {
        sizeBlocks: 0.5, speed: 0.09, hp: 1, color: "orange", // 32px
        shootCooldown: 250, bulletSpeed: 0.25, bulletRadiusBlocks: 0.08, bulletColor: "gold", 
        bulletDamage: 1, ai: "aggressive" 
    },
    "j-bot": {
        sizeBlocks: 0.75, speed: 0.05, hp: 3, color: "darkred", // 48px
        shootCooldown: 100, bulletSpeed: 0.2, bulletRadiusBlocks: 0.12, bulletColor: "red", 
        bulletDamage: 3, ai: "aggressive" 
    },
    "h-bot": {
        sizeBlocks: 0.375, speed: 0.04, hp: 1, color: "purple", // 24px
        shootCooldown: 500, bulletSpeed: 0.5, bulletRadiusBlocks: 0.06, bulletColor: "fuchsia", 
        bulletDamage: 3, ai: "passive" 
    }
};

// ==========================================
// CHUNK GENERATION TRACKING & CONFIG
// ==========================================
const RENDER_DISTANCE_FRONT = 35; // Blocks to generate ahead of the player
const RENDER_DISTANCE_BACK = 12;   // Blocks to keep loaded behind the player

const generatedColumns = new Set();
let placedStructures = [];
let levelSeed = 12345;

let currentSeed = 12345;

function seededRandom() {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
}

// ==========================================
// CAMERA / VIEWPORT SYSTEM (Logical Units)
// ==========================================
const camera = {
    x: 0, 
    y: 0,
    widthBlocks: 20,  // 1280px / 64px
    heightBlocks: 11.25 // 720px / 64px
};

function updateCamera() {
    camera.x = player.x - camera.widthBlocks / 2 + player.size / 2;
    camera.y = player.y - camera.heightBlocks / 2 + player.size / 2;
}

// ==========================================
// PROCEDURAL GENERATION HELPERS
// ==========================================
function spawnWall(x, y, widthBlocks, heightBlocks, color = "slategray") {
    walls.push({ x, y, width: widthBlocks, height: heightBlocks, color });
}

function spawnEnemyPoint(x, y, type = "g-bot") {
    const stats = ENEMY_TYPES[type] || ENEMY_TYPES["g-bot"];
    enemySpawns.push({
        x: x, // Keep as block coordinate for safe tracking/cleanup
        y: y,
        type: type,
        size: stats.sizeBlocks
    });
}

// ==========================================
// DYNAMIC PROCEDURAL GENERATION
// ==========================================
function updateProceduralGeneration(playerX) {
    const startX = Math.max(0, Math.floor(playerX) - RENDER_DISTANCE_BACK);
    const endX = Math.floor(playerX) + RENDER_DISTANCE_FRONT;
    const ceilingY = 2; 
    const corridorWidthBlocks = 10;
    const floorY = ceilingY + corridorWidthBlocks;

    // A. Create Left Border Wall explicitly at column 0
    if (!generatedColumns.has(0) && startX <= 0 && endX >= 0) {
        spawnWall(0, ceilingY, 1, corridorWidthBlocks + 1, "slategray");
    }

    // B. Generate blocks dynamically based on camera/player position
    for (let blockX = startX; blockX <= endX; blockX++) {
        if (generatedColumns.has(blockX)) continue; 
        generatedColumns.add(blockX);

        spawnWall(blockX, ceilingY, 1, 1, "slategray");
        spawnWall(blockX, floorY, 1, 1, "slategray");

        if (blockX >= 1) {
            // Seed scramble to prevent identical chunk generation
            currentSeed = ((levelSeed ^ (blockX * 2654435761)) >>> 0) % 233280;

            let roll = seededRandom();
            if (roll > 0.5) {
                let template = STRUCTURE_LIBRARY[Math.floor(seededRandom() * STRUCTURE_LIBRARY.length)];
                let structX = blockX;
                
                // Allow structures to float anywhere between ceiling and floor
                let minY = ceilingY + 1; 
                let maxY = floorY - template.heightBlocks;
                let structY = Math.floor(seededRandom() * (maxY - minY + 1)) + minY;

                let canSpawn = true;
                
                // Note: We're keeping this density check to prevent total absolute chaos, 
                // but you can lower STRUCTURE_DENSITY_BLOCKS if you want more overlapping walls.
                for (let s of placedStructures) {
                    let dist = Math.hypot(structX - s.origin.x, structY - s.origin.y);
                    if (dist < STRUCTURE_DENSITY_BLOCKS) {
                        canSpawn = false;
                        break;
                    }
                }

                if (canSpawn) {
                    placedStructures.push({
                        origin: { x: structX, y: structY },
                        size: { width: template.widthBlocks, height: template.heightBlocks },
                        type: template.type
                    });

                    // Build the structure walls
                    for (let r = 0; r < template.grid.length; r++) {
                        for (let c = 0; c < template.grid[r].length; c++) {
                            if (template.grid[r][c] === 1) {
                                spawnWall(structX + c, structY + r, 1, 1, template.color);
                            }
                        }
                    }

                    // ==========================================
                    // ENEMY SPAWN LOGIC (Right side, push right on clip)
                    // ==========================================
                    let enemyTypeRoll = seededRandom();
                    let botType = enemyTypeRoll > 0.7 ? "h-bot" : (enemyTypeRoll > 0.3 ? "j-bot" : "g-bot");
                    
                    // 1. Position: Right of structure, middle vertically
                    let enemySpawnX = structX + template.widthBlocks;
                    let enemySpawnY = structY + Math.floor(template.heightBlocks / 2);

                    // 2. Collision Check: Push right if clipping inside any placed structure
                    // let isClipping = false;
                    // while (isClipping) {
                    //     isClipping = false;
                    //     for (let s of placedStructures) {
                    //         // Simple bounding box check
                    //         if (enemySpawnX >= s.origin.x && 
                    //             enemySpawnX < s.origin.x + s.size.width && 
                    //             enemySpawnY >= s.origin.y && 
                    //             enemySpawnY < s.origin.y + s.size.height) {
                                
                    //             isClipping = true;
                    //             enemySpawnX++; // Push to the right
                    //             break; // Break the inner loop to restart the check with the new X
                    //         }
                    //     }
                    // }

                    spawnEnemyPoint(enemySpawnX, enemySpawnY, botType);
                }
            }
        }
    }
}

// ==========================================
// CLEANUP PROCEDURAL GENERATION
// ==========================================
function cleanupProceduralGeneration(playerX) {
    const startX = Math.max(0, Math.floor(playerX) - RENDER_DISTANCE_BACK);
    const endX = Math.floor(playerX) + RENDER_DISTANCE_FRONT;
    
    // BUGFIX: Add a safety buffer so overhanging structures and right-pushed 
    // enemies at the edge of the render distance aren't instantly deleted!
    const SAFE_BUFFER = 0; // Blocks
    const safeStartX = startX - SAFE_BUFFER;
    const safeEndX = endX + SAFE_BUFFER;
    
    // 1. Unload block-coordinate data (using the SAFE bounds)
    walls = walls.filter(w => w.x >= safeStartX && w.x <= safeEndX);
    placedStructures = placedStructures.filter(s => s.origin.x >= safeStartX && s.origin.x <= safeEndX);
    enemySpawns = enemySpawns.filter(s => s.x >= startX);
    
    // 2. Unload pixel-coordinate data (Active Entities, using the SAFE bounds)
    // enemies = enemies.filter(e => e.x >= startX && e.x <= endX);
    
    // 3. Free up memory for regenerated chunks
    // Note: We still use the STRICT startX/endX to clear generatedColumns 
    // so the chunks actually trigger a rebuild when you move backwards.
    const unloadedColumns = [];
    generatedColumns.forEach(col => {
        if (col < startX || col > endX) unloadedColumns.push(col);
    });
    unloadedColumns.forEach(col => generatedColumns.delete(col));
}

// ==========================================
// 3. INPUT HANDLING & EVENTS
// ==========================================
window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    if (key === 'h') toggleUI();
});

window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

window.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const worldTargetX = ((e.clientX - rect.left) * scaleX) / BLOCK_SIZE_PX + camera.x;
    const worldTargetY = ((e.clientY - rect.top) * scaleY) / BLOCK_SIZE_PX + camera.y;

    shoot(
        player, 
        worldTargetX, 
        worldTargetY, 
        bullets, 
        { color: "crimson", speed: 0.2, radiusBlocks: 0.08, maxBounces: 1 }
    );
});

window.addEventListener("contextmenu", (e) => e.preventDefault());
editorUI.addEventListener("mousedown", (e) => e.stopPropagation());
hideUIBtn.addEventListener("click", toggleUI);
loadLevelBtn.addEventListener("click", loadLevel);

// ==========================================
// 4. UI & LEVEL MANAGEMENT
// ==========================================
function toggleUI() {
    if (editorUI.style.display === "none") {
        editorUI.style.display = "block";
        showEditorHelpers = true;
    } else {
        editorUI.style.display = "none";
        showEditorHelpers = false;
    }
}

function loadLevel() {
    try {
        const data = JSON.parse(levelDataInput.value);
        
        if (data.playerSpawn) {
            player.x = data.playerSpawn.x;
            player.y = data.playerSpawn.y;
            player.hp = player.maxHp;
        }

        bullets.length = 0; 
        enemyBullets.length = 0;
        enemies.length = 0;
        walls.length = 0;
        
        // Reset dynamic generation tracking
        generatedColumns.clear();
        placedStructures.length = 0;
        lastSpawnTime = performance.now();

        if (data.seed !== undefined) {
            levelSeed = data.seed;
            enemySpawnRate = data.enemySpawnRate || 0.5;
        } else {
            walls = data.walls || [];
            enemySpawns = data.enemySpawns || [];
            enemySpawnRate = data.enemySpawnRate || 0;
        }
        
        window.focus(); 
    } catch (error) {
        alert("Invalid JSON format. Please check your syntax.");
    }
}

// ==========================================
// 5. CORE MECHANICS & WEAPONS (Logical Units)
// ==========================================
function shoot(shooter, targetX, targetY, bulletArray, stats) {
    const centerX = shooter.x + shooter.size / 2;
    const centerY = shooter.y + shooter.size / 2;
    const angle = Math.atan2(targetY - centerY, targetX - centerX);
    const speed = stats.speed || 0.2;

    if (bulletArray === bullets && bullets.length >= 100) {
        bullets.shift(); 
    }

    bulletArray.push({
        x: centerX, y: centerY,
        radius: stats.radiusBlocks || 0.08,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: stats.color || "white",
        damage: stats.damage || 1,
        bounces: 0,
        maxBounces: stats.maxBounces || 0,
        hitTargets: new Set(),
        createdAt: performance.now()
    });
}

// ==========================================
// 6. AI, PATHFINDING & LINE OF SIGHT
// ==========================================
function hasLineOfSight(x1, y1, x2, y2) {
    for (let w of walls) {
        if (
            lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x + w.width, w.y) || 
            lineIntersects(x1, y1, x2, y2, w.x, w.y + w.height, w.x + w.width, w.y + w.height) || 
            lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x, w.y + w.height) || 
            lineIntersects(x1, y1, x2, y2, w.x + w.width, w.y, w.x + w.width, w.y + w.height)
        ) {
            return false; 
        }
    }
    return true; 
}

function lineIntersects(a,b,c,d,p,q,r,s) {
    let det = (c - a) * (s - q) - (r - p) * (d - b);
    if (det === 0) return false;
    let lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det;
    let gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det;
    return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

function updateEnemies(currentTime) {
    if (enemySpawnRate > 0 && enemySpawns.length > 0) {
        const spawnIntervalMs = 1000 / enemySpawnRate;
        if (currentTime - lastSpawnTime > spawnIntervalMs) {
            
            const pCenterX = player.x + player.size / 2;
            const pCenterY = player.y + player.size / 2;

            const validSpawns = enemySpawns.filter(spawn => {
                const dist = Math.hypot(spawn.x - pCenterX, spawn.y - pCenterY);
                return dist >= MIN_SPAWN_DISTANCE_BLOCKS && dist <= MAX_SPAWN_DISTANCE_BLOCKS;
            });

            if (validSpawns.length > 0) {
            const spawnPoint = validSpawns[Math.floor(seededRandom() * validSpawns.length)];
            const typeName = spawnPoint.type || "g-bot";
            const stats = ENEMY_TYPES[typeName] || ENEMY_TYPES["g-bot"];

            enemies.push({
                // FIX: Multiply block coordinates by BLOCK_SIZE_PX to match player/world pixels!
                x: spawnPoint.x, 
                y: spawnPoint.y,
                size: stats.sizeBlocks, 
                speed: stats.speed, 
                hp: stats.hp, 
                maxHp: stats.hp,
                color: stats.color, 
                lastShot: 0, 
                shootCooldown: stats.shootCooldown,
                typeStats: stats,
                ai: stats.ai,
                lastSeenX: null,
                lastSeenY: null,
                vx: 0,
                vy: 0
            });
        }
            lastSpawnTime = currentTime;
        }
    }

    for (let i = 0; i < enemies.length; i++) {
        let e = enemies[i];
        if (e.hp <= 0) continue; 

        const eCenterX = e.x + e.size / 2;
        const eCenterY = e.y + e.size / 2;
        const pCenterX = player.x + player.size / 2;
        const pCenterY = player.y + player.size / 2;

        const los = hasLineOfSight(eCenterX, eCenterY, pCenterX, pCenterY);

        e.vx = 0;
        e.vy = 0;

        if (los) {
            e.lastSeenX = pCenterX;
            e.lastSeenY = pCenterY;

            if (currentTime - e.lastShot > e.shootCooldown) {
                shoot(e, pCenterX, pCenterY, enemyBullets, { 
                    color: e.typeStats.bulletColor, 
                    speed: e.typeStats.bulletSpeed, 
                    radiusBlocks: e.typeStats.bulletRadiusBlocks, 
                    damage: e.typeStats.bulletDamage, 
                    maxBounces: 0 
                });
                e.lastShot = currentTime;
            }
        }

        if (e.ai === "aggressive") {
            let targetX = null;
            let targetY = null;

            if (los) {
                targetX = pCenterX;
                targetY = pCenterY;
            } else if (e.lastSeenX !== null && e.lastSeenY !== null) {
                targetX = e.lastSeenX;
                targetY = e.lastSeenY;

                const distToMemory = Math.hypot(targetX - eCenterX, targetY - eCenterY);
                if (distToMemory < e.speed) {
                    e.lastSeenX = null;
                    e.lastSeenY = null;
                    targetX = null; 
                }
            }

            if (targetX !== null && targetY !== null) {
                const angle = Math.atan2(targetY - eCenterY, targetX - eCenterX);
                e.vx = Math.cos(angle) * e.speed;
                e.vy = Math.sin(angle) * e.speed;
            }
        }
    }
}

function resolveEnemyVectorCollisions() {
    for (let i = 0; i < enemies.length; i++) {
        for (let j = i + 1; j < enemies.length; j++) {
            let e1 = enemies[i];
            let e2 = enemies[j];
            if (e1.hp <= 0 || e2.hp <= 0) continue;

            let r1 = e1.size / 2;
            let r2 = e2.size / 2;

            let c1x = e1.x + r1 + e1.vx;
            let c1y = e1.y + r1 + e1.vy;
            let c2x = e2.x + r2 + e2.vx;
            let c2y = e2.y + r2 + e2.vy;

            let dx = c2x - c1x;
            let dy = c2y - c1y;
            let distance = Math.hypot(dx, dy);
            let minDist = r1 + r2;

            if (distance < minDist) {
                let nx, ny;
                if (distance === 0) {
                    let randomAngle = Math.random() * Math.PI * 2;
                    nx = Math.cos(randomAngle);
                    ny = Math.sin(randomAngle);
                    distance = 0.001; 
                } else {
                    nx = dx / distance;
                    ny = dy / distance;
                }

                let overlap = minDist - distance;
                let totalSize = e1.size + e2.size;
                let weight1 = e2.size / totalSize;
                let weight2 = e1.size / totalSize;

                e1.vx -= nx * overlap * weight1 * 0.5;
                e1.vy -= ny * overlap * weight1 * 0.5;
                e2.vx += nx * overlap * weight2 * 0.5;
                e2.vy += ny * overlap * weight2 * 0.5;
            }
        }
    }
}

function applyEnemyMovementAndWalls() {
    for (let i = enemies.length - 1; i >= 0; i--) {
        let e = enemies[i];
        if (e.hp <= 0) {
            enemies.splice(i, 1);
            continue;
        }

        e.x += e.vx;
        walls.forEach(w => {
            if (e.x + e.size > w.x && e.x < w.x + w.width && e.y + e.size > w.y && e.y < w.y + w.height) {
                if (e.vx > 0) e.x = w.x - e.size;
                if (e.vx < 0) e.x = w.x + w.width;
            }
        });

        e.y += e.vy;
        walls.forEach(w => {
            if (e.x + e.size > w.x && e.x < w.x + w.width && e.y + e.size > w.y && e.y < w.y + w.height) {
                if (e.vy > 0) e.y = w.y - e.size;
                if (e.vy < 0) e.y = w.y + w.height;
            }
        });
    }
}

function processBullets(bulletArray, isPlayerBullets, currentTime) {
    for (let i = bulletArray.length - 1; i >= 0; i--) {
        let b = bulletArray[i];
        
        b.x += b.vx;
        walls.forEach(w => {
            if (b.x + b.radius > w.x && b.x - b.radius < w.x + w.width && 
                b.y + b.radius > w.y && b.y - b.radius < w.y + w.height) {
                b.vx *= -1; 
                b.x += b.vx; 
                b.bounces++; 
            }
        });

        b.y += b.vy;
        walls.forEach(w => {
            if (b.x + b.radius > w.x && b.x - b.radius < w.x + w.width && 
                b.y + b.radius > w.y && b.y - b.radius < w.y + w.height) {
                b.vy *= -1; 
                b.y += b.vy; 
                b.bounces++; 
            }
        });

        if (isPlayerBullets) {
            enemies.forEach(e => {
                const isColliding = b.x + b.radius > e.x && 
                                    b.x - b.radius < e.x + e.size && 
                                    b.y + b.radius > e.y && 
                                    b.y - b.radius < e.y + e.size;
                if (isColliding) {
                    if (!b.hitTargets.has(e)) {
                        e.hp -= 1;
                        b.hitTargets.add(e);
                    }
                } else {
                    b.hitTargets.delete(e);
                }
            });
        } else {
            const isColliding = b.x + b.radius > player.x && 
                                b.x - b.radius < player.x + player.size && 
                                b.y + b.radius > player.y && 
                                b.y - b.radius < player.y + player.size;
            if (isColliding) {
                if (!b.hitTargets.has(player)) {
                    if (!isInvincible) {
                        player.hp -= b.damage; 
                    }
                    b.hitTargets.add(player);
                }
            } else {
                b.hitTargets.delete(player);
            }
        }

        const maxLifetimeMs = 60000; 
        const isExpired = (currentTime - b.createdAt) > maxLifetimeMs;

        if (b.bounces > b.maxBounces || isExpired) {
            bulletArray.splice(i, 1);
        }
    }
}

// ==========================================
// 7. MAIN LOOP (UPDATE & DRAW)
// ==========================================
function update(currentTime) {
    if (player.hp <= 0) return;

    updateProceduralGeneration(player.x);
    cleanupProceduralGeneration(player.x);

    let dx = 0, dy = 0;
    if (keys.w) dy -= player.speed;
    if (keys.s) dy += player.speed;
    if (keys.a) dx -= player.speed;
    if (keys.d) dx += player.speed;

    player.x += dx;
    walls.forEach(w => {
        if (player.x + player.size > w.x && player.x < w.x + w.width && player.y + player.size > w.y && player.y < w.y + w.height) {
            if (dx > 0) player.x = w.x - player.size; if (dx < 0) player.x = w.x + w.width;    
        }
    });

    player.y += dy;
    walls.forEach(w => {
        if (player.x + player.size > w.x && player.x < w.x + w.width && player.y + player.size > w.y && player.y < w.y + w.height) {
            if (dy > 0) player.y = w.y - player.size; if (dy < 0) player.y = w.y + w.height;    
        }
    });

    updateEnemies(currentTime);         
    resolveEnemyVectorCollisions();     
    applyEnemyMovementAndWalls();       
    updateCamera();                     

    processBullets(bullets, true, currentTime);
    processBullets(enemyBullets, false, currentTime);
}

// ==========================================
// RENDER ENVIRONMENT & WORLD (Translates block units to pixels)
// ==========================================
function drawProceduralEnvironment() {
    const startX = Math.floor(camera.x);
    const endX = startX + camera.widthBlocks + 2;
    const startY = Math.floor(camera.y);
    const endY = startY + camera.heightBlocks + 2;

    ctx.lineWidth = 1;
    for (let x = startX; x < endX; x++) {
        for (let y = startY; y < endY; y++) {
            const px = x * BLOCK_SIZE_PX;
            const py = y * BLOCK_SIZE_PX;
            ctx.fillStyle = ((Math.abs(x + y)) % 2 === 0) ? "#111111" : "#1a1a1a";
            ctx.fillRect(px, py, BLOCK_SIZE_PX, BLOCK_SIZE_PX);
            ctx.strokeStyle = "#222222";
            ctx.strokeRect(px, py, BLOCK_SIZE_PX, BLOCK_SIZE_PX);

            // Render coordinate labels only when editor helpers/UI are active
            if (showEditorHelpers) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
                ctx.font = "10px monospace";
                ctx.fillText(`${x},${y}`, px + 4, py + 14);
            }
        }
    }

    // Render enemy spawn points only when editor helpers/UI are active
    if (showEditorHelpers) {
        enemySpawns.forEach(spawn => {
            const renderSizePx = (spawn.size || PLAYER_SIZE_BLOCKS) * BLOCK_SIZE_PX;
            const px = spawn.x * BLOCK_SIZE_PX;
            const py = spawn.y * BLOCK_SIZE_PX;

            ctx.strokeStyle = "cyan";
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, renderSizePx, renderSizePx);
            
            ctx.fillStyle = "rgba(0, 255, 255, 0.2)";
            ctx.fillRect(px, py, renderSizePx, renderSizePx);

            ctx.fillStyle = "cyan";
            ctx.font = "10px monospace";
            ctx.fillText(`SPAWN: ${spawn.type || "g-bot"}`, px, py - 4);
        });
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-Math.floor(camera.x * BLOCK_SIZE_PX), -Math.floor(camera.y * BLOCK_SIZE_PX));

    drawProceduralEnvironment();

    walls.forEach(w => { 
        ctx.fillStyle = w.color; 
        ctx.fillRect(w.x * BLOCK_SIZE_PX, w.y * BLOCK_SIZE_PX, w.width * BLOCK_SIZE_PX, w.height * BLOCK_SIZE_PX); 
    });

    if (player.hp > 0) {
        const pPxX = player.x * BLOCK_SIZE_PX;
        const pPxY = player.y * BLOCK_SIZE_PX;
        const pPxSize = player.size * BLOCK_SIZE_PX;
        ctx.fillStyle = player.color;
        ctx.fillRect(pPxX, pPxY, pPxSize, pPxSize);
        drawHealthBar(pPxX, pPxY - 10, pPxSize, player.hp, player.maxHp, "cyan");
    }

    enemies.forEach(e => {
        const ePxX = e.x * BLOCK_SIZE_PX;
        const ePxY = e.y * BLOCK_SIZE_PX;
        const ePxSize = e.size * BLOCK_SIZE_PX;
        ctx.fillStyle = e.color;
        ctx.fillRect(ePxX, ePxY, ePxSize, ePxSize);
        drawHealthBar(ePxX, ePxY - 10, ePxSize, e.hp, e.maxHp, "red");
    });

    [...bullets, ...enemyBullets].forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x * BLOCK_SIZE_PX, b.y * BLOCK_SIZE_PX, b.radius * BLOCK_SIZE_PX, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.closePath();
    });

    ctx.restore(); 

    if (player.hp <= 0) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "red";
        ctx.font = "40px sans-serif";
        ctx.fillText("GAME OVER", canvas.width / 2 - 120, canvas.height / 2);
    }
}

function drawHealthBar(x, y, width, hp, maxHp, color) {
    ctx.fillStyle = "black";
    ctx.fillRect(x, y, width, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * (hp / maxHp), 5);
}

function gameLoop(currentTime) {
    update(currentTime);
    draw();
    requestAnimationFrame(gameLoop);
}

// ==========================================
// 8. INITIALIZATION
// ==========================================
loadLevel();
requestAnimationFrame(gameLoop);