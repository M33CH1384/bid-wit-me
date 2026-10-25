/** Desi deck art packs (court cards + jokers; number cards keep the painted faces).
 *  The founder-approved set has the corner index BAKED INTO the art (gold frame, Barlow
 *  corners), so a loaded deck image is the whole face: drawFace draws it as-is and never
 *  paints its own corners over it (the painted corners below are only the pre-load fallback).
 *  The original eight decks are free for everyone. The Story decks are progression
 *  rewards: each is matched to a Story Mode stop and unlocks when the player CLEARS
 *  that stop (derived from story progress — see storyDecks.ts). `locked` on a story
 *  deck means "gated by a stop", never purchasable (beta rule: no real-money sales). */
import type { Card } from '@spades/rules';
import { noteDiag } from './diagnostics';

export interface DeckDef {
  id: string;
  name: string;
  /** Gated behind a story stop (see storyStopId); free decks omit this. */
  locked?: boolean;
  /** Story stop whose clear unlocks this deck (story decks only). */
  storyStopId?: string;
  /** Display name of that stop for the picker unlock line (story decks only). */
  storyStopName?: string;
  /** This deck also ships Ace art (the Pj's Iron deck); other decks' aces stay painted. */
  acesArt?: boolean;
  /** Art file extension for this deck's faces (legacy packs are jpg, story packs webp). */
  artExt?: 'jpg' | 'webp';
}
export const DECKS: DeckDef[] = [
  { id: 'base', name: 'Base' },
  { id: 'classic', name: 'Classic' },
  { id: 'afrofuturist', name: 'Afrofuturist' },
  { id: 'harlem', name: 'Harlem' },
  { id: 'hiphop', name: 'Boombox Royals' },
  { id: 'mali', name: 'Mali' },
  { id: 'egypt', name: 'Egypt' },
  { id: 'greek', name: 'Greek' },
  // Story Mode progression decks — one per stop, in route order.
  { id: 'porchlight', name: 'Porch Light', locked: true, storyStopId: 'porch', storyStopName: 'The Porch', artExt: 'webp' },
  { id: 'revolutionaries', name: 'Revolutionaries', locked: true, storyStopId: 'barbershop', storyStopName: 'The Barbershop', artExt: 'webp' },
  { id: 'blacktop', name: 'Blacktop', locked: true, storyStopId: 'rec-center', storyStopName: 'The Rec Center', artExt: 'webp' },
  { id: 'cookout', name: 'The Cookout', locked: true, storyStopId: 'cookout', storyStopName: 'The Cookout', artExt: 'webp' },
  { id: 'corner', name: 'The Corner', locked: true, storyStopId: 'corner', storyStopName: 'The Corner', artExt: 'webp' },
  { id: 'stainedglass', name: 'Stained Glass', locked: true, storyStopId: 'church-basement', storyStopName: 'The Church Basement', artExt: 'webp' },
  { id: 'rooftopdusk', name: 'Rooftop Dusk', locked: true, storyStopId: 'rooftop', storyStopName: 'The Rooftop', artExt: 'webp' },
  { id: 'penthouse', name: 'Penthouse', locked: true, storyStopId: 'high-rise', storyStopName: 'The High-Rise', artExt: 'webp' },
  { id: 'pjs', name: "Pj's Iron", locked: true, storyStopId: 'the-pjs', storyStopName: "The Pj's", acesArt: true, artExt: 'webp' },
  { id: 'legends', name: 'Legends', locked: true, storyStopId: 'legends', storyStopName: "The Legends' Table", artExt: 'webp' },
  { id: 'madeitout', name: 'Made It Out', locked: true, storyStopId: 'king', storyStopName: 'The King of the Block', artExt: 'webp' },
];
export const DECK_IDS = DECKS.map((d) => d.id);
export function deckById(id: string): DeckDef | undefined { return DECKS.find((d) => d.id === id); }
export function deckName(id: string): string { return deckById(id)?.name ?? 'Classic'; }
/** The story decks, in route order. */
export const STORY_DECKS: DeckDef[] = DECKS.filter((d) => d.storyStopId);
/** The deck a story stop unlocks, if any. */
export function deckForStop(stopId: string): DeckDef | undefined { return DECKS.find((d) => d.storyStopId === stopId); }

/** Art file for a card in a deck, or null (number cards / aces keep painted faces). */
export function deckArtFile(card: Card | string): string | null {
  if (card === 'BJ') return 'JOKER-BIG';
  if (card === 'LJ') return 'JOKER-LIL';
  const r = card[0];
  return r === 'J' || r === 'Q' || r === 'K' ? `${card}` : null;
}
/** Deck-aware art file: decks with acesArt (Pj's Iron) also ship the four Aces. */
export function deckArtFileFor(deck: string, card: Card | string): string | null {
  if (card[0] === 'A' && deckById(deck)?.acesArt) return `${card}`;
  return deckArtFile(card);
}
export function deckArtUrl(deck: string, card: Card | string): string | null {
  const f = deckArtFileFor(deck, card);
  return f ? `/assets/decks/${deck}/${f}.${deckById(deck)?.artExt ?? 'jpg'}` : null;
}
/** Picker thumbnail (the deck's King of Spades) in the deck's own art format. */
export function deckThumbUrl(deck: string): string {
  return `/assets/decks/${deck}/KS.${deckById(deck)?.artExt ?? 'jpg'}`;
}

/* ---------- per-deck card backs (founder-approved image set) ----------
 * One back per deck. The URL helper lives HERE, with the deck registry,
 * not in three/cardTextures: light surfaces (the setup gallery, the deck
 * viewer) need the URL without statically importing three — the entry
 * graph must stay three-free (entry-graph.test.ts; that download was the
 * blank-screen stall). cardTextures re-exports it for its old callers. */
const BACK_NAMES: Record<string, string> = { base: 'Base', classic: 'Classic', afrofuturist: 'Afrofuturist', harlem: 'Harlem', hiphop: 'Hip-hop', mali: 'Mali', egypt: 'Egypt', greek: 'Greek', porchlight: 'PorchLight', revolutionaries: 'Revolutionaries', blacktop: 'Blacktop', cookout: 'Cookout', corner: 'Corner', stainedglass: 'StainedGlass', rooftopdusk: 'RooftopDusk', penthouse: 'Penthouse', pjs: 'Pjs', legends: 'Legends', madeitout: 'MadeItOut' };
/** Story-pack backs ship as WebP (the founder set is PNG); keyed by deck id. */
const BACK_EXT: Record<string, string> = { porchlight: 'webp', revolutionaries: 'webp', blacktop: 'webp', cookout: 'webp', corner: 'webp', stainedglass: 'webp', rooftopdusk: 'webp', penthouse: 'webp', pjs: 'webp', legends: 'webp', madeitout: 'webp' };
export function deckBackUrl(deck: string): string {
  return `/assets/card-backs/${BACK_NAMES[deck] ?? 'Base'}-back.${BACK_EXT[deck] ?? 'png'}`;
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
  if (deckById(id)?.acesArt) for (const s of ['S', 'H', 'D', 'C']) void getDeckImage(`A${s}`);
  void getDeckImage('BJ'); void getDeckImage('LJ');
}

/** Loaded deck image for a card (null while loading / for painted cards). Starts the load on first ask. */
export function getDeckImage(card: Card | string): HTMLImageElement | null {
  const url = deckArtUrl(active, card);
  if (!url || typeof Image === 'undefined') return null;
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onerror = () => noteDiag('deck-art', url);
    img.src = url;
    // Notify on EVERY image load: waiters stay registered (the repaint hook must redraw each
    // court card as its own art arrives — clearing the list here left only the first card redrawn).
    img.onload = () => waiters.forEach((f) => f());
    images.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}
