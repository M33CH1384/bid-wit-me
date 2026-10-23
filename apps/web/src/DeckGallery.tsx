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
import { useEffect, useRef, useState } from 'react';
import type { Card } from '@spades/rules';
import { DECKS, deckArtUrl, deckById, deckThumbUrl, type DeckDef } from './decks';
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

function CardFocus({ deckId, card, onNav }: { deckId: string; card: Card; onNav: (c: Card) => void }) {
  const art = deckArtUrl(deckId, card);
  const fact = deckCardFact(deckId, card);
  const idx = DECK_CARD_ORDER.indexOf(card);
  const n = DECK_CARD_ORDER.length;
  const prev = DECK_CARD_ORDER[(idx + n - 1) % n]!;
  const next = DECK_CARD_ORDER[(idx + 1) % n]!;
  return (
    <div className="db-focus" data-testid="deck-card-focus">
      <div className="db-stage">
        <button type="button" className="db-nav" data-testid="deck-card-prev" aria-label="Previous card" onClick={() => onNav(prev)}>‹</button>
        {art
          ? <img className="db-big" src={art} alt={cardLabel(card)} />
          : <PaintedCard card={card} className="db-big-painted" />}
        <button type="button" className="db-nav" data-testid="deck-card-next" aria-label="Next card" onClick={() => onNav(next)}>›</button>
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
    // Open the slider parked on the current deck.
    const el = listRef.current?.querySelector('.dg-cover.on');
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      try { (el as HTMLElement).scrollIntoView({ inline: 'center', block: 'nearest' }); } catch { /* older engines */ }
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
      {browseDeck && (
        <DeckBrowser deck={browseDeck} selected={value === browseDeck.id}
          locked={!deckUnlocked(browseDeck, cleared)}
          onUse={() => { onChange(browseDeck.id); setBrowseId(null); }}
          onClose={() => setBrowseId(null)} />
      )}
    </>
  );
}
