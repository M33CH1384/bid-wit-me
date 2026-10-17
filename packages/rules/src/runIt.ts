import type { Card, Suit } from './cards';
import { type TableRules, cardPower, effectiveSuit, isTrump } from './config';
import { RUN_IT_MAX, type GameState, type Play, type Seat, legalPlaysFor, trickWinner } from './game';

/**
 * 'Run it!' from one seat's point of view.
 *
 * The seat knows its own cards, every card played, how many cards each other seat still holds, and which suits
 * those seats have shown out of. It does not know how the remaining cards are split. The claim is legal only when
 * that seat can force every remaining trick — the one on the table included — against every distribution of the
 * outstanding cards and every legal reply, partner included.
 *
 * The proof reads the other hands only to learn the set of outstanding cards (a complete play history determines
 * that same set) and then forgets which seat held which. Two layouts of one set always get the same answer.
 * Each seat is proved at most once per state object. Spectators never ask, so they never pay for it.
 */

const SUIT_BIT: Record<Suit, number> = { S: 1, H: 2, D: 4, C: 8 };
const BIT_INDEX = [0, 0, 1, 0, 2, 0, 0, 0, 3]; // index by suit bit 1,2,4,8
const ALL_VOID = 15;
const OFF_TRUMP = SUIT_BIT.H | SUIT_BIT.D | SUIT_BIT.C;

let proofsRun = 0;
let cacheGeneration = 0;
const byState = new WeakMap<GameState, Array<boolean | undefined>>();
const generationOf = new WeakMap<GameState, number>();

/** How many seat-proofs have started since the last reset. A cache hit does not count. */
export function runItProofsRun(): number {
  return proofsRun;
}

export function resetRunItProofs(): void {
  proofsRun = 0;
  cacheGeneration++;
}

/** Guaranteed from information `seat` can see. Memoized on the state object, one entry per seat. */
export function evaluateRunIt(st: GameState, seat: Seat): boolean {
  if (st.phase !== 'playing' || st.turn === null) return false;
  const n = st.rules.playerCount;
  if (!Number.isInteger(seat) || seat < 0 || seat >= n) return false;
  const mine = st.hands[seat];
  if (!mine || mine.length < 2 || mine.length > RUN_IT_MAX) return false;
  let row = byState.get(st);
  if (!row || generationOf.get(st) !== cacheGeneration) {
    row = Array(n);
    byState.set(st, row);
    generationOf.set(st, cacheGeneration);
  }
  const cached = row[seat];
  if (cached !== undefined) return cached;
  proofsRun++;
  const answer = prove(st, seat);
  row[seat] = answer;
  return answer;
}

/** `a` wins a trick that also contains `b`: trumps, otherwise only a higher card of the same suit. */
function cardBeats(a: Card, b: Card, r: TableRules): boolean {
  const at = isTrump(a, r);
  const bt = isTrump(b, r);
  if (at !== bt) return at;
  if (!at && effectiveSuit(a, r) !== effectiveSuit(b, r)) return false;
  return cardPower(a, r) > cardPower(b, r);
}

function suitBit(card: Card, r: TableRules): number {
  return SUIT_BIT[effectiveSuit(card, r)];
}

/** Suits each seat has failed to follow. Read only from cards that are already face up. */
function shownVoids(st: GameState): number[] {
  const r = st.rules;
  const voids = Array<number>(r.playerCount).fill(0);
  const note = (plays: readonly Play[]) => {
    if (plays.length < 2) return;
    const led = suitBit(plays[0]!.card, r);
    for (let i = 1; i < plays.length; i++) if (suitBit(plays[i]!.card, r) !== led) voids[plays[i]!.seat] |= led;
  };
  for (const t of st.tricks) note(t.plays);
  note(st.trick.plays);
  return voids;
}

function outstanding(st: GameState, seat: Seat): Card[] {
  const cards: Card[] = [];
  for (let s = 0; s < st.rules.playerCount; s++) if (s !== seat) cards.push(...st.hands[s]!);
  cards.sort();
  return cards;
}

function prove(st: GameState, seat: Seat): boolean {
  const rules = st.rules;
  const n = rules.playerCount;
  const hand0 = [...st.hands[seat]!].sort();
  const unseen0 = outstanding(st, seat);
  const counts0 = st.hands.map((h) => h.length);
  const voids0 = shownVoids(st);
  const trick0: Play[] = st.trick.plays.map((p) => ({ seat: p.seat, card: p.card }));
  const turn0 = st.turn as number;
  const broken0 = st.spadesBroken;

  const feasMemo = new Map<string, boolean>();
  const memo = new Map<string, boolean>();

  /**
   * Seats act once per trick and empty hands are skipped — the very rules the engine's nextLive deals by.
   * Modeling a trick as `playerCount` plays in raw seat order breaks once a seat is eliminated: seats that
   * already played get asked for a phantom second card inside the same trick, burning cards (a trump that
   * would have ruffed the claimer's next lead) in a trick they were never really in, and the proof goes
   * through on a layout that cannot happen. (Found by the full bot games the moment Cutthroat's blanket
   * Run it! ban was lifted: the claim was 'proven', then the honest play-out lost the line and threw.)
   */
  const inTrick = (trick: readonly Play[], s: number): boolean => trick.some((pl) => pl.seat === s);
  /** A trick is complete when every seat has either played in it or holds no cards (eliminated / spent). */
  const trickDone = (trick: readonly Play[], counts: readonly number[]): boolean =>
    trick.length > 0 && counts.every((c, s) => c === 0 || inTrick(trick, s));
  /** The next seat that still has to act in this trick, skipping seats that played and empty hands. */
  const nextTurn = (from: number, trick: readonly Play[], counts: readonly number[]): number => {
    let t = from;
    for (let i = 0; i < n; i++) {
      t = (t + 1) % n;
      if (!inTrick(trick, t) && counts[t]! > 0) return t;
    }
    return from;
  };

  /**
   * Every card we still hold beats every outstanding card: definite, or null if the search still has work.
   * "Beats" is one-way. A diamond is not beaten by a club, and a club is not beaten by that diamond, but the
   * club still wins a trick it led. Treating "nothing beats us" as a win let an off-lead hand of unbeaten
   * side cards claim Run it, then the playout threw once the neighbour led a suit we could not win.
   */
  const fast = (hand: readonly Card[], unseen: readonly Card[], trick: readonly Play[], broken: boolean): boolean | null => {
    for (const c of hand) for (const u of unseen) if (!cardBeats(c, u, rules)) return null;
    if (trick.length === 0) return true;
    const mine = trick.find((p) => p.seat === seat);
    if (mine) {
      if (trickWinner(trick, rules) !== seat) return false;
      for (const u of unseen) if (cardBeats(u, mine.card, rules)) return false;
      return true;
    }
    const legal = legalPlaysFor(rules, hand, trick, broken);
    for (const c of legal) if (trickWinner([...trick, { seat, card: c }], rules) === seat) return true;
    return false;
  };

  const feasible = (need: readonly number[], counts: readonly number[], voids: readonly number[]): boolean => {
    const key = need.join(',') + '|' + counts.join(',') + '|' + voids.join(',');
    const hit = feasMemo.get(key);
    if (hit !== undefined) return hit;
    let total = 0;
    for (let s = 0; s < 4; s++) {
      const want = need[s]!;
      if (!want) continue;
      total += want;
      const bit = 1 << s;
      let cap = 0;
      for (let p = 0; p < n; p++) if (p !== seat && (voids[p]! & bit) === 0) cap += counts[p]!;
      if (cap < want) { feasMemo.set(key, false); return false; }
    }
    if (total === 0) { feasMemo.set(key, true); return true; }
    const order = [0, 1, 2, 3].filter((s) => need[s]! > 0);
    const left = need.slice();
    const cts = counts.slice();
    const seats: number[] = [];
    for (let p = 0; p < n; p++) if (p !== seat && cts[p]! > 0) seats.push(p);
    const go = (si: number): boolean => {
      while (si < order.length && left[order[si]!] === 0) si++;
      if (si === order.length) return true;
      const s = order[si]!;
      const bit = 1 << s;
      for (let i = 0; i < seats.length; i++) {
        const p = seats[i]!;
        if (cts[p]! <= 0 || (voids[p]! & bit)) continue;
        cts[p]!--;
        left[s]!--;
        if (go(si)) { cts[p]!++; left[s]!++; return true; }
        cts[p]!++;
        left[s]!++;
      }
      return false;
    };
    const ok = go(0);
    feasMemo.set(key, ok);
    return ok;
  };

  const placeable = (
    unseen: readonly Card[], counts: readonly number[], voids: readonly number[], who: number, card: Card, extra: number,
  ): boolean => {
    const bit = suitBit(card, rules);
    if (((voids[who]! | extra) & bit) !== 0) return false;
    if (counts[who]! <= 0) return false;
    const need = [0, 0, 0, 0];
    for (let i = 0; i < unseen.length; i++) {
      const c = unseen[i]!;
      if (c === card) continue;
      need[BIT_INDEX[suitBit(c, rules)]!]!++;
    }
    const cts = counts.slice();
    cts[who]!--;
    cts[seat] = 0;
    const vs = voids.slice();
    vs[who] = vs[who]! | extra;
    vs[seat] = ALL_VOID;
    return feasible(need, cts, vs);
  };

  /** Same suit, and they beat exactly the same cards of ours: only one of them can change the claim. */
  const classKey = (card: Card, hand: readonly Card[], trick: readonly Play[]): string => {
    let bits = effectiveSuit(card, rules);
    for (let i = 0; i < hand.length; i++) bits += cardBeats(card, hand[i]!, rules) ? '1' : '0';
    for (let i = 0; i < trick.length; i++) if (trick[i]!.seat === seat) bits += cardBeats(card, trick[i]!.card, rules) ? '1' : '0';
    return bits;
  };

  const playsFor = (
    hand: readonly Card[], unseen: readonly Card[], counts: readonly number[], voids: readonly number[],
    trick: readonly Play[], broken: boolean, who: number,
  ): Card[] => {
    if (counts[who]! <= 0 || unseen.length === 0) return [];
    const led: Suit | null = trick.length ? effectiveSuit(trick[0]!.card, rules) : null;
    const chosen = new Map<string, Card>();
    const hold = new Map<string, boolean>();
    for (let i = 0; i < unseen.length; i++) {
      const card = unseen[i]!;
      const suit = effectiveSuit(card, rules);
      if ((voids[who]! & SUIT_BIT[suit]) !== 0) continue;
      const trump = isTrump(card, rules);
      let mode: string;
      let extra = 0;
      if (led === null) {
        if (!broken && rules.spadesMustBeBroken && trump) { mode = 'T'; extra = OFF_TRUMP; }
        else mode = 'L';
      } else if (suit === led) mode = 'F';
      else { mode = 'O'; extra = SUIT_BIT[led]; }
      const hk = mode + suit;
      let ok = hold.get(hk);
      if (ok === undefined) { ok = placeable(unseen, counts, voids, who, card, extra); hold.set(hk, ok); }
      if (!ok) continue;
      const ck = classKey(card, hand, trick);
      const prev = chosen.get(ck);
      if (!prev || cardPower(card, rules) > cardPower(prev, rules)) chosen.set(ck, card);
    }
    const out: Card[] = [];
    for (const c of chosen.values()) out.push(c);
    out.sort((a, b) => cardPower(b, rules) - cardPower(a, rules));
    return out;
  };

  const wins = (
    hand: readonly Card[], unseen: readonly Card[], counts: readonly number[], voids: readonly number[],
    trick: Play[], turn: number, broken: boolean,
  ): boolean => {
    while (trickDone(trick, counts)) {
      const w = trickWinner(trick, rules);
      if (w !== seat) return false;
      if (hand.length === 0) return true;
      trick = [];
      turn = w;
    }
    const key = hand.join('.') + '|' + unseen.join('.') + '|' + counts.join(',') + '|' + voids.join(',') + '|'
      + trick.map((p) => String(p.seat) + p.card).join(',') + '|' + turn + (broken ? '!' : '');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const quick = fast(hand, unseen, trick, broken);
    if (quick !== null) { memo.set(key, quick); return quick; }

    let ans: boolean;
    if (turn === seat) {
      const legal = legalPlaysFor(rules, hand, trick, broken);
      legal.sort((a, b) => cardPower(b, rules) - cardPower(a, rules));
      ans = false;
      for (let i = 0; i < legal.length; i++) {
        const card = legal[i]!;
        const nextHand = hand.filter((c) => c !== card);
        const nextCounts = counts.slice();
        nextCounts[seat]!--;
        if (wins(nextHand, unseen, nextCounts, voids, [...trick, { seat, card }], nextTurn(turn, [...trick, { seat, card }], nextCounts), broken || isTrump(card, rules))) {
          ans = true;
          break;
        }
      }
    } else {
      const options = playsFor(hand, unseen, counts, voids, trick, broken, turn);
      if (options.length === 0) {
        // Count still left but no legal card fits any deal: that defense is not a real layout.
        ans = counts[turn]! > 0;
      } else {
        ans = true;
        const ledBit = trick.length ? suitBit(trick[0]!.card, rules) : 0;
        for (let i = 0; i < options.length; i++) {
          const card = options[i]!;
          const bit = suitBit(card, rules);
          const nextUnseen = unseen.filter((c) => c !== card);
          const nextCounts = counts.slice();
          nextCounts[turn]!--;
          let nextVoids = voids;
          if (ledBit && bit !== ledBit) {
            const copied = voids.slice();
            copied[turn] = copied[turn]! | ledBit;
            nextVoids = copied;
          }
          if (!wins(hand, nextUnseen, nextCounts, nextVoids, [...trick, { seat: turn, card }], nextTurn(turn, [...trick, { seat: turn, card }], nextCounts), broken || isTrump(card, rules))) {
            ans = false;
            break;
          }
        }
      }
    }
    memo.set(key, ans);
    return ans;
  };

  return wins(hand0, unseen0, counts0, voids0, trick0, turn0, broken0);
}
