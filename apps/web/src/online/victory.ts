import type { SeatInfo } from '@spades/protocol';
import { winHeadline } from '../headline';

/**
 * Game-over name for one seat. A human keeps their name, including when a bot
 * finished the game for them. Only a seat that was a bot the whole time is a bot.
 */
export function victoryIdentity(seat: SeatInfo | undefined, fallback: string): { name: string; bot: boolean } {
  const fb = fallback.trim() || 'Player';
  if (!seat || seat.kind === 'empty') return { name: fb, bot: false };
  if (seat.kind === 'human') return { name: seat.name.trim() || fb, bot: false };
  if (seat.was?.trim()) return { name: seat.was.trim(), bot: false };
  return { name: seat.name.trim() || fb, bot: true };
}

/** Losing seats still render: a quiet row, never an empty gap where the team was. */
export function loserCaption(count: number): string | null {
  if (count <= 0) return null;
  return 'Lost';
}

/**
 * Headline for the results. A custom team name ("Shot Callers win") stays.
 * Otherwise the line is the people, so a human a bot replaced is not the bot's name.
 */
export function victoryHeadline(
  partnerships: boolean,
  passedTitle: string,
  seatHeadline: string,
  winners: { name: string; isMe: boolean }[],
): string {
  const fromPeople = winHeadline(winners.map((p) => (p.isMe ? 'You' : p.name)), partnerships);
  if (!partnerships) return fromPeople;
  if (passedTitle.trim().toLowerCase() !== seatHeadline.trim().toLowerCase()) return passedTitle;
  return fromPeople;
}
