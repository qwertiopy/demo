export const PROJECTILE_EFFECT_ORDER = Object.freeze([
	"bounce",
	"chain",
	"explosion",
	"split",
	"terminal-impact",
]);

// Executes only supplied stages, always in the canonical order. Collision code
// owns the physics at each stage; this helper prevents future feature additions
// from silently reordering simultaneous projectile effects.
export function runProjectileEffectOrder(stages = {}) {
	const results = {};
	for (const stage of PROJECTILE_EFFECT_ORDER) {
		const callback = stages[stage];
		if (typeof callback === "function") results[stage] = callback();
	}
	return results;
}
