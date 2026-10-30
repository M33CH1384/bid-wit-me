import type { Card } from '@spades/rules';

/**
 * Deuce Drop / Cut impact bus (deuceFx.ts classifies; this carries the beat).
 *
 * The fx.shake idiom, one step further: when a classified card visually hits
 * the felt, its Card3D pushes an impact here — the same frame its landing
 * sounds fire — and two consumers drain it:
 *  - DeuceFxLayer (Scene) draws the felt ripple / spark burst / crack of
 *    light, starting from the card's actual touchdown point;
 *  - the beaten trump's Card3D (the Cut) starts its knock envelope.
 * The classification behind every event is derived from shared game state,
 * so every client pushes the same events for the same plays; only the
 * frame they land on is local, exactly like the landing sounds.
 */
export interface DeuceImpact {
  /** Monotonic id; consumers keep a watermark. */
  id: number;
  /** performance.now() at the impact frame. */
  at: number;
  kind: 'drop' | 'cut';
  /** Touchdown point of the landing card (world). */
  x: number;
  y: number;
  z: number;
  /** The beaten trump's card id for a Cut (its Card3D knocks); null for a Drop. */
  victim: Card | null;
  /** Deterministic per play (seeded from card + target) — spark jitter agrees across clients. */
  seed: number;
}

const MAX_KEPT = 12;
let seq = 0;
const impacts: DeuceImpact[] = [];

export function pushDeuceImpact(e: Omit<DeuceImpact, 'id'>): void {
  impacts.push({ ...e, id: ++seq });
  if (impacts.length > MAX_KEPT) impacts.splice(0, impacts.length - MAX_KEPT);
}

/** All impacts after `afterId`, oldest first. */
export function deuceImpactsAfter(afterId: number): DeuceImpact[] {
  return impacts.filter((e) => e.id > afterId);
}

export const lastDeuceImpactId = (): number => seq;

/**
 * Where a Cut's victim rests on the felt, written by Scene when it builds
 * the stealer's item (it knows both cards' targets) and read by
 * DeuceFxLayer when the impact lands: the crack of light lies across the
 * victim, and the spark burst sits between the two cards. Keyed by card
 * id — unique within a hand; overwritten on the render that introduces
 * each steal, before its flight can land.
 */
export interface DeuceCutPose { x: number; y: number; z: number; dirX: number; dirZ: number }
const cutPoses = new Map<Card, DeuceCutPose>();
export const setDeuceCutPose = (victim: Card, pose: DeuceCutPose): void => { cutPoses.set(victim, pose); };
export const deuceCutPose = (victim: Card): DeuceCutPose | undefined => cutPoses.get(victim);

/**
 * Proof/staging lever, mirroring the nuke's fx.warp: when
 * `window.__bwmDeuceFxSlow` holds a factor in (0, 1], the Drop/Cut
 * envelopes read elapsed time scaled by it, stretching the beats in wall
 * time so frame captures on a slow renderer can stage them; when
 * `window.__bwmDeuceFxAt` holds a phase in ms, the envelopes freeze at
 * that phase. Absent (the normal case) elapsed time passes through
 * untouched — no product behavior depends on this.
 */
export function deuceFxElapsed(sinceMs: number): number {
  const g = globalThis as { __bwmDeuceFxSlow?: unknown; __bwmDeuceFxAt?: unknown };
  if (typeof g.__bwmDeuceFxAt === 'number' && g.__bwmDeuceFxAt >= 0) return g.__bwmDeuceFxAt;
  const s = g.__bwmDeuceFxSlow;
  return sinceMs * (typeof s === 'number' && s > 0 && s < 1 ? s : 1);
}

/** Small deterministic hash (FNV-1a, same family as playSeed) for per-play effect seeds. */
export function deuceSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
