/**
 * Run It tornado — the 5-level in-match ladder (owner program, 2026-10-28).
 *
 * Level is PER SIDE, PER MATCH, from that side's successful Run It claims:
 * the Nth time a side claims Run It in a match, its funnel forms at rung N
 * (clamped at 5). Partners share one ladder (a claim by either partner ticks
 * the side); in cutthroat every seat ladders alone. The ladder resets with
 * the match and pays nothing — it is presentation, not a currency.
 *
 * Data honesty: a claim is a COMPLETED trick whose plays carry the engine's
 * `run` flag with a non-null winner (the same scan as detect.ts's
 * runClaimerSeat / Table's runClaimerSeat). A run-flagged trick with no
 * winner counts for nothing. Claims from hands played before this client
 * arrived cannot be reconstructed (HandRecord carries no run field), so the
 * tracker seeds silently from the first snapshot it actually holds and
 * never fabricates a count.
 *
 * This module is pure math + bookkeeping: the funnel in Tornado3D.tsx is
 * driven by these numbers, and the level badge in AnimFxLayer reads the
 * same names constant — a rename is one line, here.
 */
import { sideOf, type TableRules, type Trick } from '@spades/rules';

/** Rung names, index 0 = level 1. The ONLY place the names live. */
export const TORNADO_LEVEL_NAMES = ['Dust Devil', 'Twister', 'Storm', 'Supercell', 'Cataclysm'] as const;

export type TornadoLevel = 1 | 2 | 3 | 4 | 5;

export const TORNADO_MAX_LEVEL: TornadoLevel = 5;

/** The rung for a side's claim count this match (count ≥ 1 once a claim exists). */
export function tornadoLevelForCount(count: number): TornadoLevel {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  return Math.min(TORNADO_MAX_LEVEL, Math.max(1, n)) as TornadoLevel;
}

export function tornadoLevelName(level: number): string {
  return TORNADO_LEVEL_NAMES[tornadoLevelForCount(level) - 1]!;
}

/* ------------------------------------------------------------ parameters
 * World units, against the table geometry in layout.ts (FELT.hx 1.5,
 * FELT.hz 1.78 — the felt is 3.0 wide). Rung 2 is the baseline: it IS the
 * funnel that shipped before the ladder (shader height 1.9, mouth radius
 * 0.77 at the top, stem 0.07), with every multiplier at 1 and no shells.
 * Size gains follow the motion-studio prototype ladder's ratios and STOP
 * at rung 4 (program §D.7): rung 5 has rung 4's exact dimensions and gains
 * only spin, point coverage, body and darkness — intensity, not size, so
 * the tornado stays a weather event under the nuke/mega hierarchy. */
export interface TornadoParams {
  /** the rung these numbers belong to (fractional while blending) */
  level: number;
  /** funnel height, world units (the shader's 1.9 cone, scaled) */
  height: number;
  /** radius at the funnel's mouth (top), world units */
  mouth: number;
  /** horizontal scale of the whole funnel group (mouth ÷ baseline mouth) */
  radiusX: number;
  /** base dust-ring radius, world units */
  ringR: number;
  /** angular-speed multiplier for the dust (the riders keep the funnel's own clock) */
  spin: number;
  /** fraction of the allocated dust pool actually drawn */
  dustFrac: number;
  /** fraction of the allocated debris pool actually drawn */
  debrisFrac: number;
  /** point-size multiplier (coverage without new particles) */
  pointSize: number;
  /** point-alpha multiplier (the funnel's body / density read) */
  body: number;
  /** 0..1 room-darkening shell strength */
  dark: number;
  /** 0..1 lightning-flicker strength */
  flicker: number;
  /** signature debris (ruby slippers, cow, tracker sensors) rides from rung 2 up */
  signature: boolean;
}

export const TORNADO_PARAMS: readonly TornadoParams[] = [
  { level: 1, height: 0.62, mouth: 0.37, radiusX: 0.48, ringR: 0.55, spin: 0.63, dustFrac: 0.45, debrisFrac: 0, pointSize: 0.85, body: 0.67, dark: 0, flicker: 0, signature: false },
  { level: 2, height: 1.9, mouth: 0.77, radiusX: 1, ringR: 1.05, spin: 1, dustFrac: 1, debrisFrac: 1, pointSize: 1, body: 1, dark: 0, flicker: 0, signature: true },
  { level: 3, height: 2.35, mouth: 1.2, radiusX: 1.56, ringR: 1.95, spin: 1.37, dustFrac: 1, debrisFrac: 1, pointSize: 1.12, body: 1.1, dark: 0.18, flicker: 0.5, signature: true },
  { level: 4, height: 2.7, mouth: 1.72, radiusX: 2.23, ringR: 2.6, spin: 1.74, dustFrac: 1, debrisFrac: 1, pointSize: 1.28, body: 1.18, dark: 0.38, flicker: 0.8, signature: true },
  { level: 5, height: 2.7, mouth: 1.72, radiusX: 2.23, ringR: 2.6, spin: 2.08, dustFrac: 1, debrisFrac: 1, pointSize: 1.5, body: 1.25, dark: 0.55, flicker: 1, signature: true },
];

/** The exact parameter set for one rung (1..5, clamped). */
export function tornadoParams(level: number): TornadoParams {
  return TORNADO_PARAMS[tornadoLevelForCount(level) - 1]!;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * The formation blend: as a funnel forms it interpolates from the previous
 * rung's parameters to the claimed rung's (the prototype ladder's
 * interpolation), so the escalation is seen arriving. u is clamped 0..1;
 * the signature-debris switch flips at the midpoint.
 */
export function lerpTornadoParams(from: TornadoParams, to: TornadoParams, u: number): TornadoParams {
  const t = Math.min(1, Math.max(0, u));
  return {
    level: lerp(from.level, to.level, t),
    height: lerp(from.height, to.height, t),
    mouth: lerp(from.mouth, to.mouth, t),
    radiusX: lerp(from.radiusX, to.radiusX, t),
    ringR: lerp(from.ringR, to.ringR, t),
    spin: lerp(from.spin, to.spin, t),
    dustFrac: lerp(from.dustFrac, to.dustFrac, t),
    debrisFrac: lerp(from.debrisFrac, to.debrisFrac, t),
    pointSize: lerp(from.pointSize, to.pointSize, t),
    body: lerp(from.body, to.body, t),
    dark: lerp(from.dark, to.dark, t),
    flicker: lerp(from.flicker, to.flicker, t),
    signature: t >= 0.5 ? to.signature : from.signature,
  };
}

/* ------------------------------------------------------------ draw counts
 * The allocated pools are NEVER grown by a rung — levels only reduce the
 * draw range or hold it at the pool (density gains come from point size
 * and alpha). These are the proven per-profile budgets the funnel has
 * always allocated (see tornadoParts in Tornado3D.tsx). */
export const TORNADO_POOL = {
  high: { dust: 1400, debris: 260 },
  low: { dust: 450, debris: 90 },
} as const;

/** How many of each pool a rung actually draws, per quality profile. */
export function tornadoDrawCounts(level: number, hi: boolean): { dust: number; debris: number } {
  const p = tornadoParams(level);
  const pool = hi ? TORNADO_POOL.high : TORNADO_POOL.low;
  return {
    dust: Math.round(pool.dust * p.dustFrac),
    debris: Math.round(pool.debris * p.debrisFrac),
  };
}

/* ------------------------------------------------------------ claim scan */

/**
 * The resolved Run It claim in a hand's completed tricks: the winner of the
 * LAST trick whose plays carry the engine's run flag — or null when the
 * hand holds no resolved claim. A run-flagged trick with no winner counts
 * for nothing.
 */
export function runClaimOfHand(tricks: readonly Trick[]): { seat: number; trickIndex: number } | null {
  for (let i = tricks.length - 1; i >= 0; i--) {
    const t = tricks[i]!;
    if (t.winner !== null && t.plays.some((p) => p.run)) return { seat: t.winner, trickIndex: i };
  }
  return null;
}

/* ------------------------------------------------------------ the tracker */

export interface TornadoClaim {
  /** the seat that claimed (won the run-flagged trick) */
  seat: number;
  /** the side that ladders up (partners share; cutthroat: the seat itself) */
  side: number;
  /** that side's claim count this match, after this claim */
  count: number;
  /** the rung this claim's funnel forms at */
  level: TornadoLevel;
  handNo: number;
}

/**
 * Per-side, per-match claim tracker. One claim counts per hand at most
 * (a hand's run resolves once). `observe` returns the claim the moment it
 * resolves; `seedFrom` marks whatever the first held snapshot already
 * contains as counted WITHOUT incrementing — claims this client never
 * held are not fabricated.
 */
export class TornadoLadderTracker {
  private counts = new Map<number, number>();
  private countedHands = new Set<number>();
  private matchKey: string | number | undefined;
  private hasKey = false;
  private lastHandNo = -1;

  /** Forget everything (a new match, or a rewind the layer detected). */
  reset(matchKey?: string | number): void {
    this.counts.clear();
    this.countedHands.clear();
    this.matchKey = matchKey;
    this.hasKey = matchKey !== undefined;
    this.lastHandNo = -1;
  }

  /** Silently mark the claim already resolved in this snapshot as counted. */
  seedFrom(handNo: number, tricks: readonly Trick[]): void {
    if (runClaimOfHand(tricks)) this.countedHands.add(handNo);
    this.lastHandNo = Math.max(this.lastHandNo, handNo);
  }

  /** A side's claim count so far this match. */
  countForSide(side: number): number {
    return this.counts.get(side) ?? 0;
  }

  /** The rung a side's NEXT claim would form at (its current count's rung, min 1). */
  levelForSide(side: number): TornadoLevel {
    return tornadoLevelForCount(Math.max(1, this.countForSide(side)));
  }

  /**
   * Feed one snapshot. Returns the claim when this snapshot is the one
   * that resolves it, otherwise null. A changed match key resets and
   * seeds silently; a hand rewind resets (rematch) before evaluating.
   */
  observe(handNo: number, tricks: readonly Trick[], rules: TableRules, matchKey?: string | number): TornadoClaim | null {
    if (matchKey !== undefined && this.hasKey && matchKey !== this.matchKey) {
      this.reset(matchKey);
      this.seedFrom(handNo, tricks);
      return null;
    }
    if (!this.hasKey && matchKey !== undefined) { this.matchKey = matchKey; this.hasKey = true; }
    if (handNo < this.lastHandNo) {
      // hand counts rewound (rematch at the same table): the old match's
      // ladder is gone — reset, then evaluate this snapshot fresh
      const key = this.matchKey;
      this.reset(key);
    }
    this.lastHandNo = Math.max(this.lastHandNo, handNo);
    const claim = runClaimOfHand(tricks);
    if (!claim) return null;
    if (this.countedHands.has(handNo)) return null;
    this.countedHands.add(handNo);
    const side = sideOf(claim.seat, rules);
    const count = this.countForSide(side) + 1;
    this.counts.set(side, count);
    return { seat: claim.seat, side, count, level: tornadoLevelForCount(count), handNo };
  }
}
