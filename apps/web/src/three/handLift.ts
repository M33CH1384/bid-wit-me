import { CH } from './layout';

/**
 * Your-turn hand: legal cards rise together, cards you can't play sink and dim, a tap lifts one card further.
 * Distances are CSS pixels on the canvas. The fan lives on the depth-1 camera plane, so a pixel is
 * `viewH / screenH` plane units (see handCardPlane). The raise is a translateY on an inner wrapper;
 * it is not baked into the fan's rotate or position. Stacking is render order and depth
 * (`handRenderOrder`, `handDepthOpts`), not the translate.
 */

/** Clear of the fan. 14px was a sliver once the cards overlap. */
export const LEGAL_LIFT_PX = 28;
export const ILLEGAL_DROP_PX = 4;
export const SELECT_LIFT_PX = 10;
/** Group outline fade, in seconds. The cards themselves rise on RAISE_S. */
export const LIFT_S = 0.2;
/** Inner-wrapper raise. translateY only, so the fan's rotate and position never rewrite. */
export const RAISE_S = 0.16;
/** After a card leaves, the others slide into the gap. Same curve as the lift, a little longer. */
export const GAP_S = 0.24;

/** One rounded outline around each run of legal cards. No per-card border, no face tint. */
export const OUTLINE_COLOR = '#F2C14E';
export const OUTLINE_PX = 2;
/** Corner radius of the group outline, in CSS pixels. */
export const GROUP_RADIUS_PX = 10;
/** Space between the card faces and the stroke centre. */
export const GROUP_PAD_PX = 4;
/**
 * `box-shadow: 0 0 18px 4px rgba(242,193,78,.4)`.
 * The ribbon is centred on the padding line and clipped so it ends about 16px from the cards.
 */
export const GLOW_BLUR_PX = 18;
export const GLOW_SPREAD_PX = 4;
export const GLOW_ALPHA = 0.4;
/** Outer edge of the glow mesh, measured from the card faces. */
export const GLOW_REACH_PX = 16;

/** One diagonal sweep when the turn's highlight appears. It does not loop. */
export const SHINE_MS = 650;
export const SHINE_S = SHINE_MS / 1000;
/** CSS linear-gradient angle: 0° is up, 90° is to the right. */
export const SHINE_DEG = 105;
/** Band width as a fraction of the group's span along the gradient. */
export const SHINE_WIDTH = 0.35;
export const SHINE_PEAK = 0.35;

/** Idle underglow opacity. A 2.2s ease-in-out cycle, and the outline does not scale. */
export const BREATHE_S = 2.2;
export const BREATHE_LO = 0.3;
export const BREATHE_HI = 0.5;
export const BREATHE_SCALE = 1;
/** Selected card: the same outline, brighter than the breath. */
export const SELECT_GLOW_OP = 0.8;
/**
 * Extra fan spacing on each side of a legal run, in CSS pixels.
 * The cards still overlap; this only opens the edge enough for the outline to read.
 */
export const GROUP_GAP_PX = 8;
/** Render order of a legal card sits above every illegal card. Index is added so left-to-right stays put. */
export const LEGAL_STACK = 100;
/**
 * A selected card draws after every other hand card. 400 clears a 17-card fan
 * (face is order + 0.5, ring is order + RING_ABOVE) and the unused group outline at LEGAL_STACK + 40.
 */
export const SELECT_STACK = 400;

/**
 * Not-playable cards read at 55% brightness. The albedo below was tuned on the lit, tone-mapped card so that
 * (0.20, 0.195, 0.25) is about 60% on screen; scale it to the 55% target and keep the cool tint.
 */
export const ILLEGAL_BRIGHTNESS = 0.55;
const DIM_AT_60 = [0.2, 0.195, 0.25] as const;
const DIM_SCALE = ILLEGAL_BRIGHTNESS / 0.6;
export const ILLEGAL_COLOR: readonly [number, number, number] = [
  DIM_AT_60[0] * DIM_SCALE,
  DIM_AT_60[1] * DIM_SCALE,
  DIM_AT_60[2] * DIM_SCALE,
];
/** Saturation of a card you cannot play. 1 leaves the texture alone. */
export const ILLEGAL_SAT = 0.3;

const FULL_COLOR: readonly [number, number, number] = [1, 1, 1];

/**
 * What the face shader should show. Legal and off-turn cards share full colour.
 * Only an illegal card drops toward grey. A turn must not tint the cards you can play.
 */
export function faceLook(dim: boolean): { color: readonly [number, number, number]; sat: number } {
  return dim ? { color: ILLEGAL_COLOR, sat: ILLEGAL_SAT } : { color: FULL_COLOR, sat: 1 };
}

export type HandPose = 'flat' | 'illegal' | 'legal' | 'selected';
export type HandStack = 'rest' | 'play' | 'selected';

/** Off turn everything is flat, even a card that was selected. Illegal cards never take the extra tap lift. */
export function playablePose(yourTurn: boolean, isLegal: boolean, selected: boolean): HandPose {
  if (!yourTurn) return 'flat';
  if (!isLegal) return 'illegal';
  return selected ? 'selected' : 'legal';
}

export function canTapCard(pose: HandPose): boolean {
  return pose === 'legal' || pose === 'selected';
}

/**
 * Per card, never on the fan. `dim` is only the illegal pose. `glow` is that card's own ring:
 * every playable card when the hand is mixed, plus a tap and a tip mark. An all-legal lead
 * does not outline the whole fan. Selecting a card does not turn the others off.
 */
export function handCardChrome(o: {
  yourTurn: boolean;
  isLegal: boolean;
  selected: boolean;
  marked: boolean;
  anyIllegal: boolean;
}): { pose: HandPose; dim: boolean; glow: boolean } {
  const pose = playablePose(o.yourTurn, o.isLegal, o.selected);
  return {
    pose,
    dim: pose === 'illegal',
    glow: o.selected || o.marked || (o.isLegal && o.anyIllegal),
  };
}

/**
 * Painter's order for one hand card. Every legal card draws after every illegal card.
 * Within each group the index still increases left to right.
 * `front` is the tapped card: it jumps ahead of every neighbour, including a higher index.
 */
export function handRenderOrder(index: number, above: boolean, front = false): number {
  if (front) return SELECT_STACK + index;
  return (above ? LEGAL_STACK : 0) + index;
}

/** Camera-space stack for one pose. Depth is not the screen raise; the selected card still has to be nearer than a higher-index neighbour. */
export function handDepthOpts(pose: HandPose): { layer: 'rest' | 'play' | 'selected'; near?: number } {
  if (pose === 'selected') return { layer: 'selected', near: LEGAL_NEAR * 2 };
  if (pose === 'legal') return { layer: 'play', near: LEGAL_NEAR };
  return { layer: 'rest' };
}

/**
 * How far a playable card moves toward the camera, in the fan's depth units.
 * The fan steps 0.006 per card, and iPhone Safari's 16-bit depth fights around 0.0003.
 * 0.02 clears the three neighbours that actually overlap a card, and stays well clear of that fight.
 * It does not change the picture: position and scale are both multiplied by depth.
 */
export const LEGAL_NEAR = 0.02;

/**
 * Window-space depth bias for the face and the back.
 * A card facing the camera has almost no slope, so the units term is what separates
 * the pips from the cream cap when both quantize to the same 16-bit depth.
 * The factor term is 0: on a phone-sized card the depth slope is noise, and a non-zero
 * factor swaps the back in front of the face on every redraw (the selection lift).
 */
export const FACE_POLYGON_OFFSET = { factor: 0, units: -8 } as const;

/**
 * How far the per-card gold ring sits in front of the face, in card-local units.
 * The ring is opaque and depth-write is off, so it shares the card's draw queue and the face
 * (half a step later) covers the stroke where it tucks under the pips. A transparent ring would
 * be drawn after every face, and a neighbour's stroke would then paint across this card.
 * The face is already FACE_CAP_GAP ahead of the cap and polygon-offset another 8 window units
 * toward the camera. On a 24-bit desktop buffer those 8 units are a sliver and the outer stroke
 * still wins. iPhone Safari's 16-bit depth makes the same 8 units about 0.0018 camera units at
 * the hand, which is enough to fail the ring — including the part that sticks past the face,
 * once the face and the hairline share a depth tile. A local push of 0.012 is about 0.003 camera
 * units on a phone fan: past those 8 units, and still under the 0.006 step to the next peer, so
 * a card at the same raise still lets the card on its right cover the overlap. A selected card
 * does not: its render order and depth sit in front of every neighbour. It is geometry, not
 * polygonOffset, because the Metal depth bias that feeds polygonOffset is the part that goes
 * wrong on that buffer.
 */
export const OUTLINE_AHEAD = 0.012;

/** Pull the face and the back toward the camera in window depth. The body stays unbiased. */
export function applyFaceDepthBias(material: { polygonOffset: boolean; polygonOffsetFactor: number; polygonOffsetUnits: number }): void {
  material.polygonOffset = true;
  material.polygonOffsetFactor = FACE_POLYGON_OFFSET.factor;
  material.polygonOffsetUnits = FACE_POLYGON_OFFSET.units;
}

/**
 * Paint state for one mesh of a card.
 * A child group resets Three.js groupOrder, so the group's renderOrder never decides the draw.
 * The face keeps the depth test: it is FACE_CAP_GAP in front of the cap and polygon-offset
 * toward the camera, and half a step later in render order, so the cap cannot cover the pips.
 * A ring drawn just under its own face is covered wherever the next card overlaps it,
 * so a run of legal cards reads as one outline around the group. The ring instead draws
 * RING_ABOVE past its band: past every peer face in a 17-card hand, and still under the
 * selected card's face (SELECT_STACK is 400, a legal face tops out near 116).
 */
export const RING_ABOVE = 40;

export function cardMeshPaint(order: number, part: 'edge' | 'back' | 'face' | 'glow'): { renderOrder: number; depthTest: boolean } {
  // The face draws after the back. A 16-bit tie used to keep whichever mesh sorted last,
  // and that was the BWM back for every card except the one pulled forward by a selection.
  if (part === 'glow') {
    // Depth test off: the card on the right is closer, and it would hide this stroke
    // even when the ring is painted later. The hole in the ring leaves the pips alone.
    return { renderOrder: order + RING_ABOVE, depthTest: false };
  }
  const renderOrder = part === 'edge' ? order : part === 'back' ? order + 0.25 : order + 0.5;
  return { renderOrder, depthTest: true };
}

/** @deprecated use cardMeshPaint. Kept so older comparisons of face vs edge still read. */
export function cardPartOrder(part: 'edge' | 'back' | 'face' | 'glow', order = 0): number {
  return cardMeshPaint(order, part).renderOrder;
}

/**
 * The group outline draws after every hand card. A 13-card fan tops out at LEGAL_STACK + 12.
 * The stroke stays above the neighbour that overlaps the run.
 */
export const GLOW_RENDER_ORDER = LEGAL_STACK + 40;

interface PaintNode { renderOrder: number; parent?: PaintNode | null }

/** Highest renderOrder on this object or an ancestor. The card root carries the stack for taps. */
export function paintOrder(obj: PaintNode | null | undefined): number {
  let best = 0;
  let o = obj;
  while (o) {
    if (o.renderOrder > best) best = o.renderOrder;
    o = o.parent;
  }
  return best;
}

/**
 * Deliver pointer hits in paint order, then by distance.
 * Legal cards are drawn over the illegal cards beside them. A distance sort would give the tap
 * to the closer illegal neighbour, and its handler would swallow it. The card on screen gets the tap.
 */
export function hitsInPaintOrder<T extends { distance: number; eventObject?: PaintNode | null; object: PaintNode }>(hits: readonly T[]): T[] {
  return hits.slice().sort((a, b) => {
    const d = paintOrder(b.eventObject ?? b.object) - paintOrder(a.eventObject ?? a.object);
    return d !== 0 ? d : a.distance - b.distance;
  });
}

/**
 * Horizontal shift, in CSS pixels, that opens `GROUP_GAP_PX` at every edge of a legal run.
 * The shifts are centered so the fan does not drift. Off turn, or when the whole hand is playable, every shift is 0.
 */
export function fanGapPx(playable: readonly boolean[]): number[] {
  const n = playable.length;
  const shift = new Array<number>(n).fill(0);
  let extra = 0;
  for (let i = 1; i < n; i++) {
    if (!!playable[i] !== !!playable[i - 1]) extra += GROUP_GAP_PX;
    shift[i] = extra;
  }
  const center = extra / 2;
  for (let i = 0; i < n; i++) shift[i] = shift[i]! - center;
  return shift;
}

export function posePx(pose: HandPose): number {
  switch (pose) {
    case 'flat': return 0;
    case 'illegal': return -ILLEGAL_DROP_PX;
    case 'legal': return LEGAL_LIFT_PX;
    case 'selected': return LEGAL_LIFT_PX + SELECT_LIFT_PX;
  }
}

/** Rest stays in the fan stack. The legal group comes forward, and the tapped card tops that. */
export function stackFor(pose: HandPose): HandStack {
  if (pose === 'selected') return 'selected';
  if (pose === 'legal') return 'play';
  return 'rest';
}

/**
 * Plane-space distance of `px` CSS pixels at depth 1.
 * A missing viewport (0, NaN) must not be treated as a 1px screen: 14px would become many screens tall
 * and the raised cards leave the picture.
 */
export function cssPxToPlane(px: number, viewH: number, screenH: number): number {
  if (!(Number.isFinite(px) && Number.isFinite(viewH) && Number.isFinite(screenH) && screenH >= 32)) return 0;
  return (px / screenH) * viewH;
}

/**
 * Local offset that raises a rolled card straight up the screen.
 * The fan quaternion is the camera times this roll, so a raw translateY walks the end cards sideways,
 * out of the fan. Applying the fan's roll to this offset puts the whole raise on screen-up.
 */
export function screenRaise(roll: number, distance: number): { x: number; y: number } {
  if (!Number.isFinite(roll) || !Number.isFinite(distance)) return { x: 0, y: 0 };
  return { x: Math.sin(roll) * distance, y: Math.cos(roll) * distance };
}

/** `handFan` / `handCardPlane` lift, as a fraction of card height. Positive raises the card. */
export function handLift(pose: HandPose, viewH: number, screenH: number, cardH: number): number {
  return cssPxToPlane(posePx(pose), viewH, screenH) / Math.max(1e-6, cardH);
}

/**
 * translateY of the inner wrapper, in card-local units (the parent fan scale turns it into screen pixels).
 * X, Z, rotation, and depth stay on the outer fan pose and do not change with legal or selected state.
 */
export function raiseLocalY(pose: HandPose, viewH: number, screenH: number, cardH: number): number {
  return handLift(pose, viewH, screenH, cardH) * CH;
}

/** Half-width of the 2px outline, in CSS pixels (the stroke is centered on the halo). */
export function outlineRadiusPx(): number {
  return OUTLINE_PX / 2;
}

/**
 * Half-width of the glow ribbon, in CSS pixels.
 * The stroke sits `GROUP_PAD_PX` outside the faces, so this reaches `GLOW_REACH_PX` from the cards.
 */
export function glowRadiusPx(): number {
  return GLOW_REACH_PX - GROUP_PAD_PX;
}

/**
 * Gaussian of an 18px CSS blur (sigma = blur / 2), plus a fade on the outer quarter so the
 * clip at ~16px from the cards does not leave a hard ring. `edge` is 0 on the outline and 1 at the ribbon edge.
 * Peak is 1. The breath (0.3–0.5) or the selected 0.8 is the shadow alpha — do not also multiply by GLOW_ALPHA.
 */
export function glowFalloff(edge: number): number {
  const px = Math.abs(edge) * glowRadiusPx();
  const sigma = GLOW_BLUR_PX / 2;
  const g = Math.exp(-0.5 * (px / sigma) ** 2);
  const fade = edge >= 1 ? 0 : edge > 0.75 ? 1 - (edge - 0.75) / 0.25 : 1;
  return g * fade;
}

/** CSS ease-out: cubic-bezier(0, 0, .58, 1). */
export function easeOut(t: number): number {
  return cssCubicBezier(0, 0, 0.58, 1, t);
}

/** CSS ease-in-out: cubic-bezier(.42, 0, .58, 1). */
export function easeInOut(t: number): number {
  return cssCubicBezier(0.42, 0, 0.58, 1, t);
}

/** Idle glow opacity at time `t` (seconds). Loops every BREATHE_S. Endpoints are 0.3, the half-cycle is 0.5. */
export function breatheOpacity(t: number): number {
  const phase = ((t % BREATHE_S) + BREATHE_S) % BREATHE_S / BREATHE_S;
  const half = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return BREATHE_LO + (BREATHE_HI - BREATHE_LO) * easeInOut(half);
}

/** Gradient direction in plane space (y up). CSS 105° points down-right. */
export function shineAxis(): { x: number; y: number } {
  const rad = (SHINE_DEG * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

/**
 * White-band alpha at `along` (0 at the group's leading edge, `span` at the trailing edge).
 * `t` is 0..1 after ease-out. The 35% band enters from before the group and leaves past it; outside [0,1] it is off.
 */
export function shineBand(along: number, span: number, t: number): number {
  if (!(t >= 0 && t <= 1) || !(span > 0)) return 0;
  const width = SHINE_WIDTH * span;
  const center = -width + easeOut(t) * (span + width * 2);
  const half = width * 0.5;
  const d = Math.abs(along - center) / half;
  if (d >= 1) return 0;
  return (1 - d) * SHINE_PEAK;
}

/** CSS cubic-bezier(x1, y1, x2, y2) sampled by x (time). Control x's must be in [0, 1]. */
export function cssCubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - err / d));
  }
  return sampleY(t);
}

/** cubic-bezier(.2, .8, .2, 1) — the group lift, and the slide that closes a gap. */
export function liftEase(t: number): number {
  return cssCubicBezier(0.2, 0.8, 0.2, 1, t);
}

/**
 * How one hand card moves this frame. A reveal flips in place, a card we have not shown yet flies in from
 * the deck, a play slides the others into the gap (translate + rotate only), and a highlight only lifts.
 * Legal state is not part of this — it must not change the card's key or restart the fan.
 */
export function fanMotion(o: { flip: boolean; fresh: boolean; closing: boolean }): {
  kind: 'flip' | 'deal' | 'slide' | 'lift';
  motion: 'lift' | 'flight' | 'slide';
  arc: number;
} {
  if (o.flip) return { kind: 'flip', motion: 'flight', arc: 0 };
  if (o.fresh) return { kind: 'deal', motion: 'flight', arc: 0.05 };
  if (o.closing) return { kind: 'slide', motion: 'slide', arc: 0 };
  return { kind: 'lift', motion: 'lift', arc: 0 };
}
