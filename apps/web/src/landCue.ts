import {
  type Bid,
  type Card,
  type GameState,
  type Play,
  type TableRules,
  booksStillNeeded,
  cardPower,
  checkGameEnd,
  isBooksHand,
  isNilBid,
  isNukeTrick,
  isTrump,
  scoreHand,
  sideCount,
  sideOf,
  trickWinner,
  tricksStillRemaining,
} from '@spades/rules';

/**
 * Landing cues for a played card: always 'play'; + 'cut' when trumping a non-trump lead; + 'broken' (bigger, wins) for
 * the first trump of the hand; + a joker rumble ('jokerLittle' / 'jokerBig').
 * A nuke is NEVER cued on landing, in any trick: when the second Joker of a Big + Little Joker
 * trick lands, the nuke only ARMS (the trick glows — see view.nukeArmed) and the blast fires when
 * the trick completes, once every card is actually played (Demetrius 2026-10-20). The Table's
 * completion watchdog fires the 'nuke' cue on the finished trick.
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
  // a Joker landing only ever rumbles — even the second Joker of a trick, which arms the nuke.
  // The Big Joker's rumble carries its crack tier (see bigJokerCrackTier);
  // the Little Joker's carries the whip when the throw is its own moment
  // (see littleJokerWhips).
  if (card === 'BJ') return `${base},jokerBig|${bigJokerCrackTier(st, card)}`;
  return `${base},jokerLittle${littleJokerWhips(st, card) ? ',jokerWhip' : ''}`;
}

/**
 * The Whip-Crack gate (owner-approved 2026-11-06): does this Little
 * Joker landing get the whip — its own throw action, one fast crack
 * line across the table? The whip answers the THROW, never the steal,
 * and it never shares a moment another effect already owns:
 *
 *  - A trump steal is The Cut's moment: when the Little Joker crosses
 *    a standing trump for its side (classifyDeuceFx's Cut test, held
 *    to the same primitives), the cue carries trumpCut and NO whip.
 *  - A both-Jokers trick is the nuke's moment: if the Big Joker is
 *    already down in this trick — or anywhere in it, for a cue built
 *    late — the whip yields. Thrown FIRST, the Little keeps its own
 *    moment; the Big answers when it lands (MAX quake, then the blast
 *    at completion), exactly as shipped.
 *
 * Everything else — led plainly, following a plain lead, played over
 * its own side's standing trump — is a throw, and the whip fires.
 */
export function littleJokerWhips(st: GameState, card: Card): boolean {
  const t = [...st.tricks, st.trick].find((x) => x.plays.some((p) => p.card === card));
  if (!t) return false;
  if (t.plays.some((p) => p.card === 'BJ')) return false; // the nuke owns this trick
  const idx = t.plays.findIndex((p) => p.card === card);
  if (idx <= 0) return true; // led the trick: a plain throw
  const seat = t.plays[idx]!.seat;
  const before = t.plays.slice(0, idx);
  const w = trickWinner(before, st.rules);
  if (w < 0) return true;
  const beaten = before.find((p) => p.seat === w);
  if (!beaten || !isTrump(beaten.card, st.rules)) return true; // standing winner not trump: an ordinary take
  if (cardPower(card, st.rules) <= cardPower(beaten.card, st.rules)) return true; // did not cross it
  if (sideOf(w, st.rules) === sideOf(seat, st.rules)) return true; // partner's trump: the side already held it
  return false; // a trump steal — The Cut's moment
}

/**
 * Big Joker crack tier (Demetrius 2026-11-06): how hard the photoreal quake fractures
 * the screen when the Big Joker lands, keyed to what the throw DOES. The Big Joker
 * tops the trump order, so NO card played after it can take its trick — the book it
 * wins is sealed the moment it lands, and every consequence below is computed from
 * public state with certainty, the same standard as the cut caller above. Pure and
 * seat-blind: every client (offline, online, story, spectator) derives the identical
 * tier from the identical public state.
 *
 *   4 MAX      the Little Joker is already down in this trick — the nuke pair. (The
 *              blast itself lands at trick completion; the crack under it reads as
 *              the top degree. Reverse order is unknowable at the throw — the BJ
 *              takes its honest tier and the blast alone is the moment.)
 *   3 HEAVY    the throw carries a consequence: it busts the thrower's live nil;
 *              saves a live nil (takes the book off a nil bidder who stood winning);
 *              wins the book that makes its side's contract; wins the book that
 *              locks another side's set — in cutthroat the same lock is an
 *              elimination on hand 1 or on a second consecutive set; or, on the
 *              final trick, ends the game on the projected score.
 *   2 STANDARD a trump steal — the Big Joker crosses a real trump the other side
 *              was winning with. Today's five-crack quake.
 *   1 LIGHT    everything else: led plainly, a plain follow, over its own side's
 *              standing trump.
 *
 * Contract/set facts use the engine's own booksStillNeeded with the book PROJECTED
 * in (thrower +1), so every boundary is exact — a nil partner's book completes the
 * contract only when the table's rules actually count it, and a set counts as
 * locked by THIS throw only when it was not already locked before it (the toss
 * poll's lock standard). Books hands have no contracts: those triggers are skipped.
 */
export function bigJokerCrackTier(st: GameState, card: Card): 1 | 2 | 3 | 4 {
  const r = st.rules;
  const all = [...st.tricks, st.trick];
  const ti = all.findIndex((t) => t.plays.some((p) => p.card === card));
  if (ti < 0) return 2; // no trick context — today's quake
  const plays = all[ti].plays;
  const idx = plays.findIndex((p) => p.card === card);
  const seat = plays[idx].seat;
  const before = plays.slice(0, idx);
  // 4 — MAX: the pair is down in this trick (a run's cards never arm a nuke).
  if (isNukeTrick(plays.slice(0, idx + 1))) return 4;
  // Books as of the START of this trick, so a cue built late (the trick already
  // complete, a surface remounted) reads the tier the throw actually had: un-bank
  // the winners of this trick and every later one.
  const won = st.tricksWon.map((n) => Math.max(0, n));
  for (let k = ti; k < st.tricks.length; k++) {
    const w = trickWinner(st.tricks[k].plays, r);
    if (w >= 0) won[w] = Math.max(0, won[w] - 1);
  }
  const total = tricksStillRemaining(st) + st.tricks.length;
  const afterTrick = total - ti - 1; // tricks left once this one completes
  const mySide = sideOf(seat, r);
  // 3 — HEAVY.
  if (isNilBid(st.bids[seat]) && won[seat] === 0) return 3; // busts the thrower's live nil
  if (before.length > 0) {
    const w = trickWinner(before, r);
    if (w >= 0 && isNilBid(st.bids[w]) && won[w] === 0) return 3; // saves that nil bidder's live nil
  }
  if (!isBooksHand(st.bids)) {
    const landed = [...won];
    landed[seat]++; // the sealed book, projected in
    if (
      booksStillNeeded(r, st.bids, won, mySide) === 1 &&
      booksStillNeeded(r, st.bids, landed, mySide) === 0
    )
      return 3; // the contract book
    for (let s = 0; s < sideCount(r); s++) {
      if (s === mySide) continue;
      const need = booksStillNeeded(r, st.bids, won, s);
      // locked once this book is gone (need > tricks left after), and not already
      // locked before it (need <= tricks left including this one)
      if (need !== null && need > afterTrick && need <= afterTrick + 1) return 3; // the set lock
    }
    if (afterTrick === 0) {
      // Final trick: the hand's outcome is fully determined — score it and ask
      // the engine whether the game ends on it. (The cast mirrors finishHand:
      // a landing cue exists only during play, when every bid is in.)
      const res = scoreHand(r, st.bids as Bid[], landed, st.scores, st.bags);
      const totals = st.scores.map((sc, s) => sc + (res[s]?.points ?? 0));
      if (checkGameEnd(r, totals)) return 3;
    }
  }
  // 2 — STANDARD: a trump steal (the Cut test, minus the deuce specifics).
  if (before.length > 0) {
    const w = trickWinner(before, r);
    if (w >= 0 && sideOf(w, r) !== mySide && isTrump(before.find((p) => p.seat === w)!.card, r))
      return 2;
  }
  return 1;
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
/**
 * Wheels EARNED (the confetti beat, owner 2026-11-05): a declaring side's
 * books reaching its contract on this transition. Partnership: a side from
 * wheelsFor whose combined books cross up to its combined bid. Cutthroat: a
 * player whose own bid is 10+ and whose own books cross up to that bid. The
 * threshold is the contract, not a flat 10 — a side that bid 12 and took 10
 * got set, and a set never celebrates (wheelsMade's rule). Books-bid-
 * themselves hands declare nothing, so they earn nothing here.
 */
export function wheelsEarned(rules: { partnerships: boolean; playerCount: number }, bids: readonly (number | string | null)[], before: readonly number[], after: readonly number[]): ({ side: number } | { seat: number })[] {
  if (rules.partnerships) {
    const sideBooks = (t: readonly number[], s: number) => (t[s] ?? 0) + (t[s + 2] ?? 0);
    return wheelsFor(rules, bids).flatMap((w) => (sideBooks(before, w.side) < w.total && sideBooks(after, w.side) >= w.total ? [{ side: w.side }] : []));
  }
  return after.flatMap((n, s) => {
    const b = bids[s];
    return typeof b === 'number' && b >= WHEELS_AT && (before[s] ?? 0) < b && n >= b ? [{ seat: s }] : [];
  });
}

/** A Wheels feat the RESULTS page replays: EARNED in the game's final
 *  hand — the contract crossing of a Wheels call, measured by the same
 *  wheelsEarned the live emit site uses, from zero over the final hand
 *  (books are per-hand) — keyed the same way the live site keys it
 *  (`<handNo>:earned:<side|seat>`), minus any key the table already
 *  showed live. The final hand only — a feat from an earlier hand had
 *  its moment at the table. A set Wheels earns nothing (no crossing
 *  ever happened), and the scored record's contractMade vetoes a side
 *  feat when it says the contract failed. */
export interface ResultsWheelsFeat {
  key: string;
  kind: 'earned';
  side?: number;
  seat?: number;
  bid?: number;
  books?: number;
}
export function resultsWheelsFeats(
  rules: { partnerships: boolean; playerCount: number },
  history: readonly { handNo: number; bids: readonly (number | string | null)[]; sides: { side: number; tricks: number; contractMade?: boolean | null }[] }[],
  finalTricksWon: readonly number[],
  shownLive: ReadonlySet<string>,
): ResultsWheelsFeat[] {
  const rec = history[history.length - 1];
  if (!rec) return [];
  const out: ResultsWheelsFeat[] = [];
  const push = (f: ResultsWheelsFeat) => { if (!shownLive.has(f.key)) out.push(f); };
  const zeros = finalTricksWon.map(() => 0);
  for (const e of wheelsEarned(rules, rec.bids, zeros, finalTricksWon)) {
    if ('side' in e) {
      const s = rec.sides.find((x) => x.side === e.side);
      if (s?.contractMade === false) continue;
      const bid = wheelsFor(rules, rec.bids).find((w) => w.side === e.side)?.total;
      const books = s?.tricks ?? ((finalTricksWon[e.side] ?? 0) + (finalTricksWon[e.side + 2] ?? 0));
      push({ key: `${rec.handNo}:earned:${e.side}`, kind: 'earned', side: e.side, bid, books });
    } else {
      const b = rec.bids[e.seat];
      push({ key: `${rec.handNo}:earned:${e.seat}`, kind: 'earned', seat: e.seat, bid: typeof b === 'number' ? b : undefined, books: finalTricksWon[e.seat] ?? 0 });
    }
  }
  return out;
}
