// Canonical free polyominoes through order five and their structure templates.

const EXPECTED_COUNTS_BY_ORDER = Object.freeze({
    1: 1,
    2: 1,
    3: 2,
    4: 5,
    5: 12,
});

const COLOR_BY_ORDER = Object.freeze({
    1: "sienna",
    2: "peru",
    3: "darkolivegreen",
    4: "teal",
    5: "steelblue",
});

export const FREE_POLYOMINO_DEFINITIONS = Object.freeze([
    { order: 1, name: "monomino", pattern: ["#"] },
    { order: 2, name: "domino", pattern: ["##"] },
    { order: 3, name: "tromino-i", pattern: ["###"] },
    { order: 3, name: "tromino-l", pattern: ["#.", "##"] },
    { order: 4, name: "tetromino-i", pattern: ["####"] },
    { order: 4, name: "tetromino-o", pattern: ["##", "##"] },
    { order: 4, name: "tetromino-t", pattern: ["###", ".#."] },
    { order: 4, name: "tetromino-l", pattern: ["#.", "#.", "##"] },
    { order: 4, name: "tetromino-s", pattern: [".##", "##."] },
    { order: 5, name: "pentomino-f", pattern: [".##", "##.", ".#."] },
    { order: 5, name: "pentomino-i", pattern: ["#####"] },
    { order: 5, name: "pentomino-l", pattern: ["#.", "#.", "#.", "##"] },
    { order: 5, name: "pentomino-p", pattern: ["##", "##", "#."] },
    { order: 5, name: "pentomino-n", pattern: ["##..", ".###"] },
    { order: 5, name: "pentomino-t", pattern: ["###", ".#.", ".#."] },
    { order: 5, name: "pentomino-u", pattern: ["#.#", "###"] },
    { order: 5, name: "pentomino-v", pattern: ["#..", "#..", "###"] },
    { order: 5, name: "pentomino-w", pattern: ["#..", "##.", ".##"] },
    { order: 5, name: "pentomino-x", pattern: [".#.", "###", ".#."] },
    { order: 5, name: "pentomino-y", pattern: ["####", ".#.."] },
    { order: 5, name: "pentomino-z", pattern: ["##.", ".#.", ".##"] },
]);

function cellKey(cell) {
    return `${cell.x},${cell.y}`;
}

function parsePattern(pattern) {
    const cells = [];

    for (let y = 0; y < pattern.length; y++) {
        const row = pattern[y];
        for (let x = 0; x < row.length; x++) {
            if (row[x] === "#") cells.push({ x, y });
        }
    }

    return cells;
}

function normalizeCells(cells) {
    const minX = Math.min(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    return cells.map((cell) => ({
        x: cell.x - minX,
        y: cell.y - minY,
    }));
}

function getBounds(cells) {
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    const maxY = Math.max(...cells.map((cell) => cell.y));

    return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area: (maxX - minX + 1) * (maxY - minY + 1),
    };
}

function normalizedSignature(cells) {
    return normalizeCells(cells)
        .map(cellKey)
        .sort()
        .join(";");
}

export function freePolyominoSignature(cells) {
    const transforms = [
        (x, y) => ({ x, y }),
        (x, y) => ({ x: -x, y }),
        (x, y) => ({ x, y: -y }),
        (x, y) => ({ x: -x, y: -y }),
        (x, y) => ({ x: y, y: x }),
        (x, y) => ({ x: -y, y: x }),
        (x, y) => ({ x: y, y: -x }),
        (x, y) => ({ x: -y, y: -x }),
    ];

    return transforms
        .map((transform) =>
            normalizedSignature(cells.map((cell) => transform(cell.x, cell.y))),
        )
        .sort()[0];
}

function isOrthogonallyConnected(cells) {
    if (cells.length === 0) return false;

    const occupied = new Set(cells.map(cellKey));
    const visited = new Set([cellKey(cells[0])]);
    const pending = [cells[0]];
    const directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];

    while (pending.length > 0) {
        const cell = pending.pop();
        for (const [dx, dy] of directions) {
            const next = { x: cell.x + dx, y: cell.y + dy };
            const key = cellKey(next);
            if (!occupied.has(key) || visited.has(key)) continue;
            visited.add(key);
            pending.push(next);
        }
    }

    return visited.size === cells.length;
}

export function validateFreePolyominoDefinitions(
    definitions = FREE_POLYOMINO_DEFINITIONS,
) {
    const countsByOrder = {};
    const signatures = new Set();

    for (const definition of definitions) {
        const cells = parsePattern(definition.pattern);
        if (cells.length !== definition.order) {
            throw new Error(
                `${definition.name} declares order ${definition.order} but contains ${cells.length} cells.`,
            );
        }
        if (!isOrthogonallyConnected(cells)) {
            throw new Error(`${definition.name} is not orthogonally connected.`);
        }

        const signature = freePolyominoSignature(cells);
        if (signatures.has(signature)) {
            throw new Error(`${definition.name} duplicates another free polyomino.`);
        }
        signatures.add(signature);
        countsByOrder[definition.order] = (countsByOrder[definition.order] || 0) + 1;
    }

    for (const [order, expectedCount] of Object.entries(EXPECTED_COUNTS_BY_ORDER)) {
        if ((countsByOrder[order] || 0) !== expectedCount) {
            throw new Error(
                `Expected ${expectedCount} free polyominoes of order ${order}, found ${countsByOrder[order] || 0}.`,
            );
        }
    }

    return true;
}

export function findMinimumAreaSpawn(cells) {
    const occupied = new Set(cells.map(cellKey));
    const candidates = new Map();
    const directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];

    for (const cell of cells) {
        for (const [dx, dy] of directions) {
            const candidate = { x: cell.x + dx, y: cell.y + dy };
            const key = cellKey(candidate);
            if (!occupied.has(key)) candidates.set(key, candidate);
        }
    }

    const originalBounds = getBounds(cells);
    const centerY = (originalBounds.minY + originalBounds.maxY) / 2;
    return Array.from(candidates.values()).sort((first, second) => {
        const firstArea = getBounds([...cells, first]).area;
        const secondArea = getBounds([...cells, second]).area;

        return (
            firstArea - secondArea ||
            second.x - first.x ||
            Math.abs(first.y - centerY) - Math.abs(second.y - centerY) ||
            first.y - second.y ||
            first.x - second.x
        );
    })[0];
}

function buildStructure(definition) {
    const wallCells = parsePattern(definition.pattern);
    const spawnCell = findMinimumAreaSpawn(wallCells);
    const allCells = normalizeCells([...wallCells, spawnCell]);
    const normalizedWalls = allCells.slice(0, wallCells.length);
    const normalizedSpawn = allCells.at(-1);
    const bounds = getBounds(allCells);
    const grid = Array.from({ length: bounds.height }, () =>
        Array(bounds.width).fill(0),
    );

    for (const cell of normalizedWalls) grid[cell.y][cell.x] = 1;
    grid[normalizedSpawn.y][normalizedSpawn.x] = 2;

    return {
        type: `polyomino-${definition.order}-${definition.name}`,
        widthBlocks: bounds.width,
        heightBlocks: bounds.height,
        color: COLOR_BY_ORDER[definition.order],
        grid,
    };
}

export function buildPolyominoStructures() {
    validateFreePolyominoDefinitions();
    return FREE_POLYOMINO_DEFINITIONS.map(buildStructure);
}
