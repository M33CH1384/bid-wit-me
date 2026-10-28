import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import './animfx.css';
import { setAnimForStop, type FinaleHeadline } from '../setAnims';

/**
 * The per-stop SET cover on a recap scorecard (owner, 2026-10-21): replaces
 * the retired caution tape (regular tier) and white sheet (finale tier) in
 * the slot those treatments used to occupy — over the card's background,
 * under its text, so names and scores stay readable. Synthesized CSS/SVG
 * only, no assets. Fresh = the animation plays; static = the end state
 * (an eliminated side's card keeps wearing its finale on later recaps).
 * Reduced effects (Settings / OS) collapse fresh to the static end state
 * plus the name tag, the same bargain the other animfx moments make.
 *
 * The component returns a FRAGMENT: the cover art (an absolutely
 * positioned layer clipped to the card face) plus, on the finale tier,
 * the verdict plaque as a FLOW sibling. The plaque used to be an
 * absolutely-positioned child of the cover, where it landed across the
 * card's score line and buried the points (owner's Rec Center shotOut
 * screenshot, 2026-10-21: SET watermark + SHOT OUT chip + SHOT OUT plaque
 * stacked on one card). As a grid row of the face it owns real layout
 * space — the card's one verdict voice, never an overlay.
 */

const Bird = ({ i }: { i: number }) => (
  <svg className="sc-bird" style={{ '--i': i } as CSSProperties} viewBox="0 0 22 12" aria-hidden="true">
    <path d="M1 9 Q6 2 11 9 Q16 2 21 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const Chair = ({ i }: { i: number }) => (
  <svg className="sc-chair" style={{ '--i': i } as CSSProperties} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3v18M7 9h10M17 9l-3 6M7 15h8M14 15l3 6M10 21l2-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* Wave C (Animation Replacement Program §A4): every cover's art gains its
 * material sub-elements — the dust a slammed door throws, the books that
 * slide out under it, the cape's neck strip, the buzzer's lamp, the grill's
 * ember bed, the gate's top rail, the flock's city haze, the elevator's
 * floor ticker, the Pj's one lit window, the Legends frame the rope lines
 * draw inside, the King's beam cone and its dust motes. All placement is
 * index-seeded (--i) — deterministic, no runtime randomness — and every
 * finale-only class from the shipped roster stays finale-only. */
const ART: Record<string, (finale: boolean) => ReactNode> = {
  porch: () => (
    <>
      <div className="sc-light" />
      <div className="sc-door"><i className="sc-mesh" /><i className="sc-door-bar" /></div>
      <i className="sc-dust" /><i className="sc-dust" /><i className="sc-dust" />
      <div className="sc-books"><i /><i /><i /></div>
    </>
  ),
  barbershop: (finale) => (
    <>
      <div className="sc-pole"><i /></div>
      <div className="sc-cape"><i className="sc-neck" /></div>
      <span className="sc-word">{finale ? 'CLOSED' : 'NEXT!'}</span>
    </>
  ),
  'rec-center': (finale) => (
    <>
      <div className="sc-buzz" />
      <i className="sc-lamp" />
      <div className="sc-banner"><b>SET</b><span className="sc-clock">0.0</span>{finale && <em>GAME</em>}</div>
    </>
  ),
  cookout: (finale) => (
    <>
      {finale && <div className="sc-lid"><span>LID CLOSED</span></div>}
      <div className="sc-ember" />
      <i className="sc-puff" /><i className="sc-puff dark" /><i className="sc-puff" /><i className="sc-puff" /><i className="sc-puff dark" />
      <svg className="sc-tongs" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 3 L12 15 M19 3 L12 15 M12 15 L12 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M3 3 h4 M17 3 h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </>
  ),
  corner: (finale) => (
    <>
      <div className="sc-rail" />
      <div className="sc-shutter"><i className="sc-shutter-bar" /></div>
      {finale && (
        <>
          <svg className="sc-lock" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <rect x="5" y="11" width="14" height="9" rx="1.5" fill="currentColor" />
            <circle cx="12" cy="15.4" r="1.7" fill="#1c1710" />
          </svg>
          <span className="sc-closed-tag">CLOSED</span>
        </>
      )}
    </>
  ),
  'church-basement': (finale) => (
    <>
      {finale && <div className="sc-halo" />}
      {finale && <span className="sc-exit">EXIT</span>}
      <Chair i={0} /><Chair i={1} /><Chair i={2} />
      <span className="sc-word soft">SERVICE OVER</span>
    </>
  ),
  rooftop: (finale) => (
    <>
      <div className="sc-dusk" />
      <div className="sc-haze" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <Bird key={i} i={i} />)}
      {finale && [7, 8, 9, 10].map((i) => <Bird key={i} i={i} />)}
      {finale && <i className="sc-feather" />}
    </>
  ),
  'high-rise': (finale) => (
    <>
      <div className="sc-elev-l" /><div className="sc-elev-r" /><i className="sc-seam" />
      <div className="sc-floors" aria-hidden="true">
        <span style={{ '--i': 0 } as CSSProperties}>9</span>
        <span style={{ '--i': 1 } as CSSProperties}>6</span>
        <span style={{ '--i': 2 } as CSSProperties}>3</span>
        <span className="last" style={{ '--i': 3 } as CSSProperties}>{finale ? 'L' : '▼'}</span>
      </div>
      <div className="sc-floor">{finale ? '▼ L · LOBBY' : '▼ GOING DOWN'}</div>
    </>
  ),
  'the-pjs': () => (
    <>
      <div className="sc-beam" /><i className="sc-lamp" />
      <div className="sc-window" />
      <div className="sc-fence" />
    </>
  ),
  legends: (finale) => (
    <>
      <svg className="sc-frame" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="97" height="57" pathLength={100} />
      </svg>
      <div className="sc-stamp">RETIRED</div>
      {finale && (
        <>
          <div className="sc-rope"><i className="sc-post l" /><i className="sc-sag" /><i className="sc-post r" /></div>
          <span className="sc-plaque">TABLE CLOSED</span>
        </>
      )}
    </>
  ),
  king: () => (
    <>
      <div className="sc-dark" />
      <div className="sc-cone" />
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className="sc-mote" style={{ '--i': i } as CSSProperties} />)}
      <svg className="sc-crown" viewBox="0 0 24 20" aria-hidden="true">
        <path d="M3 16 L2 6 L8 10 L12 3 L16 10 L22 6 L21 16 Z" fill="currentColor" />
        <rect x="3" y="16" width="18" height="2.4" fill="currentColor" />
      </svg>
    </>
  ),
};

export function SetCover({ animId, tier, mode, reduced, side, delayMs = 0, finaleHeadline = null, waitFallbackMs = 0 }: {
  animId: string;
  tier: 'regular' | 'finale';
  /** fresh = this hand's set, play it; static = end state on later recaps */
  mode: 'fresh' | 'static';
  reduced: boolean;
  side: number;
  /** Finale sequencing (e.g. after the 3 THE HARD WAY title card). */
  delayMs?: number;
  /** Finale tier only: the words that close the game (finaleHeadlineFor).
   *  Rendered in EVERY mode — fresh, static, reduced — as part of the end
   *  state, so the card reads "game over" even for a player who arrives
   *  after the scenario art has played (owner, 2026-10-21). Rendered as a
   *  flow sibling of the cover art (the face's "verdict" grid row), NOT
   *  inside the cover layer — see the header comment. */
  finaleHeadline?: FinaleHeadline | null;
  /** Bounded wait for the in-view gate: if no IntersectionObserver report
   *  arrives within this long, the wait lifts anyway. The decided recap's
   *  finale is the most important card on the screen — it must never be
   *  gate-starved by an observer quirk (the useGame bounded-wait pattern).
   *  0 = wait indefinitely (regular covers keep the pure gate). */
  waitFallbackMs?: number;
}) {
  const def = setAnimForStop(animId);
  const art = ART[animId];
  // In-view gate (owner, 2026-10-21): a fresh cover's CSS clock starts when
  // the element mounts, but the set side's card can sit below the fold of
  // the recap sheet's scrollport — the animation then played unseen and
  // was over by the time the player scrolled to the card. The cover now
  // waits (held at its first frame by .sc-wait in animfx.css) until its
  // own card is actually in view, then plays in full. Latched: scrolling
  // away mid-play never rewinds it. No IntersectionObserver (old browser,
  // test DOM) = treat as in view, the pre-gate behavior. Static/reduced
  // covers never wait — their end state IS the presentation.
  const [seen, setSeen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const still = reduced || mode === 'static';
  useEffect(() => {
    if (still || seen) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [still, seen]);
  // Bounded wait (finale covers): the observer normally lifts the gate the
  // moment the card scrolls into view; if it never reports (browser quirk,
  // an off-viewport layout the observer can't see), the finale still plays
  // rather than sitting paused at frame one forever — its end state (art +
  // headline) is the presentation either way.
  useEffect(() => {
    if (still || seen || !waitFallbackMs) return;
    const t = window.setTimeout(() => setSeen(true), waitFallbackMs);
    return () => window.clearTimeout(t);
  }, [still, seen, waitFallbackMs]);
  if (!def || !art) return null;
  const waiting = !still && !seen;
  return (
    <>
      <div
        ref={rootRef}
        className={`setcover tier-${tier} ${still ? 'static' : 'fresh'}${waiting ? ' sc-wait' : ''}`}
        data-anim={animId}
        data-testid={`recap-setanim-${side}`}
        data-tier={tier}
        data-mode={still ? 'static' : 'fresh'}
        data-wait={waiting ? 'yes' : undefined}
        style={{ '--sc-delay': `${delayMs}ms` } as CSSProperties}
        aria-hidden="true"
      >
        {art(tier === 'finale')}
        {still && <span className="sc-tag">{def.name}{tier === 'finale' ? ' · Finale' : ''}</span>}
      </div>
      {tier === 'finale' && finaleHeadline && (
        <div
          className={`finale-verdict${still ? '' : ' fresh'}${waiting ? ' waiting' : ''}`}
          data-testid={`recap-finale-headline-${side}`}
          style={{ '--sc-delay': `${delayMs}ms` } as CSSProperties}
        >
          <b>{finaleHeadline.headline}</b>
          <span>{finaleHeadline.sub}</span>
        </div>
      )}
    </>
  );
}
