/**
 * Per-game performance census (perf round 2, 2026-11-04).
 *
 * Round 1 killed the per-game reload tax (one persistent scene) and
 * the settled-idle burn; the owner's three-game verdict still came
 * back slow in game 3, and the sandbox rig (SwiftShader) cannot
 * reproduce a phone's multi-game slope — its settles take minutes and
 * the series path needs two live clients. So instead of guessing,
 * every settled game publishes one census here: the same window-probe
 * pattern the figure and voice residency layers already use
 * (__bwmPerfCensus / __bwmPerfTrail, readable in any device session),
 * plus one 'perf' breadcrumb per game on the crash-telemetry channel,
 * so a real session carries its own growth table — textures,
 * geometries, programs, heap, figure/voice residency, DOM, WAAPI —
 * and the next slow-game report arrives with the slope attached.
 *
 * Pure shape + bookkeeping; the Scene reads the live counters and
 * calls publishPerfCensus once per (seed, loadSettled).
 */

export interface PerfCensusInput {
  /** the game's seed (online: `code:game`; offline: the game seed) */
  seed: string;
  /** live GL textures in the table context (renderer.info.memory) */
  textures: number;
  /** live GL geometries in the table context */
  geometries: number;
  /** compiled programs in the table context */
  programs: number;
  /** JS heap used, MB (null where performance.memory is unavailable) */
  heapMB: number | null;
  /** decoded figure residency, MB (null before the probe publishes) */
  figMB: number | null;
  /** decoded voice clip residency, MB (null before the probe publishes) */
  voiceMB: number | null;
  /** DOM node count */
  dom: number;
  /** live WAAPI animations (document.getAnimations) */
  waapi: number;
}

export interface PerfCensus extends PerfCensusInput {
  /** performance.now() at publish */
  at: number;
}

const num = (v: number | null, digits = 1): string =>
  v === null || !Number.isFinite(v) ? '-' : String(+v.toFixed(digits));

/** One compact breadcrumb line for a census. Bounded well under the
 *  crumb channel's comfort zone; missing probes render as '-'. */
export function perfCrumb(c: PerfCensusInput): string {
  return [
    `seed=${c.seed || '?'}`,
    `tex=${c.textures}`,
    `geo=${c.geometries}`,
    `prog=${c.programs}`,
    `heap=${num(c.heapMB)}`,
    `fig=${num(c.figMB)}`,
    `voice=${num(c.voiceMB)}`,
    `dom=${c.dom}`,
    `waapi=${c.waapi}`,
  ].join(' ');
}

/** The session's recent censuses, newest last, capped — a runaway
 *  trail would itself become the kind of growth this file exists to
 *  catch. */
export class PerfTrail {
  private items: PerfCensus[] = [];

  push(c: PerfCensus): void {
    this.items.push(c);
    if (this.items.length > 8) this.items.splice(0, this.items.length - 8);
  }

  list(): PerfCensus[] {
    return [...this.items];
  }

  latest(): PerfCensus | null {
    return this.items[this.items.length - 1] ?? null;
  }
}

export const perfTrail = new PerfTrail();

/** Record a census and publish it on the window probes. */
export function publishPerfCensus(input: PerfCensusInput): PerfCensus {
  const census: PerfCensus = { ...input, at: typeof performance !== 'undefined' ? performance.now() : 0 };
  perfTrail.push(census);
  try {
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __bwmPerfCensus?: PerfCensus; __bwmPerfTrail?: PerfCensus[] };
      w.__bwmPerfCensus = census;
      w.__bwmPerfTrail = perfTrail.list();
    }
  } catch { /* probe publication is never load-bearing */ }
  return census;
}
