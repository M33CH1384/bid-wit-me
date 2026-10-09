/** Card model. Cards are short strings: rank + suit ("AS", "TD", "2H") or "BJ"/"LJ" for jokers. */

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

/** Ranks low → high. "T" is ten. */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

export type StandardCard = `${Rank}${Suit}`;
export type Joker = 'BJ' | 'LJ';
export type Card = StandardCard | Joker;

export const BIG_JOKER: Joker = 'BJ';
export const LITTLE_JOKER: Joker = 'LJ';

export function isJoker(card: Card): card is Joker {
  return card === 'BJ' || card === 'LJ';
}

/** Natural suit of a card (jokers have none). */
export function naturalSuit(card: Card): Suit | null {
  return isJoker(card) ? null : (card[1] as Suit);
}

export function rankOf(card: Card): Rank | null {
  return isJoker(card) ? null : (card[0] as Rank);
}

/** All 52 standard cards, spades first, each suit 2 → A. */
export function standardDeck(): StandardCard[] {
  const out: StandardCard[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}`);
  return out;
}

const ALL_CARDS = new Set<string>([...standardDeck(), 'BJ', 'LJ']);

/** True if the string is a valid card code. */
export function isCard(value: unknown): value is Card {
  return typeof value === 'string' && ALL_CARDS.has(value);
}

/** Accepts "10S" / "10s" / "ts" etc. and returns the canonical card, or throws. */
export function parseCard(input: string): Card {
  const s = input.trim().toUpperCase().replace(/^10/, 'T');
  if (!isCard(s)) throw new Error(`Not a card: ${input}`);
  return s;
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

/** Human label: "10♠", "A♥", "Big Joker". */
export function cardLabel(card: Card): string {
  if (card === 'BJ') return 'Big Joker';
  if (card === 'LJ') return 'Little Joker';
  const r = card[0] === 'T' ? '10' : card[0];
  return `${r}${SUIT_SYMBOL[card[1] as Suit]}`;
}
