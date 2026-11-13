/**
 * The nuke clearance gate (owner rule, 2026-11-06): after a nuked trick,
 * players wait until the explosion has FULLY cleared before the next card
 * is thrown. The designed trick hold (finishedTrickHoldMs — TRICK_HOLD_MS
 * + NUKE_ALLOWANCE_MS) remains the minimum and the outer shape; this gate
 * only ever EXTENDS the pause past it while the blast episode is still
 * open on this client, because the blast runs on a presented clock that
 * stretches under load while the bare hold is a wall-clock timer — a card
 * thrown into the still-running blast is blown off the felt and never
 * appears (the defect this fixes). The wait is capped: if the blast's
 * completion signal never arrives, the turn still opens — a delayed turn
 * is acceptable, a permanently stuck table is not.
 */
export const NUKE_CLEARANCE_CAP_MS = 12_000;

const POLL_MS = 100;

/**
 * Release `onRelease` after `holdMs`, and — when `gated` (the finished
 * trick was a nuke this client shows) — not before `episodeOpen()` reads
 * false. Returns a cancel function; a cancelled gate never releases.
 */
export function releaseAfterNukeClearance(opts: {
  holdMs: number;
  gated: boolean;
  episodeOpen: () => boolean;
  onRelease: () => void;
  capMs?: number;
}): () => void {
  const capMs = opts.capMs ?? NUKE_CLEARANCE_CAP_MS;
  let released = false;
  let cancelled = false;
  let iv: ReturnType<typeof setInterval> | undefined;
  let capT: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(holdT);
    if (iv !== undefined) clearInterval(iv);
    if (capT !== undefined) clearTimeout(capT);
  };
  const release = () => {
    if (released || cancelled) return;
    released = true;
    cleanup();
    opts.onRelease();
  };
  const holdT = setTimeout(() => {
    if (!opts.gated || !opts.episodeOpen()) { release(); return; }
    capT = setTimeout(release, capMs);
    iv = setInterval(() => { if (!opts.episodeOpen()) release(); }, POLL_MS);
  }, opts.holdMs);
  return () => { cancelled = true; cleanup(); };
}
