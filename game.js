// ========================================== 
// 1. CONFIGURATION & STATE
// ========================================== 
const Config = {
    PLAYER_SPEED: 0,        // blocks/second
    PLAYER_BULLET_SPEED: 0, // blocks/second
    PLAYER_SHOOT_COOLDOWN: 0,
    STRUCTURE_DENSITY_BLOCKS: 0,
    ENEMY_TYPES: {},
    STRUCTURE_LIBRARY: [],
    BLOCK_SIZE_PX: 64,
    PLAYER_SIZE_BLOCKS: 0.5,
    MIN_SPAWN_DISTANCE_BLOCKS: 15,
    MAX_SPAWN_DISTANCE_BLOCKS: 25,
    RENDER_DISTANCE_FRONT: 35,
    RENDER_DISTANCE_BACK: 12
};

// config.json provides defaults. The config editor stores persistent overrides here.
// localStorage is shared by index.html/config.html as long as they use the same origin.
const CONFIG_STORAGE_KEY = "demoGameConfig";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Merge saved settings over config.json while keeping any new defaults that may
// be added later. Arrays (such as STRUCTURE_LIBRARY) are intentionally replaced.
function mergeConfig(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return override;
    }

    const result = { ...base };

    for (const [key, value] of Object.entries(override)) {
        if (isPlainObject(value) && isPlainObject(base[key])) {
            result[key] = mergeConfig(base[key], value);
        } else {
            result[key] = value;
        }
    }

    return result;
}

function loadLocalConfig(defaultConfig) {
    try {
        const savedJson = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (!savedJson) return defaultConfig;

        const savedConfig = JSON.parse(savedJson);
        if (!isPlainObject(savedConfig)) {
            throw new Error("Saved config is not a JSON object.");
        }

        // Schema v3 adds type-specific enemy spawn flags to STRUCTURE_LIBRARY grids.
        // Preserve the user's other local settings, but upgrade stale structure
        // data so an older local save cannot remove or reinterpret the new flags.
        if (savedConfig.CONFIG_SCHEMA_VERSION !== defaultConfig.CONFIG_SCHEMA_VERSION) {
            const migratedConfig = mergeConfig(defaultConfig, savedConfig);
            migratedConfig.CONFIG_SCHEMA_VERSION = defaultConfig.CONFIG_SCHEMA_VERSION;
            migratedConfig.STRUCTURE_LIBRARY = defaultConfig.STRUCTURE_LIBRARY;
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(migratedConfig));
            console.log("Local config migrated to type-specific structure-spawn schema v3.");
            return migratedConfig;
        }

        console.log("Using locally saved config.");
        return mergeConfig(defaultConfig, savedConfig);
    } catch (error) {
        console.warn("Could not load local config; using config.json defaults.", error);
        return defaultConfig;
    }
}

const GameState = {
    keys: { w: false, a: false, s: false, d: false },
    bullets: [],
    enemyBullets: [],
    enemies: [],
    walls: [],
    enemySpawns: [],
    enemySpawnRate: 0,
    lastSpawnTime: 0,
    generatedColumns: new Set(),
    placedStructures: [],
    levelSeed: 12345,
    currentSeed: 12345,
    playerLastShot: 0,
    showEditorHelpers: true,
    isInvincible: false
};

const player = { 
    x: 0, y: 0, 
    size: Config.PLAYER_SIZE_BLOCKS, speed: Config.PLAYER_SPEED, 
    color: "royalblue", hp: 10, maxHp: 10 
}; 

const camera = { 
    x: 0, y: 0, 
    widthBlocks: 20, heightBlocks: 11.25 
}; 

// DOM Elements
const canvas = document.getElementById("gameCanvas"); 
const ctx = canvas.getContext("2d"); 
const editorUI = document.getElementById("editorUI"); 
const hideUIBtn = document.getElementById("hideUIBtn"); 
const levelDataInput = document.getElementById("levelData"); 
const loadLevelBtn = document.getElementById("loadLevelBtn"); 
const godModeToggle = document.getElementById("godModeToggle");

// ========================================== 
// 2. UTILITY & HELPER FUNCTIONS
// ========================================== 
function seededRandom() { 
    GameState.currentSeed = (GameState.currentSeed * 9301 + 49297) % 233280; 
    return GameState.currentSeed / 233280; 
} 

// Unified AABB Collision detection
function isColliding(rect1, rect2) {
    return rect1.x < rect2.x + (rect2.width || rect2.size) &&
           rect1.x + (rect1.width || rect1.size) > rect2.x &&
           rect1.y < rect2.y + (rect2.height || rect2.size) &&
           rect1.y + (rect1.height || rect1.size) > rect2.y;
}

// Unified Wall Collision & Sliding Response
function handleWallCollisions(entity, dx, dy) {
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

// ========================================== 
// 3. PROCEDURAL GENERATION
// ========================================== 
function spawnWall(x, y, widthBlocks, heightBlocks, color = "slategray") { 
    GameState.walls.push({ x, y, width: widthBlocks, height: heightBlocks, color }); 
} 

function chooseEnemyType() {
    const enemyTypeRoll = seededRandom();
    return enemyTypeRoll > 0.7 ? "h-bot" : (enemyTypeRoll > 0.3 ? "j-bot" : "g-bot");
}

// Structure grid flags:
//   0 = empty cell
//   1 = wall cell
//   2 = random enemy spawn
//   3 = g-bot spawn
//   4 = j-bot spawn
//   5 = h-bot spawn
//
// Keeping flag 2 as a random spawn preserves the old structure-spawn behaviour,
// while flags 3-5 let a structure explicitly choose its enemy type.
const STRUCTURE_ENEMY_FLAGS = Object.freeze({
    2: null,
    3: "g-bot",
    4: "j-bot",
    5: "h-bot"
});

function enemyTypeFromStructureFlag(flag) {
    if (!Object.prototype.hasOwnProperty.call(STRUCTURE_ENEMY_FLAGS, flag)) {
        return undefined;
    }

    return STRUCTURE_ENEMY_FLAGS[flag] || chooseEnemyType();
}

// Spawn points are centered inside their structure cell. Because a cell can only
// have one flag, an enemy spawn can never also be a wall cell in the same structure.
function spawnEnemyPointFromCell(cellX, cellY, type) {
    const resolvedType = Config.ENEMY_TYPES[type] ? type : "g-bot";
    const stats = Config.ENEMY_TYPES[resolvedType];
    const size = stats.sizeBlocks;

    GameState.enemySpawns.push({
        x: cellX + (1 - size) / 2,
        y: cellY + (1 - size) / 2,
        type: resolvedType,
        size
    });
}

function updateProceduralGeneration(playerX) { 
    const startX = Math.max(0, Math.floor(playerX) - Config.RENDER_DISTANCE_BACK); 
    const endX = Math.floor(playerX) + Config.RENDER_DISTANCE_FRONT; 
    const ceilingY = 0; 
    const corridorWidthBlocks = 10; 
    const floorY = ceilingY + corridorWidthBlocks; 

    if (!GameState.generatedColumns.has(0) && startX <= 0 && endX >= 0) { 
        spawnWall(0, ceilingY, 1, corridorWidthBlocks + 1, "slategray"); 
    } 

    for (let blockX = startX; blockX <= endX; blockX++) { 
        if (GameState.generatedColumns.has(blockX)) continue; 
        GameState.generatedColumns.add(blockX); 

        spawnWall(blockX, ceilingY, 1, 1, "slategray"); 
        spawnWall(blockX, floorY, 1, 1, "slategray"); 

        if (blockX >= 1) { 
            GameState.currentSeed = ((GameState.levelSeed ^ (blockX * 2654435761)) >>> 0) % 233280; 

            if (seededRandom() > 0.5) { 
                let template = Config.STRUCTURE_LIBRARY[Math.floor(seededRandom() * Config.STRUCTURE_LIBRARY.length)]; 
                let minY = ceilingY + 1; 
                let maxY = floorY - template.heightBlocks; 
                let structY = Math.floor(seededRandom() * (maxY - minY + 1)) + minY; 
                
                let canSpawn = !GameState.placedStructures.some(s => 
                    Math.hypot(blockX - s.origin.x, structY - s.origin.y) < Config.STRUCTURE_DENSITY_BLOCKS
                );

                if (canSpawn) { 
                    GameState.placedStructures.push({ 
                        origin: { x: blockX, y: structY }, 
                        size: { width: template.widthBlocks, height: template.heightBlocks }, 
                        type: template.type 
                    }); 

                    // Build the structure directly from its grid flags.
                    // 0 = empty, 1 = wall, 2 = random spawn,
                    // 3 = g-bot, 4 = j-bot, 5 = h-bot.
                    for (let r = 0; r < template.grid.length; r++) {
                        for (let c = 0; c < template.grid[r].length; c++) {
                            const cell = template.grid[r][c];
                            const worldX = blockX + c;
                            const worldY = structY + r;

                            if (cell === 1) {
                                spawnWall(worldX, worldY, 1, 1, template.color);
                                continue;
                            }

                            const enemyType = enemyTypeFromStructureFlag(cell);
                            if (enemyType !== undefined) {
                                spawnEnemyPointFromCell(worldX, worldY, enemyType);
                            }
                        }
                    }
                } 
            } 
        } 
    } 
} 

function cleanupProceduralGeneration(playerX) { 
    const startX = Math.max(0, Math.floor(playerX) - Config.RENDER_DISTANCE_BACK); 
    const endX = Math.floor(playerX) + Config.RENDER_DISTANCE_FRONT; 
    const SAFE_BUFFER = 0; 
    const safeStartX = startX - SAFE_BUFFER; 
    const safeEndX = endX + SAFE_BUFFER; 

    GameState.walls = GameState.walls.filter(w => w.x >= safeStartX && w.x <= safeEndX); 
    GameState.placedStructures = GameState.placedStructures.filter(s => s.origin.x >= safeStartX && s.origin.x <= safeEndX); 
    GameState.enemySpawns = GameState.enemySpawns.filter(s => s.x >= startX); 

    const unloadedColumns = Array.from(GameState.generatedColumns).filter(col => col < startX || col > endX);
    unloadedColumns.forEach(col => GameState.generatedColumns.delete(col)); 
} 

// ========================================== 
// 4. COMBAT & ENTITY LOGIC
// ========================================== 
function shoot(shooter, targetX, targetY, bulletArray, stats) { 
    const centerX = shooter.x + shooter.size / 2; 
    const centerY = shooter.y + shooter.size / 2; 
    const spread = stats.spreadOffset || 0; 
    const angle = Math.atan2(targetY - centerY, targetX - centerX) + spread; 
    const speed = stats.speed ?? 12; // blocks/second 

    if (bulletArray === GameState.bullets && GameState.bullets.length >= 100) GameState.bullets.shift(); 

    bulletArray.push({ 
        x: centerX, y: centerY, 
        radius: stats.radiusBlocks || 0.08, 
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, 
        color: stats.color || "white", damage: stats.damage || 1, 
        bounces: 0, maxBounces: stats.maxBounces || 0, 
        hitTargets: new Set(), createdAt: performance.now(),
        // Map radius to width/height for standard collision check
        get width() { return this.radius * 2; }, get height() { return this.radius * 2; },
        get size() { return this.radius * 2; }
    }); 
} 

function lineIntersects(a,b,c,d,p,q,r,s) { 
    let det = (c - a) * (s - q) - (r - p) * (d - b); 
    if (det === 0) return false; 
    let lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det; 
    let gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det; 
    return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1); 
} 

function hasLineOfSight(x1, y1, x2, y2) { 
    return !GameState.walls.some(w => 
        lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x + w.width, w.y) || 
        lineIntersects(x1, y1, x2, y2, w.x, w.y + w.height, w.x + w.width, w.y + w.height) || 
        lineIntersects(x1, y1, x2, y2, w.x, w.y, w.x, w.y + w.height) || 
        lineIntersects(x1, y1, x2, y2, w.x + w.width, w.y, w.x + w.width, w.y + w.height)
    );
} 

function updateEnemies(currentTime, dt) { 
    if (GameState.enemySpawnRate > 0 && GameState.enemySpawns.length > 0) { 
        const spawnIntervalMs = 1000 / GameState.enemySpawnRate; 
        if (currentTime - GameState.lastSpawnTime > spawnIntervalMs) { 
            const pCenterX = player.x + player.size / 2; 
            const pCenterY = player.y + player.size / 2; 

            const validSpawns = GameState.enemySpawns.filter(spawn => { 
                const dist = Math.hypot(spawn.x - pCenterX, spawn.y - pCenterY); 
                return dist >= Config.MIN_SPAWN_DISTANCE_BLOCKS && dist <= Config.MAX_SPAWN_DISTANCE_BLOCKS; 
            }); 

            if (validSpawns.length > 0) { 
                const spawnPoint = validSpawns[Math.floor(seededRandom() * validSpawns.length)]; 
                const typeName = spawnPoint.type || "g-bot"; 
                const stats = Config.ENEMY_TYPES[typeName] || Config.ENEMY_TYPES["g-bot"]; 

                GameState.enemies.push({ 
                    x: spawnPoint.x, y: spawnPoint.y, 
                    size: stats.sizeBlocks, speed: stats.speed, // blocks/second
                    hp: stats.hp, maxHp: stats.hp, color: stats.color, 
                    lastShot: 0, shootCooldown: stats.shootCooldown, typeStats: stats, 
                    ai: stats.ai, lastSeenX: null, lastSeenY: null, vx: 0, vy: 0,
                    moveX: 0, moveY: 0
                }); 
            } 
            GameState.lastSpawnTime = currentTime; 
        } 
    } 

    GameState.enemies.forEach(e => {
        if (e.hp <= 0) return; 

        const eCenterX = e.x + e.size / 2; 
        const pCenterX = player.x + player.size / 2; 
        const eCenterY = e.y + e.size / 2; 
        const pCenterY = player.y + player.size / 2; 
        const los = hasLineOfSight(eCenterX, eCenterY, pCenterX, pCenterY); 

        // Velocity is always stored in blocks/second.
        e.vx = 0; 
        e.vy = 0; 

        if (los) { 
            e.lastSeenX = pCenterX; 
            e.lastSeenY = pCenterY; 

            // Cooldowns are already real time in milliseconds, so do not multiply by dt.
            if (currentTime - e.lastShot > e.shootCooldown) { 
                const spreadOffset = (Math.random() - 0.5) * (e.typeStats.spread || 0);
                shoot(e, pCenterX, pCenterY, GameState.enemyBullets, { 
                    color: e.typeStats.bulletColor, 
                    speed: e.typeStats.bulletSpeed, // blocks/second
                    radiusBlocks: e.typeStats.bulletRadiusBlocks, 
                    damage: e.typeStats.bulletDamage, 
                    maxBounces: 0, 
                    spreadOffset: spreadOffset 
                }); 
                e.lastShot = currentTime; 
            } 
        } 

        if (e.ai === "aggressive") { 
            let targetX = los ? pCenterX : e.lastSeenX;
            let targetY = los ? pCenterY : e.lastSeenY;

            if (!los && targetX !== null) {
                // Compare against how far the enemy can actually move this frame.
                if (Math.hypot(targetX - eCenterX, targetY - eCenterY) < e.speed * dt) { 
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
    });
} 

function resolveEnemyVectorCollisions(dt) { 
    // Convert velocity (blocks/sec) into this frame's displacement (blocks).
    GameState.enemies.forEach(e => {
        e.moveX = e.vx * dt;
        e.moveY = e.vy * dt;
    });

    for (let i = 0; i < GameState.enemies.length; i++) { 
        for (let j = i + 1; j < GameState.enemies.length; j++) { 
            let e1 = GameState.enemies[i], e2 = GameState.enemies[j]; 
            if (e1.hp <= 0 || e2.hp <= 0) continue; 

            let r1 = e1.size / 2, r2 = e2.size / 2; 
            let dx = (e2.x + r2 + e2.moveX) - (e1.x + r1 + e1.moveX); 
            let dy = (e2.y + r2 + e2.moveY) - (e1.y + r1 + e1.moveY); 
            let distance = Math.hypot(dx, dy); 
            let minDist = r1 + r2; 

            if (distance < minDist) { 
                let nx = distance === 0 ? Math.cos(Math.random() * Math.PI * 2) : dx / distance;
                let ny = distance === 0 ? Math.sin(Math.random() * Math.PI * 2) : dy / distance;

                let overlap = minDist - (distance === 0 ? 0.001 : distance); 
                let weight1 = e2.size / (e1.size + e2.size); 
                let weight2 = e1.size / (e1.size + e2.size); 

                // These corrections are displacements in blocks, not velocities.
                e1.moveX -= nx * overlap * weight1 * 0.5; 
                e1.moveY -= ny * overlap * weight1 * 0.5; 
                e2.moveX += nx * overlap * weight2 * 0.5; 
                e2.moveY += ny * overlap * weight2 * 0.5; 
            } 
        } 
    } 
} 

const BULLET_MAX_STEP_BLOCKS = 0.2;

function processBullets(bulletArray, isPlayerBullets, currentTime, dt) { 
    for (let i = bulletArray.length - 1; i >= 0; i--) { 
        let b = bulletArray[i]; 
        const targets = isPlayerBullets ? GameState.enemies : [player];

        // Velocity is blocks/second. Substep fast bullets so a slow frame cannot
        // tunnel through a one-block wall or a small target.
        const frameDistance = Math.hypot(b.vx, b.vy) * dt;
        const steps = Math.max(1, Math.ceil(frameDistance / BULLET_MAX_STEP_BLOCKS));
        const stepDt = dt / steps;

        let removeBullet = false;

        for (let step = 0; step < steps; step++) {
            let mockRect = {
                x: b.x - b.radius,
                y: b.y - b.radius,
                size: b.radius * 2
            };

            // Move X using blocks/sec × seconds = blocks.
            const moveX = b.vx * stepDt;
            b.x += moveX;
            mockRect.x = b.x - b.radius;
            mockRect.y = b.y - b.radius;

            if (GameState.walls.some(w => isColliding(mockRect, w))) {
                b.x -= moveX;
                b.vx *= -1;
                b.bounces++;
                mockRect.x = b.x - b.radius;
            }

            // Move Y separately so reflection happens on the correct axis.
            const moveY = b.vy * stepDt;
            b.y += moveY;
            mockRect.x = b.x - b.radius;
            mockRect.y = b.y - b.radius;

            if (GameState.walls.some(w => isColliding(mockRect, w))) {
                b.y -= moveY;
                b.vy *= -1;
                b.bounces++;
                mockRect.y = b.y - b.radius;
            }

            // Check targets on every substep to prevent high-speed tunnelling.
            targets.forEach(t => { 
                if (isColliding(mockRect, t)) { 
                    if (!b.hitTargets.has(t)) { 
                        if (isPlayerBullets || !GameState.isInvincible) {
                            t.hp -= (b.damage || 1); 
                        }
                        b.hitTargets.add(t); 
                    } 
                } else { 
                    b.hitTargets.delete(t); 
                } 
            }); 

            if (b.bounces > b.maxBounces) {
                removeBullet = true;
                break;
            }
        }

        if (removeBullet || (currentTime - b.createdAt) > 60000) {
            bulletArray.splice(i, 1);
        }
    } 
} 

// ========================================== 
// 5. EVENT LISTENERS & UI
// ========================================== 
window.addEventListener("keydown", (e) => { 
    const key = e.key.toLowerCase(); 
    if (GameState.keys.hasOwnProperty(key)) GameState.keys[key] = true; 
    if (key === 'h') toggleUI(); 
}); 
window.addEventListener("keyup", (e) => { 
    const key = e.key.toLowerCase(); 
    if (GameState.keys.hasOwnProperty(key)) GameState.keys[key] = false; 
}); 

window.addEventListener("mousedown", (e) => { 
    e.preventDefault(); 
    const now = performance.now();
    if (now - GameState.playerLastShot < Config.PLAYER_SHOOT_COOLDOWN) return;
    GameState.playerLastShot = now;

    const rect = canvas.getBoundingClientRect(); 
    const worldTargetX = ((e.clientX - rect.left) * (canvas.width / rect.width)) / Config.BLOCK_SIZE_PX + camera.x; 
    const worldTargetY = ((e.clientY - rect.top) * (canvas.height / rect.height)) / Config.BLOCK_SIZE_PX + camera.y; 

    shoot(player, worldTargetX, worldTargetY, GameState.bullets, { 
        color: "crimson", speed: Config.PLAYER_BULLET_SPEED, radiusBlocks: 0.08, maxBounces: 1 
    }); 
}); 

window.addEventListener("contextmenu", (e) => e.preventDefault()); 
editorUI.addEventListener("mousedown", (e) => e.stopPropagation()); 
hideUIBtn.addEventListener("click", toggleUI); 
loadLevelBtn.addEventListener("click", loadLevel); 
if (godModeToggle) godModeToggle.addEventListener("change", (e) => GameState.isInvincible = e.target.checked); 

function toggleUI() { 
    GameState.showEditorHelpers = !GameState.showEditorHelpers;
    editorUI.style.display = GameState.showEditorHelpers ? "block" : "none"; 
} 

function loadLevel() { 
    try { 
        const data = JSON.parse(levelDataInput.value); 
        if (data.playerSpawn) { 
            player.x = data.playerSpawn.x; player.y = data.playerSpawn.y; player.hp = player.maxHp; 
        } 
        
        GameState.bullets.length = 0; GameState.enemyBullets.length = 0; GameState.enemies.length = 0; 
        GameState.walls.length = 0; GameState.generatedColumns.clear(); GameState.placedStructures.length = 0; 
        GameState.lastSpawnTime = performance.now(); 

        if (data.seed !== undefined) { 
            GameState.levelSeed = data.seed; GameState.enemySpawnRate = data.enemySpawnRate || 0.5; 
        } else { 
            GameState.walls = data.walls || []; GameState.enemySpawns = data.enemySpawns || []; 
            GameState.enemySpawnRate = data.enemySpawnRate || 0; 
        } 
        window.focus(); 
    } catch (error) { alert("Invalid JSON format. Please check your syntax."); } 
} 

// ========================================== 
// 6. MAIN LOOP & RENDERING
// ========================================== 
function update(currentTime, dt) { 
    if (player.hp <= 0) return; 

    updateProceduralGeneration(player.x); 
    cleanupProceduralGeneration(player.x); 

    // Every speed value is blocks/second.
    // displacement = speed × dt, where dt is in seconds.
    let dx = 0, dy = 0; 
    if (GameState.keys.w) dy -= player.speed * dt; 
    if (GameState.keys.s) dy += player.speed * dt; 
    if (GameState.keys.a) dx -= player.speed * dt; 
    if (GameState.keys.d) dx += player.speed * dt; 

    handleWallCollisions(player, dx, dy);

    updateEnemies(currentTime, dt);         
    resolveEnemyVectorCollisions(dt);     

    // Enemy moveX/moveY are this frame's displacements in blocks.
    GameState.enemies = GameState.enemies.filter(e => {
        if (e.hp <= 0) return false;
        handleWallCollisions(e, e.moveX, e.moveY);
        return true;
    });

    // Update Camera
    camera.x = player.x - camera.widthBlocks / 2 + player.size / 2; 
    camera.y = player.y - camera.heightBlocks / 2 + player.size / 2; 

    processBullets(GameState.bullets, true, currentTime, dt); 
    processBullets(GameState.enemyBullets, false, currentTime, dt); 
} 

function drawProceduralEnvironment() { 
    const startX = Math.floor(camera.x), endX = startX + camera.widthBlocks + 2; 
    const startY = Math.floor(camera.y), endY = startY + camera.heightBlocks + 2; 

    ctx.lineWidth = 1; 
    for (let x = startX; x < endX; x++) { 
        for (let y = startY; y < endY; y++) { 
            const px = x * Config.BLOCK_SIZE_PX, py = y * Config.BLOCK_SIZE_PX; 
            ctx.fillStyle = ((Math.abs(x + y)) % 2 === 0) ? "#111111" : "#1a1a1a"; 
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
        GameState.enemySpawns.forEach(spawn => { 
            const renderSizePx = (spawn.size || Config.PLAYER_SIZE_BLOCKS) * Config.BLOCK_SIZE_PX; 
            const px = spawn.x * Config.BLOCK_SIZE_PX, py = spawn.y * Config.BLOCK_SIZE_PX; 
            ctx.strokeStyle = "cyan"; ctx.lineWidth = 2; ctx.strokeRect(px, py, renderSizePx, renderSizePx); 
            ctx.fillStyle = "rgba(0, 255, 255, 0.2)"; ctx.fillRect(px, py, renderSizePx, renderSizePx); 
            ctx.fillStyle = "cyan"; ctx.font = "10px monospace"; ctx.fillText(`SPAWN: ${spawn.type}`, px, py - 4); 
        }); 
    } 
} 

function drawHealthBar(x, y, width, hp, maxHp, color) { 
    ctx.fillStyle = "black"; ctx.fillRect(x, y, width, 5); 
    ctx.fillStyle = color; ctx.fillRect(x, y, width * (hp / maxHp), 5); 
} 

function draw() { 
    ctx.clearRect(0, 0, canvas.width, canvas.height); 
    ctx.save(); 
    ctx.translate(-Math.floor(camera.x * Config.BLOCK_SIZE_PX), -Math.floor(camera.y * Config.BLOCK_SIZE_PX)); 

    drawProceduralEnvironment(); 

    GameState.walls.forEach(w => {  
        ctx.fillStyle = w.color;  
        ctx.fillRect(w.x * Config.BLOCK_SIZE_PX, w.y * Config.BLOCK_SIZE_PX, w.width * Config.BLOCK_SIZE_PX, w.height * Config.BLOCK_SIZE_PX);  
    }); 

    if (player.hp > 0) { 
        const pPxX = player.x * Config.BLOCK_SIZE_PX, pPxY = player.y * Config.BLOCK_SIZE_PX, pPxSize = player.size * Config.BLOCK_SIZE_PX; 
        ctx.fillStyle = player.color; ctx.fillRect(pPxX, pPxY, pPxSize, pPxSize); 
        drawHealthBar(pPxX, pPxY - 10, pPxSize, player.hp, player.maxHp, "cyan"); 
    } 

    GameState.enemies.forEach(e => { 
        const ePxX = e.x * Config.BLOCK_SIZE_PX, ePxY = e.y * Config.BLOCK_SIZE_PX, ePxSize = e.size * Config.BLOCK_SIZE_PX; 
        ctx.fillStyle = e.color; ctx.fillRect(ePxX, ePxY, ePxSize, ePxSize); 
        drawHealthBar(ePxX, ePxY - 10, ePxSize, e.hp, e.maxHp, "red"); 
    }); 

    [...GameState.bullets, ...GameState.enemyBullets].forEach(b => { 
        ctx.beginPath(); 
        ctx.arc(b.x * Config.BLOCK_SIZE_PX, b.y * Config.BLOCK_SIZE_PX, b.radius * Config.BLOCK_SIZE_PX, 0, Math.PI * 2); 
        ctx.fillStyle = b.color; ctx.fill(); ctx.closePath(); 
    }); 

    ctx.restore();  

    if (player.hp <= 0) { 
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)"; ctx.fillRect(0, 0, canvas.width, canvas.height); 
        ctx.fillStyle = "red"; ctx.font = "40px sans-serif"; ctx.fillText("GAME OVER", canvas.width / 2 - 120, canvas.height / 2); 
    } 
} 

let lastFrameTime = null;
const MAX_DT_SECONDS = 0.05; // cap simulation step to 50 ms after stalls/tab switches

function gameLoop(currentTime) { 
    let dt = 0;

    if (lastFrameTime !== null) {
        dt = (currentTime - lastFrameTime) / 1000;
        dt = Math.min(Math.max(dt, 0), MAX_DT_SECONDS);
    }

    lastFrameTime = currentTime;

    if (dt > 0) {
        update(currentTime, dt);
    }

    draw(); 
    requestAnimationFrame(gameLoop); 
} 

// ========================================== 
// 7. INITIALIZATION & EXPORT
// ========================================== 
function exportConfig() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(Config, null, 4));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = "custom_config.json";
    document.body.appendChild(a); 
    a.click();
    a.remove();
}

async function initGame() {
    try {
        // config.json is the default/factory configuration.
        const response = await fetch('config.json');
        if (!response.ok) throw new Error("Network response was not ok");

        const defaultConfig = await response.json();

        // If the config editor has saved an override, use it on top of the
        // defaults. This makes editor changes persistent without trying to
        // write to config.json (browsers are not allowed to overwrite it).
        const loadedData = loadLocalConfig(defaultConfig);

        Object.assign(Config, loadedData);

        // Sync objects that copied config values during initial construction.
        player.speed = Config.PLAYER_SPEED;
        player.size = Config.PLAYER_SIZE_BLOCKS;

        loadLevel();
        requestAnimationFrame(gameLoop);
        console.log("Config loaded successfully. Game starting...");
    } catch (error) {
        console.error("Failed to load config.json:", error);
        alert("Could not load game configuration! Check console for details.");
    }
}

// Start
initGame();

// Expose state to the global window object for the UI to read/write
window.Config = Config;
window.player = player;

// Trigger the UI to populate once the initial config.json is loaded
if (window.syncConfigToUI) window.syncConfigToUI();