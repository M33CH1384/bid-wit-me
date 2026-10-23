/**
 * Spray-paint screen transitions (owner, 2026-10-23): "animations when we
 * move from screen to screen — a quick animation of black spray paint
 * covering the screen."
 *
 * The model: a navigation that qualifies does not swap screens immediately.
 * The spray layer (SprayLayer.tsx, mounted once in Root) paints black spray
 * across the screen (~280 ms); at full cover the pending navigation mutation
 * runs underneath; then the paint dissolves off (~280 ms) revealing the new
 * screen. Input is locked by the layer only during the cover — during the
 * dissolve the new screen is already live under the clearing paint.
 *
 * This module is the controller + the eligibility rules; it knows nothing
 * about React. Callers wrap their screen swap in coverThen():
 *  - Root (main.tsx) defers eligible route swaps from its popstate handler —
 *    the single choke point every route change flows through (navigate()
 *    dispatches popstate; browser back/forward fires it natively).
 *  - Setup's wizard at its home boundary (home <-> setup steps).
 *  - StoryHome's screen changes (map / tape / intro / outro — never the
 *    table: any change touching 'game' is excluded by the caller).
 *  - The Social panel's open/close (social/store.ts).
 *
 * Hard rules baked in here:
 *  - No renderer mounted -> no transition: coverThen applies the mutation
 *    immediately. (Unit tests and any future surface without the layer keep
 *    today's synchronous behavior.)
 *  - Suppressed entirely by the player's own motion prefs: the explicit
 *    "Reduce effects" opt-in (fx.reduced) OR the OS reduce-motion setting
 *    (fx.osReducedMotion) — an instant cut, no paint.
 *  - A second navigation mid-spray never stacks or queues a second spray:
 *    during cover its mutation joins the pending flush; during the dissolve
 *    the paint snaps back to cover and the new swap rides the same episode.
 *  - FAILSAFE: a hard timer clears the layer and flushes any pending
 *    mutation no matter what — a stuck black screen must be impossible.
 *  - cancelSpray() flushes pending mutations and clears instantly; route
 *    changes that don't qualify (above all: entering a live table) call it
 *    so paint can never dissolve over a table.
 */
import { fx } from './fx';

export const SPRAY_COVER_MS = 280;
export const SPRAY_REVEAL_MS = 280;
export const SPRAY_FAILSAFE_MS = 1500;

export type SprayPhase = 'idle' | 'cover' | 'reveal';
export interface SpraySnapshot {
  phase: SprayPhase;
  /** performance.now() when the current phase began (canvas progress base) */
  phaseAt: number;
  /** coverage the current cover starts from (0 normally; >0 when a dissolve
   *  was snapped back into a cover by a second navigation) */
  fromCoverage: number;
  /** increments per spray episode so the layer can (re)start its paint loop */
  sprayId: number;
}

/** Live-table paths (mirrors online/nav.ts isOnlinePath's /t/CODE arm; kept
 *  local so this module never imports the router — the router and Root both
 *  depend on the spray, not the other way round). */
const TABLE_PATH_RE = /^\/t\/[^/]+\/?$/;

export function sprayRouteClass(path: string): 'menu' | 'table' {
  return TABLE_PATH_RE.test(path) ? 'table' : 'menu';
}

/**
 * Route-level eligibility: a spray fires only for a real change between two
 * menu-space screens. Entering a table (/t/CODE) never sprays — the seats
 * hold owns that moment and nothing may sit on the bid clock — and leaving
 * one keeps the table's own exit flows. Same-path "navigations" (a search
 * change Root doesn't route on) are no-ops. First load and deep-link
 * landings never reach this code: they mount with their path already set.
 */
export function sprayRouteEligible(fromPath: string, toPath: string): boolean {
  if (fromPath === toPath) return false;
  return sprayRouteClass(fromPath) === 'menu' && sprayRouteClass(toPath) === 'menu';
}

/** The player's motion prefs, via the one fx bus every effect reads. */
export function spraySuppressed(): boolean {
  try {
    return fx.reduced || fx.osReducedMotion;
  } catch {
    return false;
  }
}

let snapshot: SpraySnapshot = { phase: 'idle', phaseAt: 0, fromCoverage: 0, sprayId: 0 };
const subs = new Set<() => void>();
let pending: Array<() => void> = [];
let coverTimer: ReturnType<typeof setTimeout> | undefined;
let revealTimer: ReturnType<typeof setTimeout> | undefined;
let failsafeTimer: ReturnType<typeof setTimeout> | undefined;
let rendererMounted = false;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function emit(next: SpraySnapshot): void {
  snapshot = next;
  for (const f of [...subs]) f();
}

function clearTimers(): void {
  if (coverTimer !== undefined) clearTimeout(coverTimer);
  if (revealTimer !== undefined) clearTimeout(revealTimer);
  if (failsafeTimer !== undefined) clearTimeout(failsafeTimer);
  coverTimer = revealTimer = failsafeTimer = undefined;
}

function runMutations(ms: Array<() => void>): void {
  for (const m of ms) {
    try {
      m();
    } catch {
      /* a navigation mutation must never wedge the layer */
    }
  }
}

export function subscribeSpray(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function getSpraySnapshot(): SpraySnapshot {
  return snapshot;
}

/** The layer registers itself on mount. No registered renderer -> coverThen
 *  is a pass-through, so non-Root surfaces and tests stay synchronous. */
export function registerSprayRenderer(mounted: boolean): void {
  rendererMounted = mounted;
  if (!mounted) cancelSpray();
}

function startCover(mutate: () => void, fromCoverage: number): void {
  clearTimers();
  pending = [mutate];
  emit({ phase: 'cover', phaseAt: nowMs(), fromCoverage, sprayId: snapshot.sprayId + 1 });
  coverTimer = setTimeout(flushCover, SPRAY_COVER_MS);
  failsafeTimer = setTimeout(cancelSpray, SPRAY_FAILSAFE_MS);
}

function flushCover(): void {
  coverTimer = undefined;
  const ms = pending;
  pending = [];
  // Enter the dissolve BEFORE running the swaps: the paint is still full at
  // q=0 while React processes them, and a swap that itself navigates again
  // (coverThen from inside a mutation) cleanly re-covers from the reveal.
  emit({ phase: 'reveal', phaseAt: nowMs(), fromCoverage: 0, sprayId: snapshot.sprayId });
  revealTimer = setTimeout(endReveal, SPRAY_REVEAL_MS);
  runMutations(ms);
}

function endReveal(): void {
  revealTimer = undefined;
  if (failsafeTimer !== undefined) clearTimeout(failsafeTimer);
  failsafeTimer = undefined;
  emit({ phase: 'idle', phaseAt: nowMs(), fromCoverage: 0, sprayId: snapshot.sprayId });
}

/**
 * Run `mutate` (a screen swap) under a spray cover. Applies immediately when
 * suppressed or when no spray layer is mounted. During a cover the mutation
 * joins the pending flush; during a dissolve the paint snaps back to cover
 * and the mutation rides the same episode.
 */
export function coverThen(mutate: () => void): void {
  if (!rendererMounted || typeof window === 'undefined' || spraySuppressed()) {
    mutate();
    return;
  }
  if (snapshot.phase === 'cover') {
    pending.push(mutate);
    return;
  }
  if (snapshot.phase === 'reveal') {
    const dissolved = Math.min(1, Math.max(0, (nowMs() - snapshot.phaseAt) / SPRAY_REVEAL_MS));
    startCover(mutate, 1 - dissolved);
    return;
  }
  startCover(mutate, 0);
}

/** Flush any pending swap and clear the paint NOW (ineligible navigations —
 *  above all table entries — call this so a spray can never linger or
 *  dissolve over a screen it doesn't belong on). */
export function cancelSpray(): void {
  if (snapshot.phase === 'idle' && pending.length === 0) return;
  clearTimers();
  const ms = pending;
  pending = [];
  runMutations(ms);
  emit({ phase: 'idle', phaseAt: nowMs(), fromCoverage: 0, sprayId: snapshot.sprayId });
}
