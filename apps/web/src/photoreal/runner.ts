/**
 * Photoreal effect lifecycle runner (crash hardening, 2026-11-06).
 *
 * Owns ONE named effect's lifecycle — module load, canvas construction,
 * the rAF loop, and every exit path — with each failure contained:
 *
 *   - the module fails to load        → reported, nothing starts;
 *   - createFx() throws               → reported, no canvas is attached
 *     (construction happens BEFORE the canvas enters the DOM, so a
 *     throw leaves zero trace — the pre-hardening host appended first
 *     and orphaned the canvas on exactly this path);
 *   - render() throws mid-effect      → reported once, the effect
 *     stops and cleans up instead of dying silently with a stuck
 *     overlay and a stale running flag;
 *   - the owning screen unmounts      → the host bumps its epoch and
 *     stops all runners; a load that resolves afterwards sees the
 *     epoch move and never attaches, never touches shared state;
 *   - rapid retrigger                 → a per-play sequence number
 *     drops any load that resolves after a newer play superseded it;
 *   - cleanup (stop)                  → idempotent: cancels the frame,
 *     both timers, and the delayed tap-to-skip listener (armed or
 *     still pending), removes the canvas, runs the owner's reset
 *     exactly once.
 *
 * A runner plays one instance at a time: a fresh play() supersedes
 * the run in flight (the host's per-name registry did this before via
 * the `running` map; the semantics are unchanged). A PREPARED instance
 * (built ahead of its moment by prepareFxInstance) can be adopted
 * synchronously — adoption skips load + construction entirely.
 *
 * Everything environmental is injected (the house hooks pattern, cf.
 * chunkLoad.ts) so the lifecycle is unit-testable without a DOM.
 */
import type { PhotorealFxInstance, PhotorealFxOpts } from './modules/modules';

export interface FxModuleShape {
  createFx(canvas: HTMLCanvasElement, opts?: PhotorealFxOpts): PhotorealFxInstance;
}

export type FxFailureStage = 'load' | 'create' | 'render' | 'prepare';

export interface FxRunnerDeps {
  /** Load the effect module (host routes this through the optional chunk loader). */
  load: () => Promise<FxModuleShape>;
  createCanvas: () => HTMLCanvasElement;
  raf: (fn: (now: number) => void) => number;
  cancelRaf: (id: number) => void;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  /** window-level tap-to-skip listener plumbing (host owns the target). */
  addSkipListener: (fn: () => void) => void;
  removeSkipListener: (fn: () => void) => void;
  /** Failure sink (host wires crash telemetry; must never throw). */
  report: (stage: FxFailureStage, err: unknown) => void;
  /** The host's mount generation: bumped when the owning screen goes away. */
  epoch: () => number;
  /** Presented-clock advance (host passes fx.advancePresentedClock). */
  advance: (t: number, last: number | null, now: number) => { t: number; last: number | null };
}

export interface PreparedFx {
  canvas: HTMLCanvasElement;
  inst: PhotorealFxInstance;
}

export interface FxPlayRequest {
  mount: HTMLElement;
  /** createFx options for a fresh construction (ignored when adopting). */
  opts: PhotorealFxOpts;
  /** Size/style the canvas before construction or adoption (host placement). */
  styleCanvas: (canvas: HTMLCanvasElement) => void;
  /** A prepared instance to adopt synchronously, when one matches. */
  prepared?: PreparedFx | null;
  /** Fired once when the run actually begins (canvas attached, loop armed). */
  onBegin?: () => void;
  /** Per-frame side effects (nuke blast clock, quake crack cue). Runs inside the guarded frame. */
  onFrame?: (t: number, inst: PhotorealFxInstance) => void;
  /** Owner state reset, run exactly once when the run ends for any reason. */
  onStop?: () => void;
  /** Pinned capture time: render exactly one frame, arm nothing (QA hook). */
  pinnedAt?: number;
  /** Delay before the tap-to-skip listener arms (nuke). Omit = no skip listener. */
  skipDelayMs?: number;
}

/**
 * Build an instance ahead of its moment, off-DOM. Construction failure
 * is reported ('prepare') and yields null — the play path then falls
 * back to constructing at play time, exactly as before.
 */
export async function prepareFxInstance(
  deps: FxRunnerDeps,
  styleCanvas: (canvas: HTMLCanvasElement) => void,
  opts: PhotorealFxOpts,
): Promise<PreparedFx | null> {
  const epochAtStart = deps.epoch();
  let mod: FxModuleShape;
  try {
    mod = await deps.load();
  } catch (err) {
    deps.report('load', err);
    return null;
  }
  if (deps.epoch() !== epochAtStart) return null; // owner left during the load: build nothing
  const canvas = deps.createCanvas();
  styleCanvas(canvas);
  let inst: PhotorealFxInstance;
  try {
    inst = mod.createFx(canvas, opts);
  } catch (err) {
    deps.report('prepare', err);
    return null;
  }
  return { canvas, inst };
}

export interface FxRunner {
  play: (req: FxPlayRequest) => void;
  stop: () => void;
  isRunning: () => boolean;
}

export function createFxRunner(deps: FxRunnerDeps): FxRunner {
  let done = true; // nothing in flight until play()
  let playSeq = 0;
  let raf = 0;
  let skipTimer: number | null = null;
  let backstopTimer: number | null = null;
  let skipArmed = false;
  let canvas: HTMLCanvasElement | null = null;
  let onStop: (() => void) | undefined;

  const stop = (): void => {
    if (done) return;
    done = true;
    deps.cancelRaf(raf);
    if (skipTimer !== null) { deps.clearTimeout(skipTimer); skipTimer = null; }
    if (backstopTimer !== null) { deps.clearTimeout(backstopTimer); backstopTimer = null; }
    if (skipArmed) { skipArmed = false; deps.removeSkipListener(stop); }
    canvas?.remove();
    canvas = null;
    const reset = onStop;
    onStop = undefined;
    reset?.();
  };

  const startLoop = (req: FxPlayRequest, inst: PhotorealFxInstance): void => {
    let T = 0;
    let last: number | null = null;
    const frame = (now: number): void => {
      if (done) return;
      if (req.pinnedAt !== undefined) T = req.pinnedAt;
      else { const a = deps.advance(T, last, now); T = a.t; last = a.last; }
      try {
        inst.render(Math.min(T, inst.duration - 1e-3));
        req.onFrame?.(T, inst);
      } catch (err) {
        deps.report('render', err);
        stop();
        return;
      }
      if (req.pinnedAt !== undefined) return; // a pinned capture frame stays up until stop()
      if (T >= inst.duration) { stop(); return; }
      raf = deps.raf(frame);
    };
    raf = deps.raf(frame);
    if (req.pinnedAt === undefined) {
      if (req.skipDelayMs !== undefined) {
        skipTimer = deps.setTimeout(() => {
          skipTimer = null;
          if (done) return; // stopped before the delay elapsed: never arm onto the next screen
          skipArmed = true;
          deps.addSkipListener(stop);
        }, req.skipDelayMs);
      }
      backstopTimer = deps.setTimeout(stop, inst.duration * 1000 + 6000);
    }
  };

  const begin = (req: FxPlayRequest, prepared: PreparedFx): void => {
    canvas = prepared.canvas;
    req.mount.appendChild(canvas);
    done = false;
    onStop = req.onStop;
    req.onBegin?.();
    startLoop(req, prepared.inst);
  };

  const play = (req: FxPlayRequest): void => {
    const seq = ++playSeq;
    if (req.prepared) {
      stop(); // end the run in flight before adopting
      req.styleCanvas(req.prepared.canvas);
      begin(req, req.prepared);
      return;
    }
    const epochAtCall = deps.epoch();
    void deps.load().then((mod) => {
      if (seq !== playSeq) return; // a newer play superseded this load
      // The owning screen went away (or was replaced) while the module
      // was in flight: start nothing, touch nothing.
      if (deps.epoch() !== epochAtCall || !req.mount.isConnected) return;
      const c = deps.createCanvas();
      req.styleCanvas(c);
      let inst: PhotorealFxInstance;
      try {
        inst = mod.createFx(c, req.opts);
      } catch (err) {
        deps.report('create', err);
        return;
      }
      stop(); // end any run that began in the meantime, then start this one
      begin(req, { canvas: c, inst });
    }, (err) => { if (seq === playSeq) deps.report('load', err); });
  };

  return { play, stop, isRunning: () => !done };
}
