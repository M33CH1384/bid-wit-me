/**
 * perfGovernor — the adaptive effects governor (perf round 3, 2026-11-05).
 *
 * The owner asked: "Is there a way we can automatically reduce effects if
 * low power mode is active?" iOS exposes NO web API for the Low Power Mode
 * switch, so this governor never claims to read it. What it reads is the
 * thing LPM (and heat throttling, and a weaker phone) actually does to the
 * game: sustained frame overruns. When rendered frames keep missing their
 * budget, the governor steps the scene's decorative load down — render
 * pixel ratio first, then shadow resolution, then the idle-life pulses —
 * and steps back up when headroom returns and stays. Hysteresis on both
 * sides (accumulated bad/good time plus a minimum dwell) means it never
 * flaps.
 *
 * Hard rules (owner-set):
 *  - The manual quality setting and the load ramp's ceilings are the
 *    CEILING. The governor only ever trims BELOW them (its caps combine
 *    with the ceiling through Math.min) and never raises anything.
 *  - A healthy 60 Hz is NOT slowness: 16.7 ms frames — including a
 *    ProMotion phone LPM-capped from 120 Hz to 60 Hz — never trip the
 *    overrun line (25 ms). Only real jank does.
 *  - Gameplay feedback is never trimmed: card flights, trick collection
 *    and every game-flow animation invalidate the demand loop themselves
 *    and always render. The deepest trim only stills the IDLE life
 *    (figure breath/sway, venue ambience pulses) — decoration.
 *  - No animation timing constant is touched, anywhere.
 *
 * Pure module (no three.js, injectable clock): the Scene feeds it rAF
 * deltas sampled only while the table is ACTIVE (framePulse's activity
 * window — under frameloop="demand" an idle gap is not a frame cost, so
 * idle deltas are never sampled), and applies the level's caps.
 */

/** A frame slower than this counts as an overrun (~40 fps). A 60 Hz
 *  frame is 16.7 ms; a 120 Hz frame is 8.3 ms — neither is close. */
export const OVERRUN_MS = 25;
/** Rolling window of recent active-frame deltas the decision reads. */
export const WINDOW_SAMPLES = 90;
/** Share of the window that must be overruns before time accrues as bad. */
export const BAD_RATIO = 0.5;
/** At or below this overrun share (with a healthy EMA) time accrues as good. */
export const GOOD_RATIO = 0.1;
/** EMA at or below this (ms) counts as headroom for stepping back up. */
export const GOOD_EMA_MS = 18;
/** Sustained bad time required to step down one level. */
export const BAD_MS_TO_STEP = 3000;
/** Sustained good time required to step up one level. */
export const GOOD_MS_TO_STEP = 6000;
/** Minimum time between any two level changes (anti-flap dwell). */
export const DWELL_MS = 5000;
/** Deepest trim level. */
export const MAX_LEVEL = 3;

export interface GovernorCaps {
  /** Render pixel-ratio cap (combined with the ceiling via Math.min). */
  dpr: number;
  /** Shadow map size cap (combined via Math.min; 0 = shadows already off). */
  shadow: number;
  /** Still the idle-life pulses (decorative breath/sway/ambience). */
  holdLife: boolean;
}

/** Per-level caps. Level 0 is "no trim": infinite caps, so Math.min always
 *  returns the manual/ramp ceiling untouched. */
export const GOVERNOR_CAPS: readonly GovernorCaps[] = [
  { dpr: Number.POSITIVE_INFINITY, shadow: Number.POSITIVE_INFINITY, holdLife: false },
  { dpr: 1.5, shadow: Number.POSITIVE_INFINITY, holdLife: false },
  { dpr: 1.25, shadow: 1024, holdLife: false },
  { dpr: 1.0, shadow: 512, holdLife: true },
];

export function capsFor(level: number): GovernorCaps {
  return GOVERNOR_CAPS[Math.max(0, Math.min(MAX_LEVEL, level))]!;
}

/** Combine a ceiling (manual quality / load ramp) with a governor level.
 *  The result can never exceed the ceiling — the governor trims only. */
export function applyCaps(ceilingDpr: number, ceilingShadow: number, level: number): { dpr: number; shadow: number; holdLife: boolean } {
  const caps = capsFor(level);
  return {
    dpr: Math.min(ceilingDpr, caps.dpr),
    shadow: Math.min(ceilingShadow, caps.shadow),
    holdLife: caps.holdLife,
  };
}

export interface GovernorProbe {
  level: number;
  overRatio: number;
  emaMs: number;
  samples: number;
}

/**
 * The governor state machine. Feed it frame deltas (ms) with a monotonic
 * clock while the table is active; read `level`. Level changes are also
 * pushed to the optional listener (the Scene applies caps + records a
 * breadcrumb there).
 */
export class PerfGovernor {
  level = 0;
  onLevelChange: ((level: number) => void) | null = null;
  private deltas: number[] = [];
  private emaMs = 1000 / 60;
  private badMs = 0;
  private goodMs = 0;
  private lastChangeAt = -Infinity;

  /** One rendered frame's delta. `now` is a monotonic ms clock. */
  sample(deltaMs: number, now: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    // A delta past ~250 ms is a stall (tab switch, debugger, a single
    // huge hitch), not frame pacing — counting it would let one event
    // stand in for sustained slowness. Clamp it to the overrun line's
    // neighbourhood: it still counts as ONE bad frame, nothing more.
    const d = Math.min(deltaMs, 100);
    this.deltas.push(d);
    if (this.deltas.length > WINDOW_SAMPLES) this.deltas.splice(0, this.deltas.length - WINDOW_SAMPLES);
    this.emaMs = this.emaMs * 0.9 + d * 0.1;
    if (this.deltas.length < WINDOW_SAMPLES) return;

    const ratio = this.overRatio();
    if (ratio >= BAD_RATIO) { this.badMs += d; this.goodMs = 0; }
    else if (ratio <= GOOD_RATIO && this.emaMs <= GOOD_EMA_MS) { this.goodMs += d; this.badMs = 0; }
    else { this.badMs = 0; this.goodMs = 0; }

    if (now - this.lastChangeAt < DWELL_MS) return;
    if (this.badMs >= BAD_MS_TO_STEP && this.level < MAX_LEVEL) this.setLevel(this.level + 1, now);
    else if (this.goodMs >= GOOD_MS_TO_STEP && this.level > 0) this.setLevel(this.level - 1, now);
  }

  private setLevel(level: number, now: number): void {
    this.level = level;
    this.lastChangeAt = now;
    this.badMs = 0;
    this.goodMs = 0;
    try { this.onLevelChange?.(level); } catch { /* a listener must never break the loop */ }
  }

  overRatio(): number {
    if (this.deltas.length === 0) return 0;
    let over = 0;
    for (const d of this.deltas) if (d > OVERRUN_MS) over++;
    return over / this.deltas.length;
  }

  probe(): GovernorProbe {
    return { level: this.level, overRatio: this.overRatio(), emaMs: this.emaMs, samples: this.deltas.length };
  }

  /** Test seam: back to a fresh, untrimmed governor. */
  reset(): void {
    this.level = 0;
    this.deltas = [];
    this.emaMs = 1000 / 60;
    this.badMs = 0;
    this.goodMs = 0;
    this.lastChangeAt = -Infinity;
  }
}

/** The session's governor (one live scene at a time — the same singleton
 *  discipline as framePulse). */
export const perfGovernor = new PerfGovernor();
