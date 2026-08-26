// Per-owner-ID FIFO projectile capacity, shared by physical bullets and hitscan lasers.

import { getCombatDefault } from "./defaults.js";

const queuesByOwnerId = new Map();

function requireOwnerId(ownerId) {
	if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
		throw new Error(`Projectile ownerId must be a positive integer; received ${ownerId}.`);
	}
	return ownerId;
}

export function clampProjectileCount(value, label = "projectile count") {
	const fallback = getCombatDefault("DEFAULT_MAXIMUM_PROJECTILE_COUNT");
	const safeguard = getCombatDefault("MAXIMUM_PROJECTILE_COUNT_SAFEGUARD");
	const numeric = Number(value);
	const requested = Number.isFinite(numeric)
		? Math.max(0, Math.floor(numeric))
		: fallback;
	if (requested > safeguard) {
		console.warn(`${label} ${requested} exceeds safeguard ${safeguard}; clamped.`);
	}
	return Math.min(requested, safeguard);
}

function queueFor(ownerId, maximumProjectileCount) {
	requireOwnerId(ownerId);
	let queue = queuesByOwnerId.get(ownerId);
	if (!queue) {
		queue = {
			ownerId,
			entries: [],
			activeCount: 0,
			maximumProjectileCount: clampProjectileCount(
				maximumProjectileCount,
				`Entity ${ownerId} projectile count`,
			),
		};
		queuesByOwnerId.set(ownerId, queue);
	} else if (maximumProjectileCount !== undefined) {
		queue.maximumProjectileCount = clampProjectileCount(
			maximumProjectileCount,
			`Entity ${ownerId} projectile count`,
		);
	}
	return queue;
}

function evict(entry) {
	if (!entry.active) return;
	entry.active = false;
	entry.queue.activeCount--;
	if (entry.projectile) entry.projectile.removedByProjectileCap = true;
}

function trimQueue(queue) {
	while (queue.entries.length > 0 && !queue.entries[0].active) {
		queue.entries.shift();
	}
	if (queue.activeCount <= 0) {
		queuesByOwnerId.delete(queue.ownerId);
	}
}

export function registerProjectile(
	ownerId,
	projectile = null,
	maximumProjectileCount = undefined,
) {
	const queue = queueFor(ownerId, maximumProjectileCount);
	const entry = { ownerId, projectile, active: true, queue };
	queue.entries.push(entry);
	queue.activeCount++;

	while (queue.activeCount > queue.maximumProjectileCount) {
		const oldest = queue.entries.find((candidate) => candidate.active);
		if (!oldest) break;
		evict(oldest);
	}

	trimQueue(queue);
	return entry;
}

export function releaseProjectileEntry(entry) {
	if (!entry?.active) return;
	entry.active = false;
	entry.queue.activeCount--;
	trimQueue(entry.queue);
}

export function releaseProjectile(projectile) {
	releaseProjectileEntry(projectile?.projectileCapEntry);
}

export function reserveLogicalProjectiles(
	ownerId,
	count,
	maximumProjectileCount = undefined,
) {
	const entries = [];
	for (let index = 0; index < count; index++) {
		entries.push(
			registerProjectile(ownerId, null, maximumProjectileCount),
		);
	}
	return entries;
}

export function releaseLogicalProjectiles(entries) {
	for (const entry of entries) releaseProjectileEntry(entry);
}

export function resetProjectileCaps() {
	queuesByOwnerId.clear();
}
