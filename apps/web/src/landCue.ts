import { type Card, type GameState, type Play, type TableRules, booksInHand, isBooksHand, isTrump, trickWinner } from '@spades/rules';

/**
 * Landing cues for a played card: always 'play'; + 'cut' when trumping a non-trump lead; + 'broken' (bigger, wins) for
 * the first trump of the hand; + a joker rumble ('jokerLittle' / 'jokerBig'), or 'nuke' when the second joker of a
 * Big + Little Joker trick lands (the Big Joker beats the Little one).
 * EXCEPTION — the FINAL trick: the second Joker never cues the blast on landing. It only ARMS the
 * nuke (the trick glows — see view.nukeArmed) and the blast fires when the trick completes, once
 * every card is actually played (Demetrius 2026-10-20). Mid-hand nukes still blow on the landing.
 */
export function landCueFor(st: GameState, card: Card): string {
  const base = baseLandCue(st, card);
  if (card !== 'BJ' && card !== 'LJ') {
    // over-cut: a higher trump takes the lead from an earlier cut (Jokers keep their own effects instead)
    const t = [...st.tricks, st.trick].find((x) => x.plays.some((pl) => pl.card === card));
    if (!t) return base;
    const lvl = cutLevel(t.plays, t.plays.findIndex((pl) => pl.card === card), st.rules);
    if (lvl >= 2) return `play,${lvl >= 3 ? 'overcut3' : 'overcut'}|${overcutCallout(st, card)}`;
    if (lvl === 0 && base.endsWith(',cut')) return 'play'; // a lower trump that doesn't take the lead: just a card
    return base;
  }
  const all = [...st.tricks, st.trick];
  const ti = all.findIndex((x) => x.plays.some((pl) => pl.card === card));
  const t = ti >= 0 ? all[ti] : undefined;
  const i = t ? t.plays.findIndex((pl) => pl.card === card) : -1;
  const other = card === 'BJ' ? 'LJ' : 'BJ';
  const finalTrick = ti === booksInHand(st) - 1;
  const nuke = !!t && !finalTrick && t.plays.slice(0, i).some((pl) => pl.card === other);
  return `${base},${nuke ? 'nuke' : card === 'BJ' ? 'jokerBig' : 'jokerLittle'}`;
}

/**
 * Cut level of play `i` in a trick led with a non-trump: every trump that TAKES THE LEAD adds a level (the first cut
 * = 1, an over-cut = 2, a double over-cut = 3). Jokers count too (they keep their own effects). A trump that doesn't
 * take the lead, a non-trump, or any card on a trump lead is level 0.
 */
export function cutLevel(plays: readonly Play[], i: number, r: TableRules): number {
  if (i < 1 || i >= plays.length || isTrump(plays[0]!.card, r)) return 0;
  let level = 0;
  for (let j = 1; j <= i; j++) {
    const takes = isTrump(plays[j]!.card, r) && trickWinner(plays.slice(0, j + 1), r) === plays[j]!.seat;
    if (takes) level++;
    if (j === i) return takes ? level : 0;
  }
  return 0;
}
/** Over-cut callouts (random per over-cut; edit freely). */
export const OVERCUT_CALLOUTS = ['SAY LESS!', 'TALK TO EM!', 'IKYFL', 'NOT TODAY!', 'SIT DOWN!', 'STEAL!'];

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/**
 * The callout for the over-cut made by `card` this hand. Derived only from the hand's public plays (hand number +
 * the cards), so every client (offline or online) shows the same text; walks the hand's over-cuts in order so the
 * same callout is never shown twice in a row (in a trick or across tricks).
 */
export function overcutCallout(st: Pick<GameState, 'handNo' | 'tricks' | 'trick' | 'rules'>, card: Card, pool: readonly string[] = OVERCUT_CALLOUTS): string {
  let last = '';
  for (const t of [...st.tricks, st.trick]) {
    for (let i = 0; i < t.plays.length; i++) {
      if (cutLevel(t.plays, i, st.rules) < 2) continue;
      const key = `${st.handNo}:${t.plays.slice(0, i + 1).map((p) => p.card).join('')}`;
      const opts = pool.filter((x) => x !== last);
      const pick = opts[hash(key) % opts.length] ?? pool[0]!;
      if (t.plays[i]!.card === card) return pick;
      last = pick;
    }
  }
  return pool[hash(`${st.handNo}:${card}`) % pool.length]!;
}

/** An over-cut: a lead-taking trump on top of an earlier cut (level 2+). */
export const isOvercut = (plays: readonly Play[], i: number, r: TableRules) => cutLevel(plays, i, r) >= 2;

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
export function wheelsMade(rules: { partnerships: boolean; playerCount: number }, rec: { bids: readonly (number | string | null)[]; sides: { side: number; tricks: number; contractMade?: boolean | null }[] }): { side: number; bid: number; books: number }[] {
  // made = took at least the whole 10+ bid (a team that bid 12 and took 10 got set: no celebration);
  // the scored record's contractMade wins when present (it also accounts for a nil partner's books)
  return wheelsFor(rules, rec.bids).flatMap((w) => {
    const s = rec.sides.find((x) => x.side === w.side);
    if (!s || s.tricks < Math.max(WHEELS_AT, w.total) || s.contractMade === false) return [];
    return [{ side: w.side, bid: w.total, books: s.tricks }];
  });
}
/** First hand where books bid themselves (team games): the sides whose combined books just reached 10 this hand. */
export function wheelsTenthBooks(rules: { partnerships: boolean; playerCount: number }, bids: readonly (number | string | null)[], before: readonly number[], after: readonly number[]): number[] {
  if (!rules.partnerships || rules.playerCount !== 4 || !isBooksHand(bids as Parameters<typeof isBooksHand>[0])) return [];
  const side = (t: readonly number[], s: number) => (t[s] ?? 0) + (t[s + 2] ?? 0);
  return [0, 1].filter((s) => side(after, s) >= WHEELS_AT && side(before, s) < WHEELS_AT);
}
/** Cutthroat wheels: the players whose book count just reached 10 this hand. */
export function wheelsTenth(rules: { partnerships: boolean }, before: readonly number[], after: readonly number[]): number[] {
  if (rules.partnerships) return [];
  return after.flatMap((n, s) => (n >= WHEELS_AT && (before[s] ?? 0) < WHEELS_AT ? [s] : []));
}
