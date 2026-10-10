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
