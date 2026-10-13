/**
 * Turn a game step (state before → after an action) into trash-talk moments for the talk engine.
 * Shared by the server (online) and the offline game.
 */
import { type Action, type Card, type GameState, effectiveSuit, isTrump, legalPlays, rulesForLive, sideCount, sideOf, trickWinner } from '@spades/rules';
import type { TalkEvent } from './talk';

const LOW = new Set(['2', '3', '4', '5']);

export function momentsFor(before: GameState, action: Action, after: GameState): TalkEvent[] {
  const r = rulesForLive(before);
  const out: TalkEvent[] = [];
  const gapFor = (side: number) => {
    const s = after.scores; const others = s.filter((_, i) => i !== side);
    return (s[side] ?? 0) - Math.max(...others, -Infinity);
  };
  // 'Run it!': the claimer speaks first (its own line), the other side may grumble
  if (action.type === 'runIt') out.push({ kind: 'runIt', side: sideOf(action.seat, r), seat: action.seat, gap: gapFor(sideOf(action.seat, r)) });
  if (action.type === 'play') {
    const plays = before.trick.plays;
    const card = action.card as Card;
    const seat = action.seat;
    const side = sideOf(seat, r);
    if (plays.length) {
      const led = effectiveSuit(plays[0]!.card, r);
      const prevWin = trickWinner(plays, r);
      const prevCard = plays.find((p) => p.seat === prevWin)!.card;
      const all = [...plays, { seat, card }];
      const takes = trickWinner(all, r) === seat;
      const li = all.findIndex((p) => p.card === 'LJ'), bi = all.findIndex((p) => p.card === 'BJ');
      const partnerWinning = r.partnerships && prevWin !== seat && sideOf(prevWin, r) === side;
      if (card === 'BJ' && li >= 0 && bi > li) out.push({ kind: 'nuke', seat, side, card, them: all[li]!.seat });
      else if (takes && partnerWinning && isTrump(card, r) && !isTrump(prevCard, r) && !isNilSeat(before, prevWin)) {
        // cut your own partner's winner: the partner groans (or the other side laughs)
        out.push({ kind: 'partnerBlunder', seat, side, card, them: seat });
      } else if (takes && (card === 'BJ' || card === 'LJ')) out.push({ kind: 'joker', seat, side, card, them: prevWin });
      else if (takes && isTrump(card, r) && !isTrump(plays[0]!.card, r)) out.push({ kind: isTrump(prevCard, r) ? 'overcut' : 'cut', seat, side, card, them: prevWin, ...(prevCard[0] === 'A' && !isTrump(prevCard, r) ? { ace: true } : {}) });
      else if (!takes && !isTrump(card, r) && effectiveSuit(card, r) !== led && LOW.has(card[0]!) && sideOf(prevWin, r) !== side) out.push({ kind: 'duck', seat, side, card, them: seat });
      else if (!takes && r.partnerships && all.length === r.playerCount && !partnerWinning && !isNilSeat(before, seat) && needsBooks(before, side)) {
        // last to play, the book was there for the taking, and the side still needs books: ducked a sure book
        const could = legalPlays(before, seat).some((c) => trickWinner([...plays, { seat, card: c }], r) === seat);
        if (could) out.push({ kind: 'partnerBlunder', seat, side, card, them: seat });
      }
      // a trick taken with a big card by the last player: a slam
      if (takes && all.length === r.playerCount && (card[0] === 'A' || card[0] === 'K' || card === 'BJ' || (isTrump(card, r) && 'AKQ'.includes(card[0]!)))) out.push({ kind: 'slam', seat, side, card, them: prevWin });
      // a Nil just took its first book
      const nilTaker = trickWinner(all, r);
      if (all.length === r.playerCount && isNilSeat(before, nilTaker) && (before.tricksWon[nilTaker] ?? 0) === 0 && r.partnerships) {
        out.push({ kind: 'nilBust', side: 1 - sideOf(nilTaker, r), them: nilTaker });
      }
    }
  }
  if (action.type === 'bid' && typeof action.bid === 'number') {
    const big = r.partnerships ? 6 : 5;
    if (action.bid >= big) {
      out.push({ kind: 'bigBid', seat: action.seat, side: sideOf(action.seat, r), bid: action.bid });
      out.push({ kind: 'bidTooHigh', seat: action.seat, side: sideOf(action.seat, r), them: action.seat, bid: action.bid });
    }
    // the bidder's own hand (bluff-safe: keyed off the bid only, and sometimes said with a decent hand too)
    if (action.bid <= 2 || (action.bid <= 4 && hashBit(`${before.seed}:${before.handNo}:${action.seat}`))) out.push({ kind: 'badHand', seat: action.seat, side: sideOf(action.seat, r) });
  }
  if (action.type === 'bid' && action.bid === 'nil') out.push({ kind: 'nilBid', seat: action.seat, side: sideOf(action.seat, r), them: action.seat });
  if (action.type === 'bid' && action.bid === 'blindNil') out.push({ kind: 'blindNil', seat: action.seat, side: sideOf(action.seat, r), them: action.seat });
  if (action.type === 'bid' && before.phase === 'bidding' && after.phase !== 'bidding' && r.partnerships) {
    // bidding done: roast a scared-small or huge team bid
    for (let side = 0; side < 2; side++) {
      const total = after.bids.reduce<number>((s, b, i) => s + (sideOf(i, r) === side && typeof b === 'number' ? b : 0), 0);
      if (total >= 10 || (total > 0 && total <= 3)) out.push({ kind: 'roastBid', side: 1 - side, bid: total });
    }
  }
  if (after.history.length > before.history.length) {
    const h = after.history[after.history.length - 1]!;
    for (const s of h.sides) {
      const other = r.partnerships ? 1 - s.side : undefined;
      if (r.partnerships ? (s.contract >= 10 && s.contractMade) || (h.bids.every((b) => b === 'books') && s.tricks >= 10) : s.tricks >= 10) out.push({ kind: 'wheels', side: s.side, seat: s.seats[0], bid: s.contract, gap: gapFor(s.side) });
      for (const n of s.nils) {
        if (n.made) out.push({ kind: 'nilMade', side: s.side, seat: n.seat });
        // (a busted Nil is called the moment it takes its first book, above)
      }
      if (s.contractMade === false && other !== undefined) out.push({ kind: 'setThem', side: other, them: s.seats[0], bid: s.contract, gap: gapFor(other), ...((after.scores[s.side] ?? 0) < 0 ? { neg: true } : {}) });
      if ((s.bagPenaltyCount > 0 || (s.contractMade && s.tricks - s.contract >= 3)) && other !== undefined) out.push({ kind: 'bags', side: other, them: s.seats[0] });
      if (s.tricks >= 13 && typeof s.contract === 'number') out.push({ kind: 'boston', side: s.side, seat: s.seats[0] });
      if (s.shot && !after.result && other !== undefined) out.push({ kind: 'onNotice', side: other, them: s.seats[0] });
    }
    for (const s of h.sides) if (s.contractMade && !(s.contract >= 10)) out.push({ kind: 'made', side: s.side, seat: s.seats[0], bid: s.contract });
    // streak: the same side out-scored everyone the last 3 hands
    const last = after.history.slice(-3);
    if (last.length === 3 && !after.result) {
      const best = (x: typeof h) => x.sides.reduce((a, b) => (b.points > a.points ? b : a)).side;
      const b0 = best(last[0]!);
      if (last.every((x) => best(x) === b0)) out.push({ kind: 'streak', side: b0 });
    }
  }
  if (after.result && !before.result) {
    const w = after.result.winners[0]!;
    if (after.result.endReason === 'shotOut') out.push({ kind: 'shotOut', side: w, gap: gapFor(w) });
    out.push({ kind: 'win', side: w, gap: gapFor(w) });
  }
  void sideCount;
  return out;
}

function isNilSeat(st: GameState, seat: number): boolean { const b = st.bids[seat]; return b === 'nil' || b === 'blindNil'; }
/** the side still needs books to make its bid */
function needsBooks(st: GameState, side: number): boolean {
  const r = st.rules;
  let bid = 0, won = 0;
  st.bids.forEach((b, i) => { if (sideOf(i, r) === side) { if (typeof b === 'number') bid += b; if (!isNilSeat(st, i)) won += st.tricksWon[i] ?? 0; } });
  return won < bid;
}
function hashBit(s: string): boolean { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); } return (h >>> 0) % 4 === 0; }

/** A human chatting a lot (3+ messages in the last 10 s) while their side trails: a 'loudLoser' moment. */
export function loudLoser(st: GameState | null | undefined, seat: number | null | undefined, recent: number[]): TalkEvent | null {
  if (!st || seat === null || seat === undefined || st.result || recent.length < 3) return null;
  const side = sideOf(seat, st.rules);
  const mine = st.scores[side] ?? 0;
  if (!st.scores.some((x, i) => i !== side && x > mine)) return null;
  return { kind: 'loudLoser', seat, side, them: seat };
}
