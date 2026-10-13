import { type Card, type Suit } from '@spades/rules';

const RANK_NAME: Record<string, string> = {
  '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven',
  '8': 'Eight', '9': 'Nine', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace',
};

const SUIT_SPOKEN: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

/** Spoken card name: "Ace of spades", "Ten of hearts", "Big Joker". */
export function spokenCard(card: Card): string {
  if (card === 'BJ') return 'Big Joker';
  if (card === 'LJ') return 'Little Joker';
  const suit = card[1] as Suit;
  return `${RANK_NAME[card[0]]} of ${SUIT_SPOKEN[suit]}`;
}

/** One accessible name for the hand control, e.g. "Ace of spades, playable". */
export function cardControlLabel(card: Card, playable: boolean): string {
  return `${spokenCard(card)}, ${playable ? 'playable' : 'not playable'}`;
}
