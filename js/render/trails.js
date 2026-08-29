// Swept/ribbon trail geometry and rendering.

import { ctx } from "../dom.js";

const trailColorCache = new Map();

function clamp01(value) {
	return Math.min(1, Math.max(0, Number(value) || 0));
}

// Canvas accepts named colors, hex, rgb(), etc. Resolve each distinct trail
// color once, then cache the numeric RGBA components so swept gradients can
// vary opacity without repeatedly asking the browser to parse CSS colors.
function resolvedTrailColor(color) {
	const key = String(color ?? "white");
	const cached = trailColorCache.get(key);
	if (cached) return cached;

	ctx.save();
	ctx.fillStyle = "#ffffff";
	ctx.fillStyle = key;
	const normalized = String(ctx.fillStyle);
	ctx.restore();

	let result = [255, 255, 255, 1];
	let match = normalized.match(/^#([0-9a-f]{6})$/i);
	if (match) {
		const hex = match[1];
		result = [
			parseInt(hex.slice(0, 2), 16),
			parseInt(hex.slice(2, 4), 16),
			parseInt(hex.slice(4, 6), 16),
			1,
		];
	} else {
		match = normalized.match(
			/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
		);
		if (match) {
			result = [
				Number(match[1]),
				Number(match[2]),
				Number(match[3]),
				match[4] === undefined ? 1 : clamp01(match[4]),
			];
		}
	}

	trailColorCache.set(key, result);
	return result;
}

function trailColorAtAlpha(color, alpha) {
	const [r, g, b, baseAlpha] = resolvedTrailColor(color);
	return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha) * baseAlpha})`;
}

function sweptGradient(
	x1,
	y1,
	x2,
	y2,
	color1,
	color2,
	alpha1,
	alpha2,
) {
	if (Math.hypot(x2 - x1, y2 - y1) < 1e-9) {
		return trailColorAtAlpha(color2 ?? color1, (alpha1 + alpha2) / 2);
	}

	const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
	gradient.addColorStop(0, trailColorAtAlpha(color1, alpha1));
	gradient.addColorStop(1, trailColorAtAlpha(color2 ?? color1, alpha2));
	return gradient;
}

function matchingByRenderId(items) {
	const result = new Map();
	for (const item of items || []) {
		if (item?.renderId !== undefined && item?.renderId !== null) {
			result.set(item.renderId, item);
		}
	}
	return result;
}

function normalizeVector(x, y) {
	const length = Math.hypot(x, y);
	if (length < 1e-9) return null;
	return { x: x / length, y: y / length };
}

// Use the direction through the neighbouring samples instead of the direction
// of an individual segment. Adjacent trail quads therefore reuse exactly the
// same cross-section at their shared sample and touch edge-to-edge rather than
// painting overlapping swept shapes at every join.
function ribbonTangent(samples, index) {
	const current = samples[index];
	const previous = index > 0 ? samples[index - 1] : null;
	const next = index + 1 < samples.length ? samples[index + 1] : null;

	if (previous && next) {
		const through = normalizeVector(
			next.cx - previous.cx,
			next.cy - previous.cy,
		);
		if (through) return through;
	}

	if (next) {
		const outgoing = normalizeVector(next.cx - current.cx, next.cy - current.cy);
		if (outgoing) return outgoing;
	}

	if (previous) {
		const incoming = normalizeVector(
			current.cx - previous.cx,
			current.cy - previous.cy,
		);
		if (incoming) return incoming;
	}

	return null;
}

function ribbonEdges(samples, index) {
	const sample = samples[index];
	const tangent = ribbonTangent(samples, index);
	if (!tangent) return null;

	// Non-circular renderables can provide exact cross-section geometry. Actors
	// use this to anchor the ribbon to the actual vertices of their axis-aligned
	// square instead of points on an imaginary support-radius circle.
	if (typeof sample.edgesForTangent === "function") {
		return sample.edgesForTangent(tangent);
	}

	const normalX = -tangent.y;
	const normalY = tangent.x;
	const halfWidth = Math.max(0, sample.halfWidth(normalX, normalY));
	if (halfWidth <= 0) return null;

	return {
		left: {
			x: sample.cx + normalX * halfWidth,
			y: sample.cy + normalY * halfWidth,
		},
		right: {
			x: sample.cx - normalX * halfWidth,
			y: sample.cy - normalY * halfWidth,
		},
	};
}

function squareSupportVertexSign(normalComponent, tangentComponent, side) {
	const epsilon = 1e-9;

	// Away from an axis-aligned tie, the support point of a square is exactly a
	// corner: choose the coordinate sign that maximises (+1) or minimises (-1)
	// the dot product with the trail normal.
	if (Math.abs(normalComponent) > epsilon) {
		const supportSign = normalComponent > 0 ? 1 : -1;
		return side > 0 ? supportSign : -supportSign;
	}

	// If the normal component is zero, the whole square edge is a support edge.
	// Pick its trailing vertex so horizontal/vertical motion still produces a
	// cross-section made from two real square corners rather than edge midpoints.
	if (Math.abs(tangentComponent) > epsilon) {
		return tangentComponent > 0 ? -1 : 1;
	}

	return side > 0 ? 1 : -1;
}

function actorRibbonSample(actor, alpha, blockSizePx, frameNumber = null) {
	if (!actor || actor.hp <= 0) return null;

	const sizePx = Math.max(0, Number(actor.size) || 0) * blockSizePx;
	const x = Number(actor.x) * blockSizePx;
	const y = Number(actor.y) * blockSizePx;
	if (!Number.isFinite(x) || !Number.isFinite(y) || sizePx <= 0) return null;

	const halfSize = sizePx / 2;
	const cx = x + halfSize;
	const cy = y + halfSize;

	return {
		renderId: actor.renderId,
		cx,
		cy,
		halfSize,
		color: actor.color,
		alpha,
		frameNumber,
		edgesForTangent: (tangent) => {
			const normalX = -tangent.y;
			const normalY = tangent.x;

			const leftSignX = squareSupportVertexSign(normalX, tangent.x, 1);
			const leftSignY = squareSupportVertexSign(normalY, tangent.y, 1);
			const rightSignX = squareSupportVertexSign(normalX, tangent.x, -1);
			const rightSignY = squareSupportVertexSign(normalY, tangent.y, -1);

			return {
				left: {
					x: cx + leftSignX * halfSize,
					y: cy + leftSignY * halfSize,
				},
				right: {
					x: cx + rightSignX * halfSize,
					y: cy + rightSignY * halfSize,
				},
			};
		},
	};
}

function projectileRibbonSample(projectile, alpha, blockSizePx) {
	if (!projectile) return null;

	const cx = Number(projectile.x) * blockSizePx;
	const cy = Number(projectile.y) * blockSizePx;
	const radius = Math.max(0, Number(projectile.radius) || 0) * blockSizePx;
	if (!Number.isFinite(cx) || !Number.isFinite(cy) || radius <= 0) return null;

	return {
		renderId: projectile.renderId,
		cx,
		cy,
		radius,
		color: projectile.color,
		alpha,
		checkpoint: projectile.checkpoint === true,
		halfWidth: () => radius,
	};
}

function mergeProjectileRibbonSample(previous, next) {
	if (!previous?.checkpoint) return next;
	return next.checkpoint ? next : { ...next, checkpoint: true };
}

// Build contiguous runs for each renderId. If an object disappears between two
// sampled frames, its old and new appearances are not bridged by a trail.
function collectRibbonRuns(trailEntries, getItems, makeSample) {
	const activeRuns = new Map();
	const completedRuns = [];

	for (let entryIndex = 0; entryIndex < trailEntries.length; entryIndex++) {
		const entry = trailEntries[entryIndex];
		const itemsById = matchingByRenderId(getItems(entry.snapshot));
		const seenIds = new Set();

		for (const [renderId, item] of itemsById) {
			const sample = makeSample(item, entry.alpha, entry);
			if (!sample) continue;
			seenIds.add(renderId);

			const active = activeRuns.get(renderId);
			if (active && active.lastEntryIndex === entryIndex - 1) {
				active.samples.push(sample);
				active.lastEntryIndex = entryIndex;
				continue;
			}

			if (active?.samples.length >= 2) {
				completedRuns.push(active.samples);
			}
			activeRuns.set(renderId, {
				lastEntryIndex: entryIndex,
				samples: [sample],
			});
		}

		for (const [renderId, active] of activeRuns) {
			if (seenIds.has(renderId)) continue;
			if (active.lastEntryIndex < entryIndex) {
				if (active.samples.length >= 2) completedRuns.push(active.samples);
				activeRuns.delete(renderId);
			}
		}
	}

	for (const active of activeRuns.values()) {
		if (active.samples.length >= 2) completedRuns.push(active.samples);
	}

	return completedRuns;
}

// Projectile trails can contain multiple ordered samples inside one render frame:
// the frame-start position plus exact wall-impact/reversal/terminal checkpoints.
// Unlike matchingByRenderId(), keep every sample for the same renderId so a
// bounce is drawn through the real contact point and a dying projectile reaches
// its final position even though it is absent from the current entity snapshot.
function collectProjectileRibbonRuns(trailEntries, blockSizePx) {
	const activeRuns = new Map();
	const completedRuns = [];

	for (let entryIndex = 0; entryIndex < trailEntries.length; entryIndex++) {
		const entry = trailEntries[entryIndex];
		const samplesById = new Map();

		const appendItem = (item) => {
			const sample = projectileRibbonSample(item, entry.alpha, blockSizePx);
			if (!sample || sample.renderId === undefined || sample.renderId === null) {
				return;
			}

			let samples = samplesById.get(sample.renderId);
			if (!samples) {
				samples = [];
				samplesById.set(sample.renderId, samples);
			}

			const previous = samples.at(-1);
			if (
				previous &&
				Math.hypot(sample.cx - previous.cx, sample.cy - previous.cy) < 1e-9
			) {
				samples[samples.length - 1] = mergeProjectileRibbonSample(
					previous,
					sample,
				);
			} else {
				samples.push(sample);
			}
		};

		for (const event of entry.snapshot.projectileTrailEvents || []) {
			appendItem(event);
		}
		for (const projectile of entry.snapshot.projectiles || []) {
			appendItem(projectile);
		}

		const seenIds = new Set(samplesById.keys());
		for (const [renderId, frameSamples] of samplesById) {
			const active = activeRuns.get(renderId);

			if (active && active.lastEntryIndex === entryIndex - 1) {
				for (const sample of frameSamples) {
					const previous = active.samples.at(-1);
					if (
						previous &&
						Math.hypot(sample.cx - previous.cx, sample.cy - previous.cy) < 1e-9
					) {
						active.samples[active.samples.length - 1] =
							mergeProjectileRibbonSample(previous, sample);
					} else {
						active.samples.push(sample);
					}
				}
				active.lastEntryIndex = entryIndex;
				continue;
			}

			if (
				active?.samples.length >= 2 ||
				active?.samples.some((sample) => sample.checkpoint)
			) {
				completedRuns.push(active.samples);
			}
			activeRuns.set(renderId, {
				lastEntryIndex: entryIndex,
				samples: [...frameSamples],
			});
		}

		for (const [renderId, active] of activeRuns) {
			if (seenIds.has(renderId)) continue;
			if (active.lastEntryIndex < entryIndex) {
				if (
					active.samples.length >= 2 ||
					active.samples.some((sample) => sample.checkpoint)
				) {
					completedRuns.push(active.samples);
				}
				activeRuns.delete(renderId);
			}
		}
	}

	for (const active of activeRuns.values()) {
		if (
			active.samples.length >= 2 ||
			active.samples.some((sample) => sample.checkpoint)
		) {
			completedRuns.push(active.samples);
		}
	}

	return completedRuns;
}

function appendCheckpointSquarePath(sample) {
	if (!sample?.checkpoint || sample.halfSize <= 0) return false;
	const halfSize = sample.halfSize;
	ctx.moveTo(sample.cx - halfSize, sample.cy - halfSize);
	ctx.lineTo(sample.cx - halfSize, sample.cy + halfSize);
	ctx.lineTo(sample.cx + halfSize, sample.cy + halfSize);
	ctx.lineTo(sample.cx + halfSize, sample.cy - halfSize);
	ctx.closePath();
	return true;
}

function drawCheckpointSquares(samples) {
	for (const sample of samples) {
		if (!sample?.checkpoint || sample.halfSize <= 0) continue;

		ctx.save();
		ctx.globalAlpha = 1;
		ctx.fillStyle = trailColorAtAlpha(sample.color, sample.alpha);
		ctx.beginPath();
		appendCheckpointSquarePath(sample);
		ctx.fill();
		ctx.restore();
	}
}

function markPlayerMovementCheckpoints(samples) {
	if (samples.length === 0) return [];
	const marked = samples.map((sample) => ({ ...sample, checkpoint: false }));

	// Frame zero is the player's initial position. A truncated trail window must
	// not manufacture a new initial checkpoint at its oldest visible sample.
	if (Number(marked[0].frameNumber) === 0) marked[0].checkpoint = true;

	for (let index = 1; index < marked.length - 1; index++) {
		const previous = marked[index - 1];
		const current = marked[index];
		const next = marked[index + 1];
		const incoming = normalizeVector(
			current.cx - previous.cx,
			current.cy - previous.cy,
		);
		const outgoing = normalizeVector(next.cx - current.cx, next.cy - current.cy);

		const changedStationaryState = Boolean(incoming) !== Boolean(outgoing);
		const changedDirection =
			incoming && outgoing && !sameForwardDirection(incoming, outgoing);
		if (changedStationaryState || changedDirection) current.checkpoint = true;
	}

	return marked;
}

function appendCheckpointCirclePath(sample) {
	if (!sample?.checkpoint || sample.radius <= 0) return false;
	ctx.moveTo(sample.cx + sample.radius, sample.cy);
	ctx.arc(sample.cx, sample.cy, sample.radius, 0, -Math.PI * 2, true);
	return true;
}

function drawGradientQuad(
	previous,
	next,
	oldEdges,
	newEdges,
	includeEndpointCheckpointCircles = false,
) {
	ctx.save();
	ctx.globalAlpha = 1;
	ctx.fillStyle = sweptGradient(
		previous.cx,
		previous.cy,
		next.cx,
		next.cy,
		previous.color,
		next.color,
		previous.alpha,
		next.alpha,
	);

	ctx.beginPath();
	ctx.moveTo(oldEdges.left.x, oldEdges.left.y);
	ctx.lineTo(newEdges.left.x, newEdges.left.y);
	ctx.lineTo(newEdges.right.x, newEdges.right.y);
	ctx.lineTo(oldEdges.right.x, oldEdges.right.y);
	ctx.closePath();
	if (includeEndpointCheckpointCircles) {
		appendCheckpointCirclePath(previous);
		if (next !== previous) appendCheckpointCirclePath(next);
	}
	ctx.fill();
	ctx.restore();
}

function drawCheckpointCircles(samples) {
	for (const sample of samples) {
		if (!sample?.checkpoint || sample.radius <= 0) continue;

		ctx.save();
		ctx.globalAlpha = 1;
		ctx.fillStyle = trailColorAtAlpha(sample.color, sample.alpha);
		ctx.beginPath();
		appendCheckpointCirclePath(sample);
		ctx.fill();
		ctx.restore();
	}
}

// One trajectory is a ribbon made from edge-sharing quads. Every sample's
// left/right cross-section is calculated once and reused by the quad before it
// and the quad after it. For projectile ribbons, each quad can append endpoint
// checkpoint circles into the same fill, so a leg and its checkpoint share one
// alpha application while adjacent legs can still blend normally with each
// other when they pass through the same checkpoint again.
function drawRibbonRun(samples, { drawProjectileCheckpoints = false } = {}) {
	if (samples.length < 2) {
		if (drawProjectileCheckpoints) drawCheckpointCircles(samples);
		return;
	}
	const edges = samples.map((_, index) => ribbonEdges(samples, index));

	for (let index = 0; index < samples.length - 1; index++) {
		const previous = samples[index];
		const next = samples[index + 1];
		const oldEdges = edges[index];
		const newEdges = edges[index + 1];
		if (!oldEdges || !newEdges) continue;
		if (Math.hypot(next.cx - previous.cx, next.cy - previous.cy) < 1e-9) {
			continue;
		}

		drawGradientQuad(
			previous,
			next,
			oldEdges,
			newEdges,
			drawProjectileCheckpoints,
		);
	}

	if (drawProjectileCheckpoints) {
		drawCheckpointCircles(samples);
	}
}

// Straight projectile legs can be collapsed into one ribbon strip regardless
// of how many trail samples they contain. Bounces and boomerang reversals are
// discrete corners, so they are split into separate straight legs and stay on
// this fast path. Quads are reserved for projectiles whose direction changes
// on consecutive sampled movements (continuous/per-frame turning).
function straightTrailDirection(samples) {
	let direction = null;

	for (let index = 0; index < samples.length - 1; index++) {
		const current = samples[index];
		const next = samples[index + 1];
		const segment = normalizeVector(next.cx - current.cx, next.cy - current.cy);
		if (!segment) continue;

		if (!direction) {
			direction = segment;
			continue;
		}

		const cross = direction.x * segment.y - direction.y * segment.x;
		const dot = direction.x * segment.x + direction.y * segment.y;
		if (Math.abs(cross) > 1e-5 || dot <= 0.99999) return null;
	}

	return direction;
}

function sameForwardDirection(a, b) {
	const cross = a.x * b.y - a.y * b.x;
	const dot = a.x * b.x + a.y * b.y;
	return Math.abs(cross) <= 1e-5 && dot > 0.99999;
}

// A bounce/reversal creates one isolated direction change and then continues
// straight. A continuously curving/homing projectile changes direction again
// on the very next movement; only that case needs the quad renderer.
function projectileTurnsOnConsecutiveMovements(samples) {
	let previousDirection = null;
	let previousMovementTurned = false;

	for (let index = 0; index < samples.length - 1; index++) {
		const current = samples[index];
		const next = samples[index + 1];
		const direction = normalizeVector(next.cx - current.cx, next.cy - current.cy);
		if (!direction) continue;

		if (!previousDirection) {
			previousDirection = direction;
			continue;
		}

		const turned = !sameForwardDirection(previousDirection, direction);
		if (turned && previousMovementTurned) return true;

		previousMovementTurned = turned;
		previousDirection = direction;
	}

	return false;
}

// Split a piecewise-straight path at each discrete corner or explicit
// checkpoint. The shared checkpoint sample belongs to both adjacent legs, so
// each leg can paint its own endpoint silhouette with that leg's alpha while
// the two legs still blend normally with each other.
function splitStraightTrailLegs(samples) {
	const legs = [];
	let leg = [];
	let legDirection = null;

	for (let index = 0; index < samples.length - 1; index++) {
		const current = samples[index];
		const next = samples[index + 1];
		const direction = normalizeVector(next.cx - current.cx, next.cy - current.cy);

		if (!direction) {
			if (leg.length === 0) leg.push(current);
			leg.push(next);
			if (next?.checkpoint && index < samples.length - 2) {
				if (leg.length >= 2) legs.push(leg);
				leg = [next];
				legDirection = null;
			}
			continue;
		}

		if (!legDirection) {
			if (leg.length === 0) leg.push(current);
			else if (leg.at(-1) !== current) leg.push(current);
			leg.push(next);
			legDirection = direction;
			if (next?.checkpoint && index < samples.length - 2) {
				if (leg.length >= 2) legs.push(leg);
				leg = [next];
				legDirection = null;
			}
			continue;
		}

		if (sameForwardDirection(legDirection, direction)) {
			leg.push(next);
			if (next?.checkpoint && index < samples.length - 2) {
				if (leg.length >= 2) legs.push(leg);
				leg = [next];
				legDirection = null;
			}
			continue;
		}

		if (leg.length >= 2) legs.push(leg);
		leg = [current, next];
		legDirection = direction;
		if (next?.checkpoint && index < samples.length - 2) {
			if (leg.length >= 2) legs.push(leg);
			leg = [next];
			legDirection = null;
		}
	}

	if (leg.length >= 2) legs.push(leg);
	return legs;
}

function straightTrailGradient(samples, firstIndex, lastIndex) {
	const first = samples[firstIndex];
	const last = samples[lastIndex];
	const totalDistance = Math.hypot(last.cx - first.cx, last.cy - first.cy);
	if (totalDistance < 1e-9) {
		return trailColorAtAlpha(last.color ?? first.color, last.alpha);
	}

	const gradient = ctx.createLinearGradient(first.cx, first.cy, last.cx, last.cy);
	const stops = [];

	for (let index = firstIndex; index <= lastIndex; index++) {
		const sample = samples[index];
		const distance = Math.hypot(sample.cx - first.cx, sample.cy - first.cy);
		const offset = clamp01(distance / totalDistance);
		const color = trailColorAtAlpha(sample.color, sample.alpha);

		// Multiple source frames can occupy the exact same position. Keep the
		// newest value at that position instead of creating overlapping paint.
		if (stops.length > 0 && Math.abs(stops.at(-1).offset - offset) < 1e-9) {
			stops[stops.length - 1] = { offset, color };
		} else {
			stops.push({ offset, color });
		}
	}

	if (stops[0]?.offset > 0) {
		stops.unshift({
			offset: 0,
			color: trailColorAtAlpha(first.color, first.alpha),
		});
	}
	if (stops.at(-1)?.offset < 1) {
		stops.push({
			offset: 1,
			color: trailColorAtAlpha(last.color, last.alpha),
		});
	}

	for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
	return gradient;
}

function drawStraightPlayerRun(samples, paintedCheckpoints) {
	if (samples.length < 2 || !straightTrailDirection(samples)) return false;

	let firstIndex = 0;
	let lastIndex = samples.length - 1;
	while (
		firstIndex < lastIndex &&
		Math.hypot(
			samples[firstIndex + 1].cx - samples[firstIndex].cx,
			samples[firstIndex + 1].cy - samples[firstIndex].cy,
		) < 1e-9
	) {
		firstIndex += 1;
	}
	while (
		lastIndex > firstIndex &&
		Math.hypot(
			samples[lastIndex].cx - samples[lastIndex - 1].cx,
			samples[lastIndex].cy - samples[lastIndex - 1].cy,
		) < 1e-9
	) {
		lastIndex -= 1;
	}
	if (lastIndex <= firstIndex) return false;

	const trimmed = samples.slice(firstIndex, lastIndex + 1);
	const firstEdges = ribbonEdges(trimmed, 0);
	const lastEdges = ribbonEdges(trimmed, trimmed.length - 1);
	if (!firstEdges || !lastEdges) return false;

	ctx.save();
	ctx.globalAlpha = 1;
	ctx.fillStyle = straightTrailGradient(samples, firstIndex, lastIndex);
	ctx.beginPath();
	ctx.moveTo(firstEdges.left.x, firstEdges.left.y);
	ctx.lineTo(lastEdges.left.x, lastEdges.left.y);
	ctx.lineTo(lastEdges.right.x, lastEdges.right.y);
	ctx.lineTo(firstEdges.right.x, firstEdges.right.y);
	ctx.closePath();

	const first = samples[firstIndex];
	const last = samples[lastIndex];
	if (appendCheckpointSquarePath(first)) paintedCheckpoints.add(first);
	if (last !== first && appendCheckpointSquarePath(last)) paintedCheckpoints.add(last);
	ctx.fill();
	ctx.restore();
	return true;
}

function drawPiecewiseStraightPlayerRun(samples) {
	const marked = markPlayerMovementCheckpoints(samples);
	if (marked.length === 0) return false;

	const legs = splitStraightTrailLegs(marked);
	const paintedCheckpoints = new Set();
	let drewAny = false;
	for (const leg of legs) {
		if (drawStraightPlayerRun(leg, paintedCheckpoints)) drewAny = true;
	}

	const unpaintedCheckpoints = marked.filter(
		(sample) => sample.checkpoint && !paintedCheckpoints.has(sample),
	);
	if (unpaintedCheckpoints.length > 0) {
		drawCheckpointSquares(unpaintedCheckpoints);
		drewAny = true;
	}
	return drewAny;
}

function drawStraightProjectileRun(samples) {
	if (samples.length < 2 || !straightTrailDirection(samples)) return false;

	let firstIndex = 0;
	let lastIndex = samples.length - 1;
	while (
		firstIndex < lastIndex &&
		Math.hypot(
			samples[firstIndex + 1].cx - samples[firstIndex].cx,
			samples[firstIndex + 1].cy - samples[firstIndex].cy,
		) < 1e-9
	) {
		firstIndex += 1;
	}
	while (
		lastIndex > firstIndex &&
		Math.hypot(
			samples[lastIndex].cx - samples[lastIndex - 1].cx,
			samples[lastIndex].cy - samples[lastIndex - 1].cy,
		) < 1e-9
	) {
		lastIndex -= 1;
	}
	if (lastIndex <= firstIndex) return false;

	const trimmed = samples.slice(firstIndex, lastIndex + 1);
	const firstEdges = ribbonEdges(trimmed, 0);
	const lastEdges = ribbonEdges(trimmed, trimmed.length - 1);
	if (!firstEdges || !lastEdges) return false;

	ctx.save();
	ctx.globalAlpha = 1;
	ctx.fillStyle = straightTrailGradient(
		samples,
		firstIndex,
		lastIndex,
	);

	ctx.beginPath();
	ctx.moveTo(firstEdges.left.x, firstEdges.left.y);
	ctx.lineTo(lastEdges.left.x, lastEdges.left.y);
	ctx.lineTo(lastEdges.right.x, lastEdges.right.y);
	ctx.lineTo(firstEdges.right.x, firstEdges.right.y);
	ctx.closePath();
	appendCheckpointCirclePath(samples[firstIndex]);
	if (lastIndex !== firstIndex) appendCheckpointCirclePath(samples[lastIndex]);
	ctx.fill();
	ctx.restore();
	return true;
}

function drawPiecewiseStraightProjectileRun(samples) {
	if (samples.length < 2 || projectileTurnsOnConsecutiveMovements(samples)) {
		return false;
	}

	const legs = splitStraightTrailLegs(samples);
	let drewAny = false;

	for (const leg of legs) {
		if (drawStraightProjectileRun(leg)) drewAny = true;
	}

	const hasCheckpoint = samples.some(
		(sample) => sample?.checkpoint && sample.radius > 0,
	);
	if (!drewAny && hasCheckpoint) drawCheckpointCircles(samples);
	return drewAny || hasCheckpoint;
}

function drawTrailRibbons(trailEntries, rendering, excludedProjectileIds = null) {
	if (trailEntries.length < 2) return;
	const blockSizePx = rendering.BLOCK_SIZE_PX;

	const enemyRuns = collectRibbonRuns(
		trailEntries,
		(snapshot) => snapshot.enemies || [],
		(actor, alpha) => actorRibbonSample(actor, alpha, blockSizePx),
	);
	const projectileRuns = collectProjectileRibbonRuns(
		trailEntries,
		blockSizePx,
	);

	for (const run of enemyRuns) drawRibbonRun(run);
	for (const run of projectileRuns) {
		if (excludedProjectileIds?.has(run[0]?.renderId)) continue;
		drawRibbonRun(run, { drawProjectileCheckpoints: true });
	}
}

// TRAIL_DETAIL feeds piecewise-straight projectile legs. Player movement uses
// full source-frame history but collapses keyboard-driven motion into straight
// legs with square checkpoints at starts, stops, and turns. TRAIL_QUAD_DETAIL
// remains for enemy ribbons and projectiles that continuously turn.
export function drawTrailsHybrid(
	trailEntries,
	quadTrailEntries,
	rendering,
	playerTrailEntries = trailEntries,
) {
	const blockSizePx = rendering.BLOCK_SIZE_PX;
	const straightProjectileIds = new Set();
	let projectileRuns = [];
	let playerRuns = [];

	if (playerTrailEntries.length >= 2) {
		playerRuns = collectRibbonRuns(
			playerTrailEntries,
			(snapshot) => (snapshot.player ? [snapshot.player] : []),
			(actor, alpha, entry) =>
				actorRibbonSample(actor, alpha, blockSizePx, entry.frameNumber),
		);
	}

	if (trailEntries.length >= 2) {
		projectileRuns = collectProjectileRibbonRuns(
			trailEntries,
			blockSizePx,
		);

		for (const run of projectileRuns) {
			if (drawPiecewiseStraightProjectileRun(run)) {
				straightProjectileIds.add(run[0].renderId);
			}
		}
	}

	for (const run of playerRuns) drawPiecewiseStraightPlayerRun(run);
	drawTrailRibbons(quadTrailEntries, rendering, straightProjectileIds);
}
