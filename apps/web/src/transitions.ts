/**
 * Screen-transition family — program registry + shared controller
 * (owner, 2026-10-23: "Build them all").
 *
 * The spray-paint transition proved the shape on 2026-10-23; the owner
 * then asked for a family: destinations get their own signatures, all
 * built on the same compositor engine (the frame-loop lesson is law —
 * every program below is DOM/SVG animated by Web Animations tweens of
 * transform / opacity / clip-path / stroke-dashoffset over static
 * pre-rendered textures; no program paints a canvas per frame).
 *
 * THE REGISTRY — a move is classified, the theme skins it where the
 * class has theme variants, and ONE controller drives the chosen
 * program's cover -> swap -> hold -> reveal lifecycle:
 *
 *   move class       program (Classic / Neon)     where it plays
 *   ---------------  ---------------------------  ----------------------
 *   menu-nav         spray / ink bloom            menu-space route swaps
 *   screen           spray / ink bloom            in-place screen swaps
 *                                                 (Setup wizard boundary,
 *                                                 StoryHome moves, ...)
 *   profile-social   the Card Fan                 /profile routes + the
 *                                                 Social panel open/close
 *   table-entry      the Deal                     joining / starting a
 *                                                 regular table (special
 *                                                 lifecycle — see below)
 *   table-exit       the Book Sweep               leaving a table for
 *                                                 menu space
 *   story-entry      the Doorway                  entering Story Mode +
 *                                                 map -> a stop's screens
 *
 * Theme parity law: the theme changes VISUALS only — under Neon the
 * menu programs render ink instead of paint, with identical beats,
 * timings, and controller semantics (the ink spec IS the spray spec).
 *
 * Standing invariants for EVERY program (baked into this controller):
 *  - No renderer mounted -> no transition: coverThen applies the
 *    mutation immediately (unit tests and any surface without the
 *    layers keep synchronous behavior).
 *  - Suppressed entirely by the player's motion prefs: the explicit
 *    "Reduce effects" opt-in (fx.reduced) OR the OS reduce-motion
 *    setting (fx.osReducedMotion) — an instant cut, silently.
 *  - A second navigation mid-episode never stacks a second program:
 *    during cover its mutation joins the pending flush; during the
 *    reveal the cover snaps back and the new swap rides the same
 *    episode (the episode keeps its program — the paint on screen is
 *    the paint that snaps back).
 *  - FAILSAFE: a hard timer clears the layer and flushes any pending
 *    mutation no matter what, armed at the active program's failsafe
 *    budget, whose invariant is a MARGIN: it outlives the program's
 *    full cover + hold + reveal cycle by at least 500 ms. A stuck
 *    cover is the one unforgivable failure.
 *  - cancelTransitions() flushes pending mutations and clears
 *    instantly; navigations that don't qualify (above all, anything
 *    that could put a cover over a live table's bid clock) call it.
 *  - Input is locked by the layers only during a cover.
 *
 * This module knows nothing about React. Callers:
 *  - Root (main.tsx) classifies route swaps from its popstate handler —
 *    the single choke point every route change flows through
 *    (navigate() dispatches popstate; back/forward fires it natively).
 *  - Setup's wizard, StoryHome's goScreen, and the Social store wrap
 *    their in-place swaps in coverThen() with their move class.
 *  - Table entry calls coverTableEntry() (the Deal's ready-driven
 *    lifecycle) instead of coverThen — the table renders underneath
 *    immediately and the cover lifts on signalTableReady().
 *
 * spray.ts is the family's façade: it re-exports this controller under
 * the spray-era names the original call sites and tests use.
 */
import { fx } from './fx';
import { themeStore } from './theme';

export type MoveClass =
  | 'menu-nav'
  | 'screen'
  | 'profile-social'
  | 'table-entry'
  | 'table-exit'
  | 'story-entry';

export type TransitionProgramId = 'spray' | 'ink' | 'fan' | 'deal' | 'sweep' | 'doorway';

export interface ProgramSpec {
  /** Cover length. For the Deal: the minimum dwell before the cover
   *  may lift (readiness can hold it longer, up to the cap). */
  coverMs: number;
  /** Stillness at full cover between the swap and the reveal. */
  holdMs: number;
  /** Reveal length. */
  revealMs: number;
  /** Hard self-clear budget. Invariant: >= cover + hold + reveal + 500. */
  failsafeMs: number;
}

/* ------------------------------------------------------------------ */
/* The spray program's timing (owner-tuned 2026-10-23 across four     */
/* rounds: "slower, cleaner, bigger" — then the deeper spec).         */
/* TUNING RULE: if frame rate ever forces time back out of the spray, */
/* the FILL shortens first — the outline is the signature and its     */
/* length is protected.                                               */
/* ------------------------------------------------------------------ */
export const SPRAY_COVER_MS = 1310;
/** Cover beat 1: the can traces the spade's COMPLETE outline — the
 *  whole contour stands painted, interior still empty. */
export const SPRAY_OUTLINE_MS = 590;
/** Cover beat 2: the spade's interior sprays in, behind a soft moving
 *  front. Beat 3 — the bloom out to full screen — takes the rest of
 *  the cover. The beats never overlap (owner, on v2's overlapped tag:
 *  "it fills in instead of spraying the outline then filling the
 *  rest"). */
export const SPRAY_FILL_MS = 470;
/** The full spade sequence (outline + interior); the bloom starts here. */
export const SPRAY_SPADE_MS = SPRAY_OUTLINE_MS + SPRAY_FILL_MS;
/** The beat of stillness at full black between the swap and the
 *  dissolve. */
export const SPRAY_HOLD_MS = 90;
export const SPRAY_REVEAL_MS = 390;
/** The failsafe's invariant is a MARGIN, not a number: it outlives a
 *  full cover + hold + reveal cycle by at least 500 ms, so it scaled
 *  with every slow-down (1500 -> 1900 -> 2300). */
export const SPRAY_FAILSAFE_MS = 2300;

/** The Deal's readiness cap: if the table somehow isn't ready by
 *  then, the cover lifts anyway onto the seats hold — the player is
 *  never trapped behind dealt cards. */
export const DEAL_READY_CAP_MS = 4000;

export const PROGRAM_SPECS: Record<TransitionProgramId, ProgramSpec> = {
  spray: { coverMs: SPRAY_COVER_MS, holdMs: SPRAY_HOLD_MS, revealMs: SPRAY_REVEAL_MS, failsafeMs: SPRAY_FAILSAFE_MS },
  /* Ink Bloom is the spray PROGRAM re-skinned for Neon (theme parity:
   * identical beats and timings) — its spec is the spray spec. */
  ink: { coverMs: SPRAY_COVER_MS, holdMs: SPRAY_HOLD_MS, revealMs: SPRAY_REVEAL_MS, failsafeMs: SPRAY_FAILSAFE_MS },
  /* The Card Fan is brisker than the spray: a riffle, not a mural. */
  fan: { coverMs: 420, holdMs: 40, revealMs: 390, failsafeMs: 1400 },
  /* The Deal: coverMs is the minimum dwell; the cover then waits on
   * the table's ready signal up to DEAL_READY_CAP_MS. The failsafe
   * clears cap + reveal with the standing 500 ms margin to spare. */
  deal: { coverMs: 700, holdMs: 0, revealMs: 450, failsafeMs: DEAL_READY_CAP_MS + 450 + 550 },
  /* The Book Sweep: the scoop across, the swap, the settle off. */
  sweep: { coverMs: 460, holdMs: 40, revealMs: 450, failsafeMs: 1500 },
  /* The Doorway takes its time — it is a threshold, not a wipe. */
  doorway: { coverMs: 620, holdMs: 100, revealMs: 480, failsafeMs: 1750 },
};

/**
 * Resolve a move class to its program. The theme skins only the
 * menu-space classes (spray <-> ink); every other program is itself
 * under both themes (the Fan may tint under Neon — a visual detail of
 * its layer, not a different program).
 */
export function resolveProgram(moveClass: MoveClass): TransitionProgramId {
  switch (moveClass) {
    case 'profile-social':
      return 'fan';
    case 'table-entry':
      return 'deal';
    case 'table-exit':
      return 'sweep';
    case 'story-entry':
      return 'doorway';
    case 'menu-nav':
    case 'screen':
    default:
      return themeStore.get() === 'neon' ? 'ink' : 'spray';
  }
}

/* ------------------------------------------------------------------ */
/* Route classification (Root's choke point).                          */
/* ------------------------------------------------------------------ */

/** Live-table paths (mirrors online/nav.ts isOnlinePath's /t/CODE arm;
 *  kept local so this module never imports the router — the router and
 *  Root both depend on the transitions, not the other way round). */
const TABLE_PATH_RE = /^\/t\/[^/]+\/?$/;

export function routeClass(path: string): 'menu' | 'table' {
  return TABLE_PATH_RE.test(path) ? 'table' : 'menu';
}

/**
 * Route-level spray eligibility (the family's original rule, kept for
 * the façade): a transition fires only for a real change between two
 * menu-space screens. Entering or leaving a table is NOT eligible here
 * — those moves carry their own classes (table-entry / table-exit) —
 * and same-path "navigations" are no-ops. First load and deep-link
 * landings never reach this code: they mount with their path set.
 */
export function routeEligible(fromPath: string, toPath: string): boolean {
  if (fromPath === toPath) return false;
  return routeClass(fromPath) === 'menu' && routeClass(toPath) === 'menu';
}

/**
 * Classify a route change into its move class (null = no transition:
 * same-path no-ops and table-to-table hops). Destination wins where
 * classes could compete: entering Story Mode is a Doorway even from
 * the profile, and entering a table is a Deal from anywhere in menu
 * space.
 */
export function routeMoveClass(fromPath: string, toPath: string): MoveClass | null {
  if (fromPath === toPath) return null;
  const fromCls = routeClass(fromPath);
  const toCls = routeClass(toPath);
  if (toCls === 'table') return fromCls === 'table' ? null : 'table-entry';
  if (fromCls === 'table') return 'table-exit';
  if (toPath === '/story') return 'story-entry';
  if (fromPath === '/profile' || toPath === '/profile') return 'profile-social';
  return 'menu-nav';
}

/** The player's motion prefs, via the one fx bus every effect reads. */
export function transitionsSuppressed(): boolean {
  try {
    return fx.reduced || fx.osReducedMotion;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* The controller.                                                     */
/* ------------------------------------------------------------------ */

export type TransitionPhase = 'idle' | 'cover' | 'reveal';
export interface TransitionSnapshot {
  phase: TransitionPhase;
  /** performance.now() when the current phase began (animation progress base) */
  phaseAt: number;
  /** coverage the current cover starts from (0 normally; >0 when a
   *  reveal was snapped back into a cover by a second navigation) */
  fromCoverage: number;
  /** increments per episode so layers can (re)start their animations */
  episodeId: number;
  /** the program this episode is running */
  program: TransitionProgramId;
}

let snapshot: TransitionSnapshot = {
  phase: 'idle',
  phaseAt: 0,
  fromCoverage: 0,
  episodeId: 0,
  program: 'spray',
};
const subs = new Set<() => void>();
let pending: Array<() => void> = [];
let coverTimer: ReturnType<typeof setTimeout> | undefined;
let revealTimer: ReturnType<typeof setTimeout> | undefined;
let failsafeTimer: ReturnType<typeof setTimeout> | undefined;
let rendererMounted = false;
/* The Deal's readiness state (meaningful only during a deal cover). */
let dealReady = false;
let dealDwellDone = false;
let dealCapTimer: ReturnType<typeof setTimeout> | undefined;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function emit(next: TransitionSnapshot): void {
  snapshot = next;
  for (const f of [...subs]) f();
}

function clearTimers(): void {
  if (coverTimer !== undefined) clearTimeout(coverTimer);
  if (revealTimer !== undefined) clearTimeout(revealTimer);
  if (failsafeTimer !== undefined) clearTimeout(failsafeTimer);
  if (dealCapTimer !== undefined) clearTimeout(dealCapTimer);
  coverTimer = revealTimer = failsafeTimer = dealCapTimer = undefined;
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

export function subscribeTransitions(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function getTransitionSnapshot(): TransitionSnapshot {
  return snapshot;
}

/** A layer registers itself on mount. No registered renderer ->
 *  coverThen is a pass-through, so non-Root surfaces and tests stay
 *  synchronous. */
export function registerTransitionRenderer(mounted: boolean): void {
  rendererMounted = mounted;
  if (!mounted) cancelTransitions();
}

function activeSpec(): ProgramSpec {
  return PROGRAM_SPECS[snapshot.program];
}

function startCover(mutate: () => void, fromCoverage: number, program: TransitionProgramId): void {
  clearTimers();
  pending = [mutate];
  const spec = PROGRAM_SPECS[program];
  emit({ phase: 'cover', phaseAt: nowMs(), fromCoverage, episodeId: snapshot.episodeId + 1, program });
  coverTimer = setTimeout(flushCover, spec.coverMs);
  failsafeTimer = setTimeout(cancelTransitions, spec.failsafeMs);
}

function flushCover(): void {
  coverTimer = undefined;
  const ms = pending;
  pending = [];
  const spec = activeSpec();
  // Enter the reveal BEFORE running the swaps: the cover is still full
  // at q=0 while React processes them, and a swap that itself navigates
  // again (coverThen from inside a mutation) cleanly re-covers from
  // the reveal. The reveal phase opens with the program's HOLD: the
  // layer keeps the cover at full for spec.holdMs (the swap lands under
  // it) and only then starts clearing — so this timer covers hold +
  // reveal.
  emit({ phase: 'reveal', phaseAt: nowMs(), fromCoverage: 0, episodeId: snapshot.episodeId, program: snapshot.program });
  revealTimer = setTimeout(endReveal, spec.holdMs + spec.revealMs);
  runMutations(ms);
}

function endReveal(): void {
  revealTimer = undefined;
  if (failsafeTimer !== undefined) clearTimeout(failsafeTimer);
  failsafeTimer = undefined;
  emit({ phase: 'idle', phaseAt: nowMs(), fromCoverage: 0, episodeId: snapshot.episodeId, program: snapshot.program });
}

/**
 * Run `mutate` (a screen swap) under the cover of the program its move
 * class resolves to. Applies immediately when suppressed or when no
 * layer is mounted. During a cover the mutation joins the pending
 * flush; during a reveal the cover snaps back and the mutation rides
 * the same episode (keeping the episode's program).
 */
export function coverThen(mutate: () => void, moveClass: MoveClass = 'screen'): void {
  if (!rendererMounted || typeof window === 'undefined' || transitionsSuppressed()) {
    mutate();
    return;
  }
  if (snapshot.phase === 'cover') {
    if (snapshot.program === 'deal') {
      // A deal cover holds no pending swap to join (the table is
      // already rendering underneath it). A navigation out from under
      // the deal ends the ceremony and starts its own episode.
      endDealNow();
    } else {
      pending.push(mutate);
      return;
    }
  }
  if (snapshot.phase === 'reveal') {
    if (snapshot.program === 'deal') {
      // The Deal has no cover to snap back INTO (its cards lifting is
      // the end of the ceremony): a navigation during the lift ends
      // the episode and starts its own.
      endDealNow();
      startCover(mutate, 0, resolveProgram(moveClass));
      return;
    }
    // The reveal opens with the hold, so the dissolved fraction is
    // measured from the hold's end (and clamps to 0 during it: a
    // navigation inside the hold re-covers from full coverage).
    const spec = activeSpec();
    const dissolved = Math.min(
      1,
      Math.max(0, (nowMs() - snapshot.phaseAt - spec.holdMs) / spec.revealMs),
    );
    startCover(mutate, 1 - dissolved, snapshot.program);
    return;
  }
  startCover(mutate, 0, resolveProgram(moveClass));
}

/**
 * Flush any pending swap and clear the cover NOW (ineligible
 * navigations call this so a transition can never linger or dissolve
 * over a screen it doesn't belong on).
 */
export function cancelTransitions(): void {
  if (snapshot.phase === 'idle' && pending.length === 0) return;
  clearTimers();
  const ms = pending;
  pending = [];
  dealReady = false;
  dealDwellDone = false;
  runMutations(ms);
  emit({ phase: 'idle', phaseAt: nowMs(), fromCoverage: 0, episodeId: snapshot.episodeId, program: snapshot.program });
}

/* ------------------------------------------------------------------ */
/* The Deal — table entry's ready-driven lifecycle.                    */
/*                                                                     */
/* Unlike the cover programs, the Deal's swap is NOT deferred: the     */
/* caller applies its navigation immediately (the table and its seats  */
/* hold render underneath), and the dealt cards cover the entry until  */
/* BOTH the minimum dwell has passed AND the table has signalled       */
/* ready via signalTableReady() — or the readiness cap forces the      */
/* lift onto whatever hold the table itself is showing.                */
/* ------------------------------------------------------------------ */

function endDealNow(): void {
  // Cut the ceremony: clear straight to idle (any reveal is skipped —
  // the screen underneath is either the table being abandoned or the
  // destination a newer navigation already chose).
  clearTimers();
  dealReady = false;
  dealDwellDone = false;
  emit({ phase: 'idle', phaseAt: nowMs(), fromCoverage: 0, episodeId: snapshot.episodeId, program: snapshot.program });
}

function releaseDeal(): void {
  if (snapshot.phase !== 'cover' || snapshot.program !== 'deal') return;
  if (dealCapTimer !== undefined) clearTimeout(dealCapTimer);
  dealCapTimer = undefined;
  if (coverTimer !== undefined) clearTimeout(coverTimer);
  coverTimer = undefined;
  const spec = PROGRAM_SPECS.deal;
  emit({ phase: 'reveal', phaseAt: nowMs(), fromCoverage: 0, episodeId: snapshot.episodeId, program: 'deal' });
  revealTimer = setTimeout(endReveal, spec.holdMs + spec.revealMs);
}

/**
 * Begin a Deal cover for a table entry whose navigation the caller has
 * ALREADY applied (or is applying in the same breath). Any episode in
 * flight is flushed and cleared first — the older swap lands, then the
 * table's render replaces it under the cards. No-op when suppressed or
 * when no layer is mounted: the table's own seats hold is the entry
 * experience then, exactly as before the Deal existed.
 */
export function coverTableEntry(): void {
  if (!rendererMounted || typeof window === 'undefined' || transitionsSuppressed()) return;
  if (snapshot.phase !== 'idle') cancelTransitions();
  clearTimers();
  pending = [];
  dealReady = false;
  dealDwellDone = false;
  const spec = PROGRAM_SPECS.deal;
  emit({ phase: 'cover', phaseAt: nowMs(), fromCoverage: 0, episodeId: snapshot.episodeId + 1, program: 'deal' });
  coverTimer = setTimeout(() => {
    coverTimer = undefined;
    dealDwellDone = true;
    if (dealReady) releaseDeal();
  }, spec.coverMs);
  dealCapTimer = setTimeout(() => {
    dealCapTimer = undefined;
    releaseDeal();
  }, DEAL_READY_CAP_MS);
  failsafeTimer = setTimeout(cancelTransitions, spec.failsafeMs);
}

/**
 * The table's ready signal: its seats hold has lifted and the table is
 * interactive. Releases the Deal once the minimum dwell has also
 * passed; a no-op outside a deal cover, so every hold can signal
 * freely and the first signal that matters wins.
 */
export function signalTableReady(): void {
  if (snapshot.phase !== 'cover' || snapshot.program !== 'deal') return;
  dealReady = true;
  if (dealDwellDone) releaseDeal();
}
