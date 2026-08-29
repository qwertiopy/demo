// Projectile public API. Implementation is split by responsibility under
// js/combat/projectiles/ so existing imports do not need to change.

export {
	fireSplitChildren,
	getBulletMaxStepBlocks,
	getPenetratedCollisionRect,
	processProjectiles,
	registerSplitLaserFirer,
	resolveProjectileVectorCollisions,
	shoot,
	updateProjectileChainAim,
} from "./projectiles/index.js";
