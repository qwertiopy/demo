// Dynamic broad phase for active actors. The grid is rebuilt at explicit
// simulation boundaries and preserves the source actor order in every query;
// exact shape predicates remain the authoritative narrow phase.

const CELL_SIZE_BLOCKS = 4;
const cells = new Map();
const actorOrder = new Map();
let indexedActors = [];

function cellKey(x, y) {
	return `${x},${y}`;
}

function actorBounds(actor) {
	if (actor?.shape?.type === "circle") {
		const size = Number(actor.size ?? 0) || 0;
		const radius = Math.max(
			0,
			Number(actor.shape.radius ?? size / 2) || 0,
		);
		const centerX = Number(actor.x) +
			(Number(actor.shape.centerX ?? size / 2) || 0);
		const centerY = Number(actor.y) +
			(Number(actor.shape.centerY ?? size / 2) || 0);
		return {
			minX: centerX - radius,
			minY: centerY - radius,
			maxX: centerX + radius,
			maxY: centerY + radius,
		};
	}

	if (actor?.shape?.type === "polygon" && actor.shape.points?.length >= 3) {
		const xs = actor.shape.points.map((point) => Number(actor.x) + Number(point.x));
		const ys = actor.shape.points.map((point) => Number(actor.y) + Number(point.y));
		return {
			minX: Math.min(...xs),
			minY: Math.min(...ys),
			maxX: Math.max(...xs),
			maxY: Math.max(...ys),
		};
	}

	const width = Number(actor?.width ?? actor?.size ?? 0) || 0;
	const height = Number(actor?.height ?? actor?.size ?? 0) || 0;
	return {
		minX: Number(actor?.x) || 0,
		minY: Number(actor?.y) || 0,
		maxX: (Number(actor?.x) || 0) + width,
		maxY: (Number(actor?.y) || 0) + height,
	};
}

function cellRange(minimum, maximum) {
	return [
		Math.floor(minimum / CELL_SIZE_BLOCKS),
		Math.floor(maximum / CELL_SIZE_BLOCKS),
	];
}

export function rebuildActorIndex(actors) {
	cells.clear();
	actorOrder.clear();
	indexedActors = [];

	for (const actor of actors || []) {
		if (!actor || actor.active === false || Number(actor.hp) <= 0) continue;
		actorOrder.set(actor, indexedActors.length);
		indexedActors.push(actor);
		const bounds = actorBounds(actor);
		const [minCellX, maxCellX] = cellRange(bounds.minX, bounds.maxX);
		const [minCellY, maxCellY] = cellRange(bounds.minY, bounds.maxY);
		for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
			for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
				const key = cellKey(cellX, cellY);
				let bucket = cells.get(key);
				if (!bucket) cells.set(key, bucket = []);
				bucket.push(actor);
			}
		}
	}
	return indexedActors.length;
}

export function queryActorsInAabb(minX, minY, maxX, maxY) {
	const lowX = Math.min(Number(minX) || 0, Number(maxX) || 0);
	const lowY = Math.min(Number(minY) || 0, Number(maxY) || 0);
	const highX = Math.max(Number(minX) || 0, Number(maxX) || 0);
	const highY = Math.max(Number(minY) || 0, Number(maxY) || 0);
	const [minCellX, maxCellX] = cellRange(lowX, highX);
	const [minCellY, maxCellY] = cellRange(lowY, highY);
	const found = new Set();

	for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
		for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
			for (const actor of cells.get(cellKey(cellX, cellY)) || []) {
				const bounds = actorBounds(actor);
				if (
					bounds.maxX < lowX || bounds.minX > highX ||
					bounds.maxY < lowY || bounds.minY > highY
				) continue;
				found.add(actor);
			}
		}
	}

	return [...found].sort(
		(first, second) => actorOrder.get(first) - actorOrder.get(second),
	);
}

export function getIndexedActors() {
	return indexedActors.slice();
}

export function clearActorIndex() {
	cells.clear();
	actorOrder.clear();
	indexedActors = [];
}

export { actorBounds as getActorBounds };
