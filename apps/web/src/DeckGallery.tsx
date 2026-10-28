/**
 * Deck gallery + browser (setup rework, owner 2026-10-23): the deck section
 * is a horizontal snap slider of large deck covers; tapping a cover opens
 * the DECK BROWSER — a full sheet with the deck's explanation, its hero
 * faces, and every card browsable up close. The deck choice itself is made
 * inside the browser ("Use this deck"), so the slider, the browser, and the
 * setup summary can never disagree.
 *
 * Locks mirror the old picker exactly: story decks stay locked until their
 * stop is cleared (deckUnlocked), a locked deck's BROWSER still opens
 * (looking is free) but its Use action is disabled with the unlock line
 * shown, and a saved deck that is locked for this player falls back to
 * Classic once progress loads.
 *
 * Card rendering: cards the deck ships art for (courts, jokers, and Pj's
 * Iron's aces) render the REAL shipped face asset at every size — the
 * close-up is that same full-resolution file. Cards with no per-deck art
 * (number cards, other decks' aces — painted faces in the deck-texture
 * generator at the table) render as a clean index face (rank + suit), the
 * same identity the painted face carries.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Card } from '@spades/rules';
import { DECKS, deckArtUrl, deckBackUrl, deckById, deckThumbUrl, type DeckDef } from './decks';
import { deckUnlockLine, deckUnlocked, useClearedStoryStops } from './storyDecks';
import { DECK_CARD_ORDER, cardLabel, deckCardFact, deckLore } from './deckLore';
import { useEscapeClose } from './useEscapeClose';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** A clean index-face rendering for cards the deck ships no art for. */
function PaintedCard({ card, className = '' }: { card: string; className?: string }) {
  if (card === 'BJ' || card === 'LJ') {
    return (
      <span className={`pcard joker ${className}`} aria-hidden="true">
        <span className="pcard-joker-star">{card === 'BJ' ? '★' : '☆'}</span>
        <span className="pcard-joker-word">JOKER</span>
      </span>
    );
  }
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const glyph = SUIT_GLYPH[suit] ?? suit;
  const red = suit === 'H' || suit === 'D';
  return (
    <span className={`pcard${red ? ' red' : ''} ${className}`} aria-hidden="true">
      <span className="pcard-corner"><b>{rank}</b><i>{glyph}</i></span>
      <span className="pcard-pip">{glyph}</span>
      <span className="pcard-corner flip"><b>{rank}</b><i>{glyph}</i></span>
    </span>
  );
}

function CardTile({ deckId, card, onFocus }: { deckId: string; card: Card; onFocus: (c: Card) => void }) {
  const art = deckArtUrl(deckId, card);
  return (
    <button type="button" className="db-tile" data-testid={`deck-card-${card}`}
      aria-label={`Look at the ${cardLabel(card)}`} onClick={() => onFocus(card)}>
      {art ? <img src={art} alt="" loading="lazy" /> : <PaintedCard card={card} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Card-focus swipe (owner, 2026-10-28: "I want to be able to swipe    */
/* thru the cards on these screens in addition to tapping the         */
/* arrows").                                                          */
/*                                                                    */
/* Pointer-driven on the focus stage, so touch, mouse and trackpad    */
/* drags all read the same: the card tracks the finger, a committed   */
/* release slides it out and the neighbour settles in from the other  */
/* side; a short or slow drag settles back. Horizontal-only by        */
/* construction — the surface is touch-action: pan-y (the browser     */
/* keeps vertical pans for the sheet's own scrolling) and a           */
/* vertical-dominant move releases the gesture untouched. The ends    */
/* behave exactly like the arrows: the swipe calls the same prev /    */
/* next targets, wrap included. Under reduced motion there is no      */
/* tracking and no slide — the swap is instant.                       */
/* ------------------------------------------------------------------ */

const SWIPE_SLOP_PX = 10; // travel before a direction is chosen
const SWIPE_COMMIT_PX = 54; // release distance that commits the swipe
const SWIPE_FLICK_MIN_PX = 20; // a fast flick commits from this far…
const SWIPE_FLICK_PX_MS = 0.5; // …at at least this speed (px/ms)
const SWIPE_EXIT_PX = 340; // slide-out travel — past any stage width
const SWIPE_OUT_MS = 230; // slide-out duration
const SWIPE_SETTLE_MS = 300; // settle-back / settle-in duration

function swipeReducedMotion(): boolean {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

type SwipeGesture = {
  id: number; x0: number; y0: number;
  dir: 'h' | 'v' | null;
  dx: number; lastX: number; lastT: number; v: number;
  reduced: boolean;
};

function CardFocus({ deckId, card, onNav }: { deckId: string; card: Card; onNav: (c: Card) => void }) {
  const art = deckArtUrl(deckId, card);
  const fact = deckCardFact(deckId, card);
  const idx = DECK_CARD_ORDER.indexOf(card);
  const n = DECK_CARD_ORDER.length;
  const prev = DECK_CARD_ORDER[(idx + n - 1) % n]!;
  const next = DECK_CARD_ORDER[(idx + 1) % n]!;

  const [slide, setSlide] = useState<{ x: number; ms: number }>({ x: 0, ms: 0 });
  const [enterDir, setEnterDir] = useState<0 | -1 | 1>(0); // -1: arrived going next, 1: going prev
  const gesture = useRef<SwipeGesture | null>(null);
  const navBusy = useRef(false);
  const enterSeq = useRef(0); // generation guard: a stale settle-in cleanup never clears a newer entry
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  /** Arrow taps keep their exact instant swap; they also reset any slide state. */
  const navNow = (c: Card) => { setEnterDir(0); setSlide({ x: 0, ms: 0 }); onNav(c); };

  /** dir -1: swiped left, going next. dir 1: swiped right, going prev. */
  const commitSwipe = (dir: -1 | 1) => {
    const target = dir === -1 ? next : prev;
    if (swipeReducedMotion()) { navNow(target); return; }
    navBusy.current = true;
    setSlide({ x: dir * SWIPE_EXIT_PX, ms: SWIPE_OUT_MS });
    later(() => {
      const seq = ++enterSeq.current;
      setEnterDir(dir);
      setSlide({ x: 0, ms: 0 });
      onNav(target);
      navBusy.current = false;
      later(() => { if (enterSeq.current === seq) setEnterDir(0); }, SWIPE_SETTLE_MS + 60);
    }, SWIPE_OUT_MS);
  };

  const settleBack = () => {
    setSlide({ x: 0, ms: SWIPE_SETTLE_MS });
    later(() => setSlide({ x: 0, ms: 0 }), SWIPE_SETTLE_MS + 20);
  };

  const endGesture = (commit: boolean) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.dir !== 'h') return;
    const adx = Math.abs(g.dx);
    const flicked = adx >= SWIPE_FLICK_MIN_PX && Math.abs(g.v) >= SWIPE_FLICK_PX_MS
      && Math.sign(g.v) === Math.sign(g.dx);
    if (commit && (adx >= SWIPE_COMMIT_PX || flicked)) commitSwipe(g.dx < 0 ? -1 : 1);
    else if (!g.reduced) settleBack();
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (navBusy.current || gesture.current) return;
    if ((e.target as HTMLElement).closest('button')) return; // the arrows keep their plain tap
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    gesture.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: null,
      dx: 0, lastX: e.clientX, lastT: performance.now(), v: 0,
      reduced: swipeReducedMotion(),
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) { endGesture(false); return; }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    g.dx = dx;
    if (g.dir === null) {
      if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return;
      g.dir = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      if (g.dir === 'v') { gesture.current = null; return; } // the sheet's scroll owns it
    }
    const now = performance.now();
    const dt = now - g.lastT;
    if (dt > 0) g.v = 0.65 * g.v + 0.35 * ((e.clientX - g.lastX) / dt);
    g.lastX = e.clientX; g.lastT = now;
    if (!g.reduced) setSlide({ x: dx, ms: 0 });
  };

  const swipeStyle: CSSProperties | undefined = enterDir !== 0 ? undefined
    : slide.x !== 0 || slide.ms !== 0
      ? { transform: `translateX(${slide.x}px)`, transition: slide.ms ? `transform ${slide.ms}ms cubic-bezier(.25,.8,.3,1)` : 'none' }
      : undefined;

  return (
    <div className="db-focus" data-testid="deck-card-focus">
      <div className="db-stage-clip">
      <div className="db-stage"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={() => endGesture(true)} onPointerCancel={() => endGesture(false)}>
        <button type="button" className="db-nav" data-testid="deck-card-prev" aria-label="Previous card" onClick={() => navNow(prev)}>‹</button>
        <div className={`db-swipe${enterDir === -1 ? ' enter-next' : enterDir === 1 ? ' enter-prev' : ''}`}
          data-testid="deck-card-swipe" style={swipeStyle} onDragStart={(e) => e.preventDefault()}>
          {art
            ? <img className="db-big" src={art} alt={cardLabel(card)} draggable={false} />
            : <PaintedCard card={card} className="db-big-painted" />}
        </div>
        <button type="button" className="db-nav" data-testid="deck-card-next" aria-label="Next card" onClick={() => navNow(next)}>›</button>
      </div>
      </div>
      <div className="db-focus-meta">
        <b className="db-focus-name">{cardLabel(card)}</b>
        {fact && (
          <div className="db-fact" data-testid="deck-card-fact">
            <b className="db-fact-name">{fact.name}</b>
            <p>{fact.fact}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DeckBrowser({ deck, selected, locked, onUse, onClose }: {
  deck: DeckDef; selected: boolean; locked: boolean;
  onUse: () => void; onClose: () => void;
}) {
  const [focus, setFocus] = useState<Card | null>(null);
  useEscapeClose(onClose);
  const lore = deckLore(deck.id);
  const line = locked ? deckUnlockLine(deck) : null;
  const artCards = DECK_CARD_ORDER.filter((c) => deckArtUrl(deck.id, c));
  const restCards = DECK_CARD_ORDER.filter((c) => !deckArtUrl(deck.id, c));
  return (
    <div className="modal-backdrop db-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="deck-browser glass slant" role="dialog" aria-modal="true"
        aria-label={`${deck.name} deck browser`} data-testid="deck-browser">
        <header className="db-head">
          <div className="db-hero" aria-hidden="true">
            {(['QS', 'KS', 'BJ'] as Card[]).map((c, i) => {
              const u = deckArtUrl(deck.id, c);
              return u ? <img key={c} className={`db-hero-card h${i}`} src={u} alt="" /> : null;
            })}
          </div>
          <div className="db-title">
            <h3 className="db-name">{deck.name}</h3>
            {lore.tag && <p className="db-tag">{lore.tag}</p>}
            {lore.blurb && <p className="db-blurb">{lore.blurb}</p>}
            {line && <p className="db-lock">🔒 {line}</p>}
          </div>
          <button type="button" className="db-close" data-testid="deck-browser-close"
            aria-label="Close deck browser" onClick={onClose}>✕</button>
        </header>
        <div className="db-body">
          {focus ? (
            <CardFocus deckId={deck.id} card={focus} onNav={setFocus} />
          ) : (
            <>
              <h4 className="db-sec">The faces</h4>
              <div className="db-grid faces">
                {artCards.map((c) => <CardTile key={c} deckId={deck.id} card={c} onFocus={setFocus} />)}
              </div>
              <h4 className="db-sec">Every card</h4>
              <div className="db-grid rest">
                {restCards.map((c) => <CardTile key={c} deckId={deck.id} card={c} onFocus={setFocus} />)}
              </div>
            </>
          )}
        </div>
        <footer className="db-foot">
          {focus
            ? <button type="button" className="db-allcards" data-testid="deck-all-cards" onClick={() => setFocus(null)}>← All cards</button>
            : <span className="db-foot-hint">Tap any card to see it up close</span>}
          <button type="button" className="primary go db-use" data-testid={`deck-use-${deck.id}`}
            disabled={locked || selected} onClick={onUse}>
            {selected ? 'This is your deck' : locked ? '🔒 Locked' : 'Use this deck'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function BackTile({ deckId, onFocus }: { deckId: string; onFocus: () => void }) {
  return (
    <button type="button" className="db-tile" data-testid="deck-card-BACK"
      aria-label="Look at the card back" onClick={onFocus}>
      <img src={deckBackUrl(deckId)} alt="" loading="lazy" />
    </button>
  );
}

function BackFocus({ deck }: { deck: DeckDef }) {
  return (
    <div className="db-focus" data-testid="deck-back-focus">
      <div className="db-stage">
        <img className="db-big" src={deckBackUrl(deck.id)} alt={`${deck.name} card back`} />
      </div>
      <div className="db-focus-meta">
        <b className="db-focus-name">Card back</b>
      </div>
    </div>
  );
}

/** What the viewer's close-up is showing: a card, or the deck's back. */
type ViewerFocus = Card | 'BACK';

/**
 * DECK VIEWER (owner, 2026-10-25: "When a new deck is unlocked I should be
 * able to tap it and scroll thru it") — the browser sheet as a LOOK, not a
 * picker. It reuses the browser's renderer whole (hero faces, lore, the
 * faces / every-card grids, tap a card for the close-up with prev/next) and
 * adds the one thing the picker never showed: the deck's BACK, at the head
 * of the scroll. There is no Use action — opening the viewer changes no
 * selection, and closing it returns to the exact screen and state the
 * player came from. Mounted from the unlock presentations (the story
 * outro's deck card is the first door).
 */
export function DeckViewer({ deck, onClose }: { deck: DeckDef; onClose: () => void }) {
  const [focus, setFocus] = useState<ViewerFocus | null>(null);
  const sheetRef = useEscapeClose(onClose);
  const lore = deckLore(deck.id);
  const artCards = DECK_CARD_ORDER.filter((c) => deckArtUrl(deck.id, c));
  const restCards = DECK_CARD_ORDER.filter((c) => !deckArtUrl(deck.id, c));
  return (
    <div className="modal-backdrop db-backdrop" ref={sheetRef} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="deck-browser deck-viewer glass slant" role="dialog" aria-modal="true"
        aria-label={`${deck.name} deck viewer`} data-testid="deck-viewer">
        <header className="db-head">
          <div className="db-hero" aria-hidden="true">
            {(['QS', 'KS', 'BJ'] as Card[]).map((c, i) => {
              const u = deckArtUrl(deck.id, c);
              return u ? <img key={c} className={`db-hero-card h${i}`} src={u} alt="" /> : null;
            })}
          </div>
          <div className="db-title">
            <h3 className="db-name">{deck.name}</h3>
            {lore.tag && <p className="db-tag">{lore.tag}</p>}
            {lore.blurb && <p className="db-blurb">{lore.blurb}</p>}
          </div>
          <button type="button" className="db-close" data-testid="deck-viewer-close"
            aria-label="Close deck viewer" onClick={onClose}>✕</button>
        </header>
        <div className="db-body">
          {focus === 'BACK' ? (
            <BackFocus deck={deck} />
          ) : focus ? (
            <CardFocus deckId={deck.id} card={focus} onNav={setFocus} />
          ) : (
            <>
              <h4 className="db-sec">The back</h4>
              <div className="db-grid back">
                <BackTile deckId={deck.id} onFocus={() => setFocus('BACK')} />
              </div>
              <h4 className="db-sec">The faces</h4>
              <div className="db-grid faces">
                {artCards.map((c) => <CardTile key={c} deckId={deck.id} card={c} onFocus={setFocus} />)}
              </div>
              <h4 className="db-sec">Every card</h4>
              <div className="db-grid rest">
                {restCards.map((c) => <CardTile key={c} deckId={deck.id} card={c} onFocus={setFocus} />)}
              </div>
            </>
          )}
        </div>
        <footer className="db-foot">
          {focus
            ? <button type="button" className="db-allcards" data-testid="deck-all-cards" onClick={() => setFocus(null)}>← All cards</button>
            : <span className="db-foot-hint">Tap any card to see it up close</span>}
          <button type="button" className="primary go db-use" data-testid="deck-viewer-done" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

export function DeckGallery({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Story decks unlock from the player's own story progress (cleared stops);
  // while progress is loading they render locked, then open up if earned.
  const { cleared, loaded } = useClearedStoryStops();
  const [browseId, setBrowseId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = DECKS.find((d) => d.id === value);
  useEffect(() => {
    // A saved deck that is story-locked for this player (e.g. signed out, or a
    // different account on this phone) falls back to Classic once progress is known.
    if (loaded && selected && !deckUnlocked(selected, cleared)) onChange('classic');
  }, [loaded, selected, cleared, onChange]);
  useEffect(() => {
    // Open the slider parked on the current deck. Scroll the SLIDER ONLY, by
    // setting its own scrollLeft: scrollIntoView also scrolls every scrollable
    // ancestor — including .wizard, whose overflow-x: hidden makes it a
    // programmatic scroll container — and strands the setup screen shifted
    // sideways where no player gesture can scroll it back (owner report,
    // 2026-10-23: the table step opened with its left side cut off). The rect
    // delta centers the cover inside the slider and touches nothing else.
    const list = listRef.current;
    const el = list?.querySelector('.dg-cover.on');
    if (list && el) {
      const listRect = list.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      list.scrollLeft += (elRect.left + elRect.width / 2) - (listRect.left + listRect.width / 2);
    }
  }, []);
  const browseDeck = browseId ? deckById(browseId) : undefined;
  return (
    <>
      <div className="deck-gallery" role="listbox" aria-label="Card deck — tap a deck to browse its cards" ref={listRef}>
        {DECKS.map((d) => {
          const unlocked = deckUnlocked(d, cleared);
          const line = unlocked ? null : deckUnlockLine(d);
          const lore = deckLore(d.id);
          return (
            <button key={d.id} type="button" role="option" aria-selected={value === d.id}
              className={`dg-cover${value === d.id ? ' on' : ''}${unlocked ? '' : ' locked'}`}
              aria-label={unlocked ? `${d.name} — browse its cards` : `${d.name} — locked. ${line ?? ''} Browse its cards`}
              data-testid={`deck-${d.id}`} onClick={() => setBrowseId(d.id)}>
              <img src={deckThumbUrl(d.id)} alt="" loading="lazy" />
              <span className="dg-name">{d.name}</span>
              <span className="dg-tag">{line ? `🔒 ${line}` : lore.tag}</span>
              {value === d.id && <span className="dg-inuse">Your deck</span>}
            </button>
          );
        })}
      </div>
      {/* S2 (HANDOFF Bots setup --land-phone): the compact row shows ~3 deck thumbs; this
          "+N decks" chip pages the slider on to the rest. Hidden outside phone landscape. */}
      <button type="button" className="dg-more" data-testid="deck-more"
        onClick={() => { const l = listRef.current; if (l) l.scrollBy({ left: l.clientWidth, behavior: 'smooth' }); }}>+{Math.max(0, DECKS.length - 3)} decks</button>
      {browseDeck && (
        <DeckBrowser deck={browseDeck} selected={value === browseDeck.id}
          locked={!deckUnlocked(browseDeck, cleared)}
          onUse={() => { onChange(browseDeck.id); setBrowseId(null); }}
          onClose={() => setBrowseId(null)} />
      )}
    </>
  );
}
