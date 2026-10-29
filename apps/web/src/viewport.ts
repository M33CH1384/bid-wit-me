import { useEffect, useState } from 'react';

/** Phone in landscape (short + wide): gets its own HUD + 3D framing. */
export const isShortLandscape = (w: number, h: number) => w > h * 1.25 && h <= 540;

export interface Viewport { w: number; h: number; short: boolean; safe: { l: number; r: number; t: number; b: number } }

function read(probe: HTMLElement | null): Viewport {
  const w = window.innerWidth, h = window.innerHeight;
  let safe = { l: 0, r: 0, t: 0, b: 0 };
  if (probe) {
    const cs = getComputedStyle(probe);
    safe = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
  }
  // Automated-check seam (like sound.testState): an e2e can inject a real iPhone's safe-area bottom
  // (home indicator ~34px) that desktop WebKit reports as 0, so chrome coverage is actually tested.
  const injected = (window as unknown as { __bwmSafeBottom?: unknown }).__bwmSafeBottom;
  if (typeof injected === 'number' && Number.isFinite(injected) && injected > safe.b) safe = { ...safe, b: injected };
  return { w, h, short: isShortLandscape(w, h), safe };
}

/**
 * Viewport size + iOS safe-area insets (env(safe-area-inset-*)), live on resize / rotation.
 *
 * Rotation perf (owner device report, 2026-10-29: "lags extremely bad when
 * switching between portrait and landscape"): a rotation is not one event —
 * window resize, orientationchange and a stream of visualViewport resizes
 * (Safari chrome retracting) all fire, and the old hook committed a fresh
 * Viewport object for EVERY one, re-rendering the whole table (and with it
 * the 3D scene's prop tree) dozens of times per flip. Two guards now:
 *  - events are coalesced through one rAF, so a burst costs one read;
 *  - a read commits only when something the table actually consumes moved:
 *    the `short` landscape class or a safe-area inset. Pixel-only size
 *    wiggles (chrome show/hide mid-rotation) are layout's job (dvh/CSS), not
 *    React's — no consumer reads w/h off this record (Table takes short +
 *    safe only), so w/h ride along with the last meaningful commit.
 *
 * Rotation convergence (owner follow-up, same day: after the lag fix the
 * flip converged but LATE — "after a while it expands"): the guards above
 * made the commit wait on the event stream + a rAF, and on a real phone
 * both arrive late — Safari holds the old innerWidth until the rotation
 * animation is well along, rAF delivery stalls mid-rotation, and the last
 * safe-area change trails the stream. So convergence is now leading-edge:
 *  - when an event's live geometry already shows the aspect class flipped
 *    vs the committed record, the gated commit runs SYNCHRONOUSLY in the
 *    handler — the new orientation never waits on a frame;
 *  - orientationchange (and an aspect-mismatched event) arms a short
 *    settle chain of timed gated commits (90→800ms): if the browser is
 *    still holding stale geometry when the event fires, the chain catches
 *    the moment the live geometry lands, event or no event. Each tick is
 *    one gated read — a no-op once settled;
 *  - a trailing net re-checks ~700ms after the last event of a burst (and
 *    re-arms while commits keep landing, capped) so a late safe-area-only
 *    drift after the stream still converges exactly.
 * The storm collapse is untouched: pixel-only wiggles still never commit,
 * and the aspect class can only flip once per rotation, so a flip still
 * costs ~one table re-render.
 */
/**
 * Session memory of safe-area insets per orientation class (rotation round
 * 3): insets are a property of (device, orientation), so once a class has
 * been measured, a flip can commit that class's insets atomically with the
 * flip itself instead of trailing them in a later commit that shifts
 * inset-driven layout after the table has landed. The settle chain still
 * verifies against the live env() probe and corrects any surprise.
 */
const safeByClass = new Map<boolean, Viewport['safe']>();

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => read(null));
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    let raf = 0;
    let committed: Viewport | null = null;
    let chain: number[] = [];
    let net = 0;
    let netHops = 0;
    // The gated commit: publish only when something the table consumes
    // moved. Returns true when a commit landed.
    const commit = () => {
      raf = 0;
      let next = read(probe);
      // Rotation round 3 (owner: warm flips "not perfect"): the flip commit
      // landed the new orientation class at the swap, but the insets trailed
      // in a later commit, so inset-driven layout (badge plates, fan
      // reserve) shifted a beat AFTER the table had landed. When this
      // session has already measured the target class, commit ITS insets
      // with the flip — one atomic commit at final positions; the settle
      // chain then verifies against the probe and corrects only surprises.
      // A class's first visit has no memory and behaves exactly as before.
      if (committed && next.short !== committed.short) {
        const mem = safeByClass.get(next.short);
        if (mem) next = { ...next, safe: mem };
      }
      if (committed && next.short === committed.short
        && next.safe.l === committed.safe.l && next.safe.r === committed.safe.r
        && next.safe.t === committed.safe.t && next.safe.b === committed.safe.b) return false;
      committed = next;
      safeByClass.set(next.short, next.safe);
      setVp(next);
      return true;
    };
    const stopChain = () => { chain.forEach((t) => window.clearTimeout(t)); chain = []; };
    const armChain = () => {
      stopChain();
      chain = [90, 200, 350, 550, 800].map((ms) => window.setTimeout(() => { commit(); }, ms));
    };
    const armNet = () => {
      if (net) window.clearTimeout(net);
      net = window.setTimeout(() => {
        net = 0;
        // A commit landing this late means geometry was still moving after
        // the stream — check once more shortly after, a few times at most.
        if (commit() && netHops < 3) { netHops += 1; armNet(); }
      }, 700);
    };
    const on = () => {
      // Leading edge: the live aspect class already flipped — commit now,
      // synchronously, and let the settle chain mop up any trailing drift.
      if (!committed || isShortLandscape(window.innerWidth, window.innerHeight) !== committed.short) {
        commit();
        armChain();
        armNet();
        return;
      }
      if (!raf) raf = requestAnimationFrame(commit);
      armNet();
    };
    const onFlip = () => {
      // At orientationchange the geometry is usually still the OLD one —
      // the gated commit no-ops and the chain catches the landing moment.
      commit();
      armChain();
      armNet();
    };
    commit(); // the mount read always commits (real insets replace the safe-less initial state)
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', onFlip);
    // Safari's bottom chrome shows/hides with scroll/gesture: innerHeight/dvh lag visualViewport.
    window.visualViewport?.addEventListener('resize', on);
    return () => { if (raf) cancelAnimationFrame(raf); stopChain(); if (net) window.clearTimeout(net); window.removeEventListener('resize', on); window.removeEventListener('orientationchange', onFlip); window.visualViewport?.removeEventListener('resize', on); probe.remove(); };
  }, []);
  return vp;
}
