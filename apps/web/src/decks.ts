/** Desi deck art packs (court cards + jokers; number cards keep the painted faces).
 *  All decks unlocked for now — `locked` is the Story/purchase hook for later. */
import type { Card } from '@spades/rules';

export interface DeckDef { id: string; name: string; locked?: boolean }
export const DECKS: DeckDef[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'afrofuturist', name: 'Afrofuturist' },
  { id: 'harlem', name: 'Harlem' },
  { id: 'hiphop', name: 'Boombox Royals' },
  { id: 'mali', name: 'Mali' },
  { id: 'egypt', name: 'Egypt' },
  { id: 'greek', name: 'Greek' },
];
export const DECK_IDS = DECKS.map((d) => d.id);
export function deckName(id: string): string { return DECKS.find((d) => d.id === id)?.name ?? 'Classic'; }

/** Art file for a card in a deck, or null (number cards / aces keep painted faces). */
export function deckArtFile(card: Card | string): string | null {
  if (card === 'BJ') return 'JOKER-BIG';
  if (card === 'LJ') return 'JOKER-LIL';
  const r = card[0];
  return r === 'J' || r === 'Q' || r === 'K' ? `${card}` : null;
}
export function deckArtUrl(deck: string, card: Card | string): string | null {
  const f = deckArtFile(card);
  return f ? `/assets/decks/${deck}/${f}.jpg` : null;
}

let active = 'classic';
export function getActiveDeck(): string { return active; }

const images = new Map<string, HTMLImageElement>();
const waiters: (() => void)[] = [];
export function onDeckArtLoad(fn: () => void): void { waiters.push(fn); }

export function setActiveDeck(id: string): void {
  if (!DECK_IDS.includes(id)) id = 'classic';
  if (id === active && images.size) return;
  active = id;
  (typeof window !== 'undefined' ? (window as unknown as { __bwmDeck?: string }) : undefined) && ((window as unknown as { __bwmDeck?: string }).__bwmDeck = id);
  // warm the court's art so the first court card does not flash the painted face
  for (const r of ['J', 'Q', 'K']) for (const s of ['S', 'H', 'D', 'C']) void getDeckImage(`${r}${s}`);
  void getDeckImage('BJ'); void getDeckImage('LJ');
}

/** Loaded deck image for a card (null while loading / for painted cards). Starts the load on first ask. */
export function getDeckImage(card: Card | string): HTMLImageElement | null {
  const url = deckArtUrl(active, card);
  if (!url || typeof Image === 'undefined') return null;
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    // Notify on EVERY image load: waiters stay registered (the repaint hook must redraw each
    // court card as its own art arrives — clearing the list here left only the first card redrawn).
    img.onload = () => waiters.forEach((f) => f());
    images.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}
