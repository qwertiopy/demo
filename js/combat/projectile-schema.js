// Global projectile inheritance and nested modifier normalization.

const ROOT_FIELDS = [
	"speed",
	"radiusBlocks",
	"color",
	"damage",
	"maxBounces",
	"lifetimeMs",
	"cooldownMs",
	"penetrationBlocks",
	"bulletCollision",
	"chain",
];

const MODIFIER_FIELDS = {
	variation: ["enabled", "speed", "radius", "damage", "rng"],
	volley: ["enabled", "count", "spread"],
	explosion: [
		"enabled",
		"radiusBlocks",
		"detonationTimeMs",
		"durationMs",
		"damage",
		"onImpact",
	],
	throwable: ["enabled", "distanceMultiplier", "deceleration"],
	laser: ["enabled", "warmupMs"],
	split: ["enabled", "count", "timeMs", "onImpact", "spread", "children"],
};

const CHAIN_FIELDS = ["enabled", "maxTargets", "maximumRangeBlocks"];

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

export function mergeProjectileDefinition(base, override = {}) {
	if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);
	const result = clone(base);

	for (const [key, value] of Object.entries(override)) {
		if (isPlainObject(value) && isPlainObject(result[key])) {
			result[key] = mergeProjectileDefinition(result[key], value);
		} else {
			result[key] = clone(value);
		}
	}
	return result;
}

function requireFinite(path, value, minimum = 0) {
	if (!Number.isFinite(Number(value)) || Number(value) < minimum) {
		throw new Error(`${path} must be a finite number >= ${minimum}.`);
	}
}

// Chain is now a nested modifier, but numeric values remain accepted so saved
// configs and weapon overrides from earlier schemas continue to resolve. A
// maximumRangeBlocks value of 0 means unlimited range.
function normalizeChainModifier(value) {
	if (!isPlainObject(value)) {
		const maxTargets = Math.max(0, Math.floor(Number(value) || 0));
		return {
			enabled: maxTargets > 0,
			maxTargets,
			maximumRangeBlocks: 0,
		};
	}

	const maxTargets = Math.max(0, Math.floor(Number(value.maxTargets) || 0));
	const maximumRangeBlocks = Math.max(
		0,
		Number(value.maximumRangeBlocks) || 0,
	);
	return {
		enabled: value.enabled !== false && maxTargets > 0,
		maxTargets,
		maximumRangeBlocks,
	};
}

export function validateBaseProjectile(base, path = "BASE_PROJECTILE") {
	if (!isPlainObject(base)) throw new Error(`${path} must be a JSON object.`);

	for (const field of ROOT_FIELDS) {
		if (!(field in base)) throw new Error(`${path}.${field} is required.`);
	}
	for (const [modifier, fields] of Object.entries(MODIFIER_FIELDS)) {
		if (!isPlainObject(base[modifier])) {
			throw new Error(`${path}.${modifier} must be a JSON object.`);
		}
		for (const field of fields) {
			if (!(field in base[modifier])) {
				throw new Error(`${path}.${modifier}.${field} is required.`);
			}
		}
		if (typeof base[modifier].enabled !== "boolean") {
			throw new Error(`${path}.${modifier}.enabled must be true or false.`);
		}
	}

	if (isPlainObject(base.chain)) {
		for (const field of CHAIN_FIELDS) {
			if (!(field in base.chain)) {
				throw new Error(`${path}.chain.${field} is required.`);
			}
		}
		if (typeof base.chain.enabled !== "boolean") {
			throw new Error(`${path}.chain.enabled must be true or false.`);
		}
		requireFinite(`${path}.chain.maxTargets`, base.chain.maxTargets);
		requireFinite(
			`${path}.chain.maximumRangeBlocks`,
			base.chain.maximumRangeBlocks,
		);
	} else {
		// Legacy scalar chain values are still valid during migration.
		requireFinite(`${path}.chain`, base.chain);
	}

	for (const field of [
		"speed", "radiusBlocks", "damage", "maxBounces", "lifetimeMs",
		"cooldownMs", "penetrationBlocks",
	]) requireFinite(`${path}.${field}`, base[field]);
	if (typeof base.color !== "string") throw new Error(`${path}.color must be a string.`);
	if (typeof base.bulletCollision !== "boolean") {
		throw new Error(`${path}.bulletCollision must be true or false.`);
	}
	if (!Array.isArray(base.split.children)) {
		throw new Error(`${path}.split.children must be an array.`);
	}
	if (!isPlainObject(base.variation.rng)) {
		throw new Error(`${path}.variation.rng must be a JSON object.`);
	}
	requireFinite(`${path}.variation.rng.luck`, base.variation.rng.luck);
	requireFinite(
		`${path}.variation.rng.maximumLuck`,
		base.variation.rng.maximumLuck,
	);
	if (Number(base.variation.rng.luck) > Number(base.variation.rng.maximumLuck)) {
		throw new Error(
			`${path}.variation.rng.luck must be <= maximumLuck.`,
		);
	}
	return base;
}

export function resolveProjectileDefinition(base, override = {}) {
	if (override?.__resolvedProjectile === true) return override;
	validateBaseProjectile(base);
	const nested = mergeProjectileDefinition(base, override);
	const variation = nested.variation.enabled ? nested.variation : null;
	const variationMaximumLuck = variation
		? Math.max(0, Number(variation.rng.maximumLuck) || 0)
		: 0;
	const variationLuck = variation
		? Math.min(
			variationMaximumLuck,
			Math.max(0, Number(variation.rng.luck) || 0),
		)
		: 0;
	const volley = nested.volley.enabled ? nested.volley : null;
	const explosion = nested.explosion.enabled ? nested.explosion : null;
	const throwable = nested.throwable.enabled ? nested.throwable : null;
	const laser = nested.laser.enabled ? nested.laser : null;
	const split = nested.split.enabled ? nested.split : null;
	const chain = normalizeChainModifier(nested.chain);

	const resolved = {
		...nested,
		chain,
		speedVariation: variation ? variation.speed : 0,
		radiusVariation: variation ? variation.radius : 0,
		damageVariation: variation ? variation.damage : 0,
		variationLuck,
		variationMaximumLuck,
		bulletCount: volley ? Math.max(1, Math.floor(Number(volley.count))) : 1,
		spread: volley ? Math.max(0, Number(volley.spread)) : 0,
		explosionRadiusBlocks: explosion ? Number(explosion.radiusBlocks) : 0,
		detonationTimeMs: explosion ? Number(explosion.detonationTimeMs) : 0,
		explosionDurationMs: explosion ? Number(explosion.durationMs) : 0,
		explosionDamage: explosion ? Number(explosion.damage) : 0,
		detonatesOnImpact: explosion ? explosion.onImpact === true : false,
		throwable: Boolean(throwable),
		throwDistanceMultiplier: throwable ? Number(throwable.distanceMultiplier) : 1,
		throwDeceleration: throwable ? Number(throwable.deceleration) : 0,
		laser: Boolean(laser),
		laserWarmupMs: laser ? Number(laser.warmupMs) : 0,
		splitEnabled: Boolean(split),
		splitCount: split ? Math.max(0, Math.floor(Number(split.count))) : 0,
		splitTimeMs: split ? Math.max(0, Number(split.timeMs)) : 0,
		splitsOnImpact: split ? split.onImpact === true : false,
		splitSpread: split ? Math.min(Math.PI * 2, Math.max(0, Number(split.spread))) : 0,
		splitChildren: split ? split.children : [],
	};
	Object.defineProperty(resolved, "__resolvedProjectile", {
		value: true,
		enumerable: false,
	});
	return resolved;
}

export function getSplitChildDefinition(base, entry) {
	const override = isPlainObject(entry?.projectile) ? entry.projectile : {};
	return resolveProjectileDefinition(base, override);
}
