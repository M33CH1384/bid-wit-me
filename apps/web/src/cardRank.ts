/**
 * Display text for a player's rank card (owner, 2026-10-23: a player's
 * rank IS a playing card — the 3 of hearts at Rep level 1, climbing the
 * suits to the Deuce of spades, the Little Joker, and the prestige Big
 * Joker). The ladder itself lives in ONE place — the server's derivation
 * (apps/server/src/cred/xp.ts cardRankForLevel) — and every payload that
 * names a player carries the derived card with it. These helpers only
 * FORMAT the card a payload handed us; nothing here recomputes a step,
 * a suit, or a gate from a level number.
 */
import type { CardRankData } from './profile/PlayerCard';

const SUIT_PLURAL: Record<string, string> = {
  hearts: 'Hearts',
  clubs: 'Clubs',
  diamonds: 'Diamonds',
  spades: 'Spades',
};

/** The compact glyph, same shape the Player Card's rankline uses:
 *  "10♣", "Q♦" — the Jokers read by name with their star ("Big Joker ★"). */
export function rankGlyph(rank: CardRankData): string {
  return rank.isJoker ? `${rank.rankName} ★` : `${rank.rank}${rank.symbol}`;
}

/** The full card name: "Ten of Clubs", "Deuce of Spades", "Little Joker". */
export function cardDisplayName(rank: CardRankData): string {
  if (rank.isJoker || !rank.suit) return rank.rankName;
  return `${rank.rankName} of ${SUIT_PLURAL[rank.suit] ?? rank.suit}`;
}
