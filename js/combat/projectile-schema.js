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

const ROOT_FIELD_SET = new Set([...ROOT_FIELDS, ...Object.keys(MODIFIER_FIELDS)]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

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
		if (FORBIDDEN_KEYS.has(key)) {
			throw new Error(`Unsafe projectile field ${key} is not allowed.`);
		}
		if (isPlainObject(value) && isPlainObject(result[key])) {
			result[key] = mergeProjectileDefinition(result[key], value);
		} else {
			result[key] = clone(value);
		}
	}
	return result;
}

function rejectUnknownKeys(value, allowed, path) {
	for (const key of Object.keys(value || {})) {
		if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
			throw new Error(`${path}.${key} is not a recognised field.`);
		}
	}
}

export function validateProjectileOverride(override, path = "projectile") {
	if (!isPlainObject(override)) throw new Error(`${path} must be a JSON object.`);
	rejectUnknownKeys(override, ROOT_FIELD_SET, path);

	for (const [modifier, fields] of Object.entries(MODIFIER_FIELDS)) {
		if (!(modifier in override)) continue;
		if (!isPlainObject(override[modifier])) {
			throw new Error(`${path}.${modifier} must be a JSON object.`);
		}
		rejectUnknownKeys(
			override[modifier],
			new Set(fields),
			`${path}.${modifier}`,
		);
	}

	if (isPlainObject(override.variation?.rng)) {
		rejectUnknownKeys(
			override.variation.rng,
			new Set(["luck", "maximumLuck"]),
			`${path}.variation.rng`,
		);
	}

	if (override.split?.children !== undefined) {
		if (!Array.isArray(override.split.children)) {
			throw new Error(`${path}.split.children must be an array.`);
		}
		for (const [index, entry] of override.split.children.entries()) {
			if (!isPlainObject(entry)) {
				throw new Error(`${path}.split.children[${index}] must be an object.`);
			}
			rejectUnknownKeys(
				entry,
				new Set(["weight", "projectile"]),
				`${path}.split.children[${index}]`,
			);
			requireFinite(`${path}.split.children[${index}].weight`, entry.weight ?? 0);
			validateProjectileOverride(
				isPlainObject(entry.projectile) ? entry.projectile : {},
				`${path}.split.children[${index}].projectile`,
			);
		}
	}
	return override;
}

function validateResolvedProjectile(resolved, path) {
	for (const field of [
		"speed", "radiusBlocks", "damage", "maxBounces", "lifetimeMs",
		"cooldownMs", "penetrationBlocks", "chain", "speedVariation",
		"radiusVariation", "damageVariation", "variationLuck",
		"variationMaximumLuck", "bulletCount", "spread",
		"explosionRadiusBlocks", "detonationTimeMs", "explosionDurationMs",
		"explosionDamage", "throwDistanceMultiplier", "throwDeceleration",
		"laserWarmupMs", "splitCount", "splitTimeMs", "splitSpread",
	]) {
		requireFinite(`${path}.${field}`, resolved[field]);
	}
	if (!Number.isInteger(resolved.maxBounces) || !Number.isInteger(resolved.chain)) {
		throw new Error(`${path}.maxBounces and chain must be integers.`);
	}
	if (!Number.isInteger(resolved.bulletCount) || !Number.isInteger(resolved.splitCount)) {
		throw new Error(`${path} volley/split counts must resolve to integers.`);
	}
	return resolved;
}

function requireFinite(path, value, minimum = 0) {
	if (!Number.isFinite(Number(value)) || Number(value) < minimum) {
		throw new Error(`${path} must be a finite number >= ${minimum}.`);
	}
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

	for (const field of [
		"speed", "radiusBlocks", "damage", "maxBounces", "lifetimeMs",
		"cooldownMs", "penetrationBlocks", "chain",
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
	validateProjectileOverride(override);
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

	const resolved = {
		...nested,
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
		splitChildren: split
			? split.children.map((entry) => ({
				weight: Number(entry?.weight ?? 0),
				projectile: resolveProjectileDefinition(
					base,
					isPlainObject(entry?.projectile) ? entry.projectile : {},
				),
			}))
			: [],
	};
	Object.defineProperty(resolved, "__resolvedProjectile", {
		value: true,
		enumerable: false,
	});
	validateResolvedProjectile(resolved, "projectile");
	return resolved;
}

export function getSplitChildDefinition(base, entry) {
	if (entry?.projectile?.__resolvedProjectile === true) {
		return entry.projectile;
	}
	const override = isPlainObject(entry?.projectile) ? entry.projectile : {};
	return resolveProjectileDefinition(base, override);
}

// Shot-local values such as a legal aiming interval and an enemy's selected
// spread may vary without recompiling the immutable weapon data tree.
export function deriveResolvedProjectileDefinition(resolved, overrides = {}) {
	if (resolved?.__resolvedProjectile !== true) {
		throw new Error("A resolved projectile definition is required.");
	}
	const derived = { ...resolved, ...overrides };
	Object.defineProperty(derived, "__resolvedProjectile", {
		value: true,
		enumerable: false,
	});
	return validateResolvedProjectile(derived, "projectile");
}
