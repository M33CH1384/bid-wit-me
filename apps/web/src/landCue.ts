import { type Card, type GameState, isTrump } from '@spades/rules';

/**
 * Landing cues for a played card: always 'play'; + 'cut' when trumping a non-trump lead; + 'broken' (bigger, wins) for
 * the first trump of the hand; + a joker rumble ('jokerLittle' / 'jokerBig'), or 'nuke' when the second joker of a
 * Big + Little Joker trick lands (the Big Joker beats the Little one).
 */
export function landCueFor(st: GameState, card: Card): string {
  const base = baseLandCue(st, card);
  if (card !== 'BJ' && card !== 'LJ') return base;
  const t = [...st.tricks, st.trick].find((x) => x.plays.some((pl) => pl.card === card));
  const i = t ? t.plays.findIndex((pl) => pl.card === card) : -1;
  const other = card === 'BJ' ? 'LJ' : 'BJ';
  const nuke = !!t && t.plays.slice(0, i).some((pl) => pl.card === other);
  return `${base},${nuke ? 'nuke' : card === 'BJ' ? 'jokerBig' : 'jokerLittle'}`;
}

function baseLandCue(st: GameState, card: Card): string {
  const r = st.rules;
  const tricks = [...st.tricks, st.trick];
  let firstTrump: Card | null = null;
  for (const t of tricks) for (const pl of t.plays) if (!firstTrump && isTrump(pl.card, r)) firstTrump = pl.card;
  for (const t of tricks) {
    const i = t.plays.findIndex((pl) => pl.card === card);
    if (i < 0) continue;
    if (card === firstTrump) return 'play,broken';
    if (i > 0 && isTrump(card, r) && !isTrump(t.plays[0]!.card, r)) return 'play,cut';
    return 'play';
  }
  return 'play';
}

/**
 * Wheels: a TEAM's combined bid of 10+ books (both partners have bid). Team games only (never Cutthroat),
 * never an individual bid; "books bid themselves" hands don't count. Returns { side, total } per wheeling team.
 */
export const WHEELS_AT = 10;
export function wheelsFor(rules: { partnerships: boolean; playerCount: number }, bids: readonly (number | string | null)[]): { side: number; total: number }[] {
  if (!rules.partnerships || rules.playerCount !== 4) return [];
  const out: { side: number; total: number }[] = [];
  for (const side of [0, 1]) {
    const a = bids[side], b = bids[side + 2];
    if (a === null || a === undefined || b === null || b === undefined || a === 'books' || b === 'books') continue;
    const total = (typeof a === 'number' ? a : 0) + (typeof b === 'number' ? b : 0);
    if (total >= WHEELS_AT) out.push({ side, total });
  }
  return out;
}

/** Team wheels MADE at hand end: a side that bid 10+ together (both partners numeric) and took 10+ books. */
export function wheelsMade(rules: { partnerships: boolean; playerCount: number }, rec: { bids: readonly (number | string | null)[]; sides: { side: number; tricks: number }[] }): { side: number; bid: number; books: number }[] {
  return wheelsFor(rules, rec.bids).flatMap((w) => {
    const s = rec.sides.find((x) => x.side === w.side);
    return s && s.tricks >= WHEELS_AT ? [{ side: w.side, bid: w.total, books: s.tricks }] : [];
  });
}
/** Cutthroat wheels: the players whose book count just reached 10 this hand. */
export function wheelsTenth(rules: { partnerships: boolean }, before: readonly number[], after: readonly number[]): number[] {
  if (rules.partnerships) return [];
  return after.flatMap((n, s) => (n >= WHEELS_AT && (before[s] ?? 0) < WHEELS_AT ? [s] : []));
}
