/**
 * Deck lore for the setup deck gallery + browser: a one-line identity (tag)
 * and a brief explanation (blurb) per deck, plus per-card facts where the
 * game's own data carries them.
 *
 * Copy provenance: NO deck shipped a description before this module — every
 * tag/blurb below is authored copy in the game's voice, grounded only in
 * shipped facts (the deck's art theme, its story stop's seated pair and
 * flavor from STORY_STOPS, and deck data such as Pj's Iron shipping Ace art).
 * Story decks carry deck-level copy only: no data names who's on their
 * individual courts, so no per-card identities are claimed for them.
 *
 * Per-card facts come from exactly one source: the Revolutionaries deck's
 * figure table in @spades/bots (REV_FIGURE_BY_CARD) — the same name +
 * one-true-stroke tribute lines the table-talk engine speaks when those
 * cards are honored at the Barbershop. Every other deck returns no fact:
 * the close-up shows the card, never an invented story about it.
 */
import { REV_FIGURE_BY_CARD } from '@spades/bots';
import type { Card } from '@spades/rules';

export interface DeckLore { tag: string; blurb: string }

export const DECK_LORE: Record<string, DeckLore> = {
  base: {
    tag: 'Where it started',
    blurb: 'The original Bid Wit Me faces — the deck this game was first dealt in.',
  },
  classic: {
    tag: 'The standard bearer',
    blurb: 'Clean, classic courts on a timeless face. The deck every other deck gets measured against.',
  },
  afrofuturist: {
    tag: 'Tomorrow, dealt today',
    blurb: 'Royalty from the future — the courts in Afrofuturist regalia, all chrome, gold, and starlight.',
  },
  harlem: {
    tag: 'Uptown royalty',
    blurb: "A love letter to Harlem's golden age — the courts dressed for a Saturday night uptown.",
  },
  hiphop: {
    tag: 'Boombox-era royalty',
    blurb: 'The courts as hip-hop royalty — crowns, chains, and a boombox on the shoulder.',
  },
  mali: {
    tag: 'Empire of gold',
    blurb: 'The courts in the splendor of the Mali Empire — gold, indigo, and griot grandeur.',
  },
  egypt: {
    tag: 'Pharaohs at the table',
    blurb: 'The courts as ancient Egyptian royalty — gold, lapis, and desert majesty.',
  },
  greek: {
    tag: 'Gods and heroes',
    blurb: 'The courts straight off Mount Olympus — laurel, marble, and thunder.',
  },
  porchlight: {
    tag: "The Porch's own",
    blurb: "The Porch's house deck, earned at Uncle Ray & Pat's table — warm light, warmer talk, and where Dee learned the game.",
  },
  revolutionaries: {
    tag: 'History holds the courts',
    blurb: "The Barbershop's house deck. Twelve Black history figures hold the courts — Douglass, Tubman, Malcolm X, and more. Open a court card to meet who's on it.",
  },
  blacktop: {
    tag: "The Rec's own",
    blurb: "The Rec Center's house deck, earned at Lil' Man & Trey's table — loud, fast, and blacktop-hot.",
  },
  cookout: {
    tag: "The Twins' table",
    blurb: "The Cookout's house deck, earned under Keisha & Teisha — the Twins who finish each other's sentences, and each other's bids.",
  },
  corner: {
    tag: "The Corner's own",
    blurb: "The Corner's house deck, earned at Smoke & Redd's cold, quiet table, where they hunt nils for sport.",
  },
  stainedglass: {
    tag: "The Church Basement's own",
    blurb: "The Church Basement's house deck, earned under Deacon Ford & Sister Mae — sweet as pie, ruthless underneath, every face in stained glass.",
  },
  rooftopdusk: {
    tag: "The Rooftop's own",
    blurb: "The Rooftop's house deck, earned at dusk — Poet's riddles in one ear, Seven's silence in the other.",
  },
  penthouse: {
    tag: "The High-Rise's own",
    blurb: "The High-Rise's house deck, earned at Velvet & the Accountant's penthouse table — money energy, priced to the penny.",
  },
  pjs: {
    tag: "The Pj's own iron",
    blurb: "The Pj's house deck, earned under Captain Block & Brick — the block at night, streetlight on the iron. The only deck that ships its Aces as art, too.",
  },
  legends: {
    tag: "The Legends' own",
    blurb: "The Legends' Table house deck, earned past Queenie & Ace — the retired royalty who guard the road to the King.",
  },
  madeitout: {
    tag: "The King's own",
    blurb: "The last deck on the route, earned at the King of the Block's own table — twenty-two years undefeated. You didn't just win. You made it out.",
  },
};

export function deckLore(id: string): DeckLore {
  return DECK_LORE[id] ?? { tag: '', blurb: '' };
}

export interface DeckCardFact { name: string; fact: string }

/** The per-card fact for a close-up, or null when the deck's data carries
 *  none. Only the Revolutionaries deck has named people on its faces, sourced
 *  verbatim from the game's tribute table (name + tribute sentence). */
export function deckCardFact(deckId: string, card: string): DeckCardFact | null {
  if (deckId !== 'revolutionaries') return null;
  const fig = REV_FIGURE_BY_CARD[card as Card];
  return fig ? { name: fig.name, fact: fig.tribute } : null;
}

/** Every card in a deck, in table order: suits ♠ ♥ ♦ ♣, Ace through King,
 *  then the two jokers. The browser splits this into art faces / the rest. */
export const DECK_CARD_ORDER: Card[] = [
  ...(['S', 'H', 'D', 'C'] as const).flatMap((suit) =>
    (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const).map((r) => `${r}${suit}` as Card),
  ),
  'BJ' as Card, 'LJ' as Card,
];

const RANK_NAME: Record<string, string> = {
  A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack',
  '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six',
  '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten',
};
const SUIT_NAME: Record<string, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

/** "King of Spades" / "Big Joker" — the close-up's card title. */
export function cardLabel(card: string): string {
  if (card === 'BJ') return 'Big Joker';
  if (card === 'LJ') return 'Little Joker';
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return `${RANK_NAME[rank] ?? rank} of ${SUIT_NAME[suit] ?? suit}`;
}
