/**
 * Flip hold — never present a cleared canvas across a rotation (owner device
 * report, 2026-10-29, round 3: "the first time I flipped to landscape the
 * screen went black outside of the scoreboard and plates").
 *
 * Why the black frame exists: committing a new size to the R3F store resets
 * the WebGL drawing buffer (width/height assignment clears it). Until the
 * scene's first frame at the new size has rendered AND presented, the
 * compositor shows that cleared buffer — black — inside the (already
 * rotated) DOM chrome. On a warm flip the gap is a frame or two; on the
 * FIRST flip at a table it is worse, because the alternate orientation's
 * buffer size and first full-size raster have never been trodden.
 *
 * The hold: the instant a flip-class size commit is about to happen (called
 * synchronously from SizeLeader BEFORE setSize, plus an orientationchange
 * early-arm), we force one synchronous render and copy the canvas into a 2D
 * overlay stretched over the wrap — the same render-then-capture pattern the
 * feedback SnapHook uses, which is guaranteed to read the just-rendered
 * frame because the buffer has not been composited yet. The overlay stays
 * up until a frame rendered at the target size has presented (the
 * PresentedProbe's useFrame tick + one rAF), with a hard failsafe so a
 * missed signal can never leave a frozen table on screen.
 *
 * This module is the shared state only — no React, no DOM creation. The
 * overlay canvas element is owned by FlipCoverOverlay in Scene.tsx and
 * registered here; capture is a no-op until it registers.
 */

export interface FlipRendererLike {
  domElement: HTMLCanvasElement;
  render(scene: unknown, camera: unknown): void;
}

interface HoldState {
  /** Generation counter: each capture supersedes the last. */
  gen: number;
  /** Whether the overlay is currently up. */
  held: boolean;
  /** Target CSS size the scene must present at before release (0 = any). */
  targetW: number;
  targetH: number;
  /** Frames presented (any size) since the capture — release fallback. */
  framesSince: number;
  /** A real user flip has committed at least once this mount. */
  userFlipped: boolean;
  /** While locked (orientation rehearsal), presented frames never release. */
  locked: boolean;
  /** The orientation rehearsal has trodden the alternate size. */
  rehearsed: boolean;
  /** Failsafe timer id. */
  timer: number;
}

const state: HoldState = {
  gen: 0, held: false, targetW: 0, targetH: 0,
  framesSince: 0, userFlipped: false, locked: false, rehearsed: false, timer: 0,
};

let coverEl: HTMLCanvasElement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Test/debug probe (same spirit as __bwmSnap): lets the rig prove the hold. */
function publishProbe(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __bwmFlipHold?: unknown }).__bwmFlipHold = {
    held: state.held, gen: state.gen, userFlipped: state.userFlipped, rehearsed: state.rehearsed,
  };
}

/** FlipCoverOverlay registers its canvas here (and unregisters on unmount). */
export function registerCover(el: HTMLCanvasElement | null): void {
  coverEl = el;
  if (!el && state.held) { state.held = false; if (state.timer) window.clearTimeout(state.timer); state.timer = 0; }
  publishProbe();
}

export function subscribeFlipHold(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function flipHeld(): boolean { return state.held; }
export function flipUserFlipped(): boolean { return state.userFlipped; }
export function flipRehearsed(): boolean { return state.rehearsed; }
export function markRehearsed(): void { state.rehearsed = true; publishProbe(); }

/**
 * Capture the live canvas into the overlay and hold it. MUST be called
 * synchronously before the buffer reset it covers: it renders one frame
 * first, so the copy reads a real frame even mid-demand-loop. No-ops when
 * the overlay is not mounted or the canvas has no size yet.
 */
export function captureFlipFrame(gl: FlipRendererLike, scene: unknown, camera: unknown): boolean {
  const cover = coverEl;
  if (!cover || typeof document === 'undefined') return false;
  const src = gl.domElement;
  if (!(src.width > 0 && src.height > 0)) return false;
  try { gl.render(scene, camera); } catch { return false; }
  const ctx = cover.getContext('2d');
  if (!ctx) return false;
  cover.width = src.width;
  cover.height = src.height;
  try { ctx.drawImage(src, 0, 0); } catch { return false; }
  state.gen += 1;
  state.held = true;
  state.framesSince = 0;
  if (state.timer) window.clearTimeout(state.timer);
  // Failsafe: a frozen table is worse than a brief black frame — if the
  // presented-frame signal never lands, drop the cover on a hard deadline.
  state.timer = window.setTimeout(() => { state.timer = 0; releaseFlipHold(); }, 1200);
  publishProbe();
  emit();
  return true;
}

/**
 * SizeLeader calls this BEFORE setSize on a flip-class commit: records the
 * size the scene must present at, and flags that a real flip happened (the
 * rehearsal stands down once the genuine path has been trodden).
 */
export function noteFlipSizeCommit(w: number, h: number): void {
  state.targetW = w;
  state.targetH = h;
  state.userFlipped = true;
  state.locked = false; // a real flip supersedes any rehearsal hold
  publishProbe();
}

/** The rehearsal locks its hold so only it (or a real flip) can release. */
export function setFlipHoldLock(on: boolean): void { state.locked = on; }

/**
 * The rehearsal's own size commits are not user flips: this re-targets the
 * hold without setting userFlipped, so it can restore the original size.
 */
export function noteRehearsalSize(w: number, h: number): void {
  state.targetW = w;
  state.targetH = h;
  publishProbe();
}

/**
 * PresentedProbe feeds this from useFrame (which runs inside the frame that
 * then renders): once a frame has run at the target size — or a few frames
 * at any size, for holds with no size commit behind them — the new frame is
 * about to present, so the cover releases on the next rAF (post-present).
 */
export function notePresentedFrame(w: number, h: number): void {
  if (!state.held) return;
  state.framesSince += 1;
  if (state.locked) return;
  const atTarget = state.targetW > 0
    ? Math.abs(w - state.targetW) < 1 && Math.abs(h - state.targetH) < 1
    : state.framesSince >= 2;
  if (atTarget || state.framesSince >= 4) {
    const gen = state.gen;
    requestAnimationFrame(() => { if (state.gen === gen) releaseFlipHold(); });
  }
}

/** Drop the overlay. Safe to call any time. */
export function releaseFlipHold(): void {
  if (!state.held) return;
  state.held = false;
  state.locked = false;
  state.targetW = 0;
  state.targetH = 0;
  if (state.timer) { window.clearTimeout(state.timer); state.timer = 0; }
  publishProbe();
  emit();
}
