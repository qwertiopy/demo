// Team relationship policy. Ownership remains separate and is never used to
// infer hostility, damage eligibility, or friendly fire.

const relations = new Map();

function relationKey(sourceTeam, targetTeam) {
	return `${String(sourceTeam)}\u0000${String(targetTeam)}`;
}

export function resetTeamRelations() {
	relations.clear();
	setTeamRelationship("player", "enemy", "hostile");
	setTeamRelationship("enemy", "player", "hostile");
}

export function setTeamRelationship(sourceTeam, targetTeam, relationship) {
	if (typeof sourceTeam !== "string" || sourceTeam.length === 0) {
		throw new Error("sourceTeam must be a non-empty string.");
	}
	if (typeof targetTeam !== "string" || targetTeam.length === 0) {
		throw new Error("targetTeam must be a non-empty string.");
	}
	if (!["hostile", "friendly", "neutral"].includes(relationship)) {
		throw new Error(`Unknown team relationship: ${relationship}.`);
	}
	relations.set(relationKey(sourceTeam, targetTeam), relationship);
}

export function getTeamRelationship(sourceTeam, targetTeam) {
	if (sourceTeam === targetTeam) return "friendly";
	return relations.get(relationKey(sourceTeam, targetTeam)) ?? "neutral";
}

export function canDamageTeam(sourceTeam, targetTeam) {
	return getTeamRelationship(sourceTeam, targetTeam) === "hostile";
}

export function isDamageableTarget(sourceTeam, target) {
	return Boolean(
		target &&
		target.active !== false &&
		Number(target.hp) > 0 &&
		canDamageTeam(sourceTeam, target.team),
	);
}

resetTeamRelations();
