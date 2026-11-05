/**
 * framePulse — the settled-table pulse gate (perf fix, owner-authorized
 * 2026-11-03).
 *
 * The table canvas is frameloop="demand": nothing renders unless someone
 * calls invalidate(). The continuous-life tickers (figure breath/sway,
 * crowd, venue ambience, room life) exist to keep that life moving —
 * left alone they demand a full scene render 20x/second forever, even
 * while the player just sits and thinks. Measured (perf investigation,
 * 2026-11-03): a settled bid-wait table renders ~110 draw calls a frame
 * including a 2048px shadow pass, ~90% of the phone's idle main-thread
 * effort — the sustained load behind the heat / battery / slow-motion
 * reports. Presentations never needed the tickers (cards, effects and
 * shows invalidate themselves while they run); only IDLE life rides
 * them.
 *
 * This gate separates the two regimes:
 *  - ACTIVE: scene activity was noted within ACTIVITY_WINDOW_MS (a
 *    play, a bid, a turn change, a deal, a pointer touch, a live seat
 *    video…). Every ticker pulse passes — full native cadence, exactly
 *    the pre-fix behavior.
 *  - SETTLED: no activity for the whole window. Pulses pass at most
 *    once per SETTLED_PULSE_MS across ALL gated tickers (one shared
 *    stamp, so the rates coalesce instead of stacking). Breath and
 *    sway are pure functions of the frame clock, so at the settled
 *    rate the same continuous motion is simply sampled more slowly —
 *    the figures stay alive, calmer; they never freeze.
 *
 * Pure module (no three.js): Table-side and test code can note activity
 * without touching the scene graph or the entry graph.
 */

/** How long after the last noted activity the table counts as active. */
export const ACTIVITY_WINDOW_MS = 1500;
/** Minimum spacing between rendered frames once the table is settled. */
export const SETTLED_PULSE_MS = 250;

let lastActivityAt = -Infinity;
let lastPulseAt = -Infinity;

interface PulseProbe { fired: number; skipped: number }
const probe: PulseProbe = { fired: 0, skipped: 0 };

function publishProbe(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __bwmFramePulse?: PulseProbe }).__bwmFramePulse = probe;
}

/** Note that something happened at the table: game flow moved, the
 *  player touched the felt, a live feed is showing. Cheap enough to
 *  call on every render of the scene's prop watcher. */
export function noteSceneActivity(now: number = performance.now()): void {
  lastActivityAt = now;
}

/** True while the table is inside its activity window (full cadence). */
export function sceneIsActive(now: number = performance.now()): boolean {
  return now - lastActivityAt < ACTIVITY_WINDOW_MS;
}

/* Scene rest (perf round 3, 2026-11-05): while a full-screen post-hand
 * overlay (hand recap / results) covers the table, the Scene rests —
 * frameloop 'never' plus this gate, so no life ticker even asks for a
 * frame. The work was invisible (the recap sheet is opaque) and, on a
 * struggling phone, it was the load that lost the WebGL context. */
let sceneCovered = false;

/** The Scene reports whether a post-hand overlay covers it. While
 *  covered, every continuous-life pulse is denied. */
export function setSceneCovered(covered: boolean): void {
  sceneCovered = covered;
}

/* Governor life-hold (perf round 3): at the deepest adaptive trim the
 * idle-life pulses (figure breath/sway, venue ambience) are held. Real
 * game flow never rides pulseDue — it invalidates itself — so gameplay
 * animation is untouched; only decoration stills. */
let lifeHeld = false;

/** The perf governor reports whether idle life is held at its trim. */
export function setLifeHeld(held: boolean): void {
  lifeHeld = held;
}

/** True while any full-stop gate (covered / governor life-hold) is on. */
export function lifeGateClosed(): boolean {
  return sceneCovered || lifeHeld;
}

/**
 * Ask whether a continuous-life ticker may invalidate now. Active
 * tables always may; settled tables share one pulse slot per
 * SETTLED_PULSE_MS no matter how many tickers ask. A covered scene or
 * a governor life-hold denies every pulse.
 */
export function pulseDue(now: number = performance.now()): boolean {
  if (lifeGateClosed()) {
    probe.skipped++;
    publishProbe();
    return false;
  }
  if (sceneIsActive(now)) {
    probe.fired++;
    publishProbe();
    return true;
  }
  if (now - lastPulseAt >= SETTLED_PULSE_MS) {
    lastPulseAt = now;
    probe.fired++;
    publishProbe();
    return true;
  }
  probe.skipped++;
  publishProbe();
  return false;
}

/** Test seam: reset the clock state between cases. */
export function resetFramePulseForTest(): void {
  lastActivityAt = -Infinity;
  lastPulseAt = -Infinity;
  sceneCovered = false;
  lifeHeld = false;
  probe.fired = 0;
  probe.skipped = 0;
}
