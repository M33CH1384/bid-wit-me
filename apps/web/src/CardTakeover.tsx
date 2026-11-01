import { useEffect, useState } from 'react';
import { cardDisplayName, rankGlyph } from './cardRank';
import { PlayerCard } from './profile/PlayerCard';
import type { RewardsData } from './GameOverRewards';

/**
 * Level-up CARD TAKEOVER (owner, 2026-10-29): "When the player reaches a
 * new level their card itself should enlarge and tilt toward the player
 * and to the right a bit covering most of the screen with a prominent
 * animation to go with it."
 *
 * When the postgame rewards grant a NEW CARD, the panel's static reveal
 * (CardUpRow) is followed by this takeover: the same PlayerCard, presented
 * heroically — risen from the report at near-screen size, leaned toward
 * the viewer (top edge coming at the player) and rotated a touch to the
 * right, under a stamped NEW CARD banner, with rays, a glow, a shine sweep
 * and sparkles in the house celebration vocabulary. It HOLDS until tapped;
 * tapping returns to the report, where the panel stays as the permanent
 * record. Transform/opacity only — no per-frame canvas painting.
 *
 * Firing discipline (reworked, owner 2026-11-01): DISMISSAL is the only
 * retirement. The key derives from the grant itself (the post-grant
 * level + rank step + progress), the same values the panel's NEW CARD
 * decision reads, and is marked DISMISSED in sessionStorage only when
 * the player taps it away. A refresh or remount while it is still
 * pending brings it back WITH its entrance — showing it spends nothing.
 * (The 2026-10-29 discipline marked the grant celebrated the moment the
 * takeover showed: a refreshed /rewards page lost the celebration
 * entirely, and when the entrance itself was spent unseen — below — the
 * player was left staring at a static card with no way back to the
 * show.) Reduced motion / Reduce-effects never see it at all: the
 * parent gates on the reveal hook's `reduced`, and the static panel is
 * the whole presentation there.
 */

export const CARD_TAKEOVER_DISMISSED_KEY = 'bwm.cardup.dismissed.v1';

/**
 * The beat after the reveal gate opens: the XP tween lands (~1.2s) and
 * the level bar's second leg settles into the new level (~1.9s) — the
 * takeover rises as the bar lands, so the sequence reads count → climb →
 * card. The CardUpRow panel has been on screen since ~0.7s.
 */
export const CARD_TAKEOVER_DELAY_MS = 1900;

/** How long the exit shrink/fade runs before the overlay unmounts. */
export const CARD_TAKEOVER_EXIT_MS = 420;

/** The grant this rewards data celebrates, or null when it grants none. */
export function cardTakeoverKey(d: RewardsData): string | null {
  if (!d.cardUp || !d.cardAfter || !d.rankAfter) return null;
  return `v1:${d.levelAfter}:${d.rankAfter.step}:${d.xpIntoLevel}`;
}

export function takeoverDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(CARD_TAKEOVER_DISMISSED_KEY) === key;
  } catch {
    return false; // storage blocked: dismissal is still state-held for this mount
  }
}

export function markTakeoverDismissed(key: string): void {
  try {
    sessionStorage.setItem(CARD_TAKEOVER_DISMISSED_KEY, key);
  } catch {
    /* best-effort — see takeoverDismissed */
  }
}

/**
 * The entrance gate (owner, 2026-11-01: "I never saw this animation it
 * just appeared like this"). The entrance is CSS keyframes, and a
 * keyframe timeline runs on the wall clock from the moment the element
 * is inserted — the parent's arming is a bare 1900 ms timer lit off the
 * report's reveal, so any span in which the webview paints no frames of
 * THIS surface (the app switched away mid-sequence, the surface covered)
 * burned the whole ~2.3 s show unseen and left the end state sitting
 * there. The stylesheet holds every takeover animation paused at its
 * first frame until this hook flips `rw-tko-play` — after the takeover
 * itself has painted two frames while the document is visible, the
 * same discipline the rewards reveal gate (useRewardsReveal) applies
 * to the page, applied here at the takeover level. If the document is
 * hidden when the takeover mounts, the flip waits for visibility; the
 * paused keyframes cannot advance in the meantime.
 */
function useTakeoverPlay(): boolean {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let offVis: (() => void) | null = null;
    const arm = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPlay(true));
      });
    };
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      const onVis = () => { if (document.visibilityState === 'visible') arm(); };
      document.addEventListener('visibilitychange', onVis);
      offVis = () => document.removeEventListener('visibilitychange', onVis);
    } else {
      arm();
    }
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); offVis?.(); };
  }, []);
  return play;
}

const SPARKS: { x: string; y: string; delay: string; size: string }[] = [
  { x: '14%', y: '26%', delay: '0s', size: '17px' },
  { x: '84%', y: '22%', delay: '.45s', size: '13px' },
  { x: '9%', y: '55%', delay: '.9s', size: '12px' },
  { x: '89%', y: '58%', delay: '.25s', size: '18px' },
  { x: '19%', y: '82%', delay: '1.15s', size: '13px' },
  { x: '79%', y: '85%', delay: '.65s', size: '15px' },
];

export function CardTakeover({ d, leaving, onDismiss }: {
  d: RewardsData;
  leaving: boolean;
  onDismiss: () => void;
}) {
  const play = useTakeoverPlay();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (!d.cardAfter || !d.rankAfter) return null;
  const from = d.rankBefore;
  const to = d.rankAfter;
  return (
    <div
      className={`rw-takeover${play ? ' rw-tko-play' : ''}${leaving ? ' leaving' : ''}`}
      data-testid="card-takeover"
      role="dialog"
      aria-modal="true"
      aria-label={`New card: ${cardDisplayName(to)}. Tap to continue.`}
      onClick={onDismiss}
    >
      <div className="rw-takeover-rays" aria-hidden="true" />
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="rw-takeover-spark"
          aria-hidden="true"
          style={{ left: s.x, top: s.y, animationDelay: s.delay, fontSize: s.size }}
        >
          ✦
        </span>
      ))}
      <div className="rw-takeover-banner">
        <div className="rw-takeover-head">{d.bigJokerUp ? '★ THE BIG JOKER ★' : 'NEW CARD'}</div>
        <div className="rw-takeover-flow">
          {from && (
            <>
              <span>{rankGlyph(from)} {cardDisplayName(from)}</span>
              <span className="rw-takeover-arrow" aria-hidden="true">→</span>
            </>
          )}
          <span className="is-new">{rankGlyph(to)} {cardDisplayName(to)}</span>
        </div>
      </div>
      <div className="rw-takeover-stage">
        <div className="rw-takeover-card">
          <PlayerCard data={d.cardAfter} variant="deck" />
          <div className="rw-takeover-shine" aria-hidden="true" />
        </div>
      </div>
      <div className="rw-takeover-hint">Tap to continue</div>
    </div>
  );
}
