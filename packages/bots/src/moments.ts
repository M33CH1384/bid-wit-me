/**
 * Turn a game step (state before → after an action) into trash-talk moments for the talk engine.
 * Shared by the server (online) and the offline game.
 */
import { type Action, type Card, type GameState, effectiveSuit, isTrump, sideCount, sideOf, trickWinner } from '@spades/rules';
import type { TalkEvent } from './talk';

const LOW = new Set(['2', '3', '4', '5']);

export function momentsFor(before: GameState, action: Action, after: GameState): TalkEvent[] {
  const r = before.rules;
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
      if (card === 'BJ' && li >= 0 && bi > li) out.push({ kind: 'nuke', seat, side, card, them: all[li]!.seat });
      else if (takes && (card === 'BJ' || card === 'LJ')) out.push({ kind: 'joker', seat, side, card, them: prevWin });
      else if (takes && isTrump(card, r) && !isTrump(plays[0]!.card, r)) out.push({ kind: isTrump(prevCard, r) ? 'overcut' : 'cut', seat, side, card, them: prevWin });
      else if (!takes && !isTrump(card, r) && effectiveSuit(card, r) !== led && LOW.has(card[0]!) && sideOf(prevWin, r) !== side) out.push({ kind: 'duck', seat, side, card, them: seat });
    }
  }
  if (action.type === 'bid' && typeof action.bid === 'number' && action.bid >= 6) out.push({ kind: 'bigBid', seat: action.seat, side: sideOf(action.seat, r), bid: action.bid });
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
        else if (other !== undefined) out.push({ kind: 'nilBust', side: other, them: n.seat });
      }
      if (s.contractMade === false && other !== undefined) out.push({ kind: 'setThem', side: other, them: s.seats[0], bid: s.contract, gap: gapFor(other) });
      if (s.bagPenaltyCount > 0 && other !== undefined) out.push({ kind: 'bags', side: other, them: s.seats[0] });
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
    out.push({ kind: 'win', side: w, gap: gapFor(w) });
  }
  void sideCount;
  return out;
}
