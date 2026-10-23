/**
 * Turn a game step (state before → after an action) into trash-talk moments for the talk engine.
 * Shared by the server (online) and the offline game.
 */
import { type Action, type Card, type GameState, effectiveSuit, isTrump, legalPlays, rulesForLive, sideCount, sideOf, tricksStillRemaining, trickWinner } from '@spades/rules';
import type { GapBucket, TalkEvent, TricksLeftBucket } from './talk';

const LOW = new Set(['2', '3', '4', '5']);

export function momentsFor(before: GameState, action: Action, after: GameState): TalkEvent[] {
  const r = rulesForLive(before);
  const out: TalkEvent[] = [];
  const gapFor = (side: number) => {
    const s = after.scores; const others = s.filter((_, i) => i !== side);
    return (s[side] ?? 0) - Math.max(...others, -Infinity);
  };

  // ---- contextual facts for bot speech (additive: kinds/speakers/cooldowns unchanged) ----
  const gapBucketFor = (side: number, scores: number[]): GapBucket | undefined => gapBucketForScores(scores, r.targetScore, side);
  const tricksBucket = (st: GameState): TricksLeftBucket => {
    const left = tricksStillRemaining(st);
    return left <= 3 ? 'late' : left <= 6 ? 'mid' : 'early';
  };
  /** facts for a moment about `side`, scored on `after`, trick clock on `after` */
  const factsFor = (side: number, bidder?: { seat: number; side: number }): Partial<TalkEvent> => {
    const gapBucket = gapBucketFor(side, after.scores);
    const tricksLeft = tricksBucket(after);
    const setsBySide: number[] = [];
    for (const h of after.history) for (const s of h.sides) if (s.contractMade === false) setsBySide[s.side] = (setsBySide[s.side] ?? 0) + 1;
    return {
      ...(gapBucket ? { gapBucket } : {}), tricksLeft, setsBySide,
      // pressure: late in a close game, or a late trick the side still needs for its contract
      ...((tricksLeft === 'late' && gapBucket === 'close') || (tricksStillRemaining(after) <= 2 && needsBooks(before, side)) ? { pressure: true } : {}),
      ...(bidder ? { bidderSeat: bidder.seat, bidderSide: bidder.side } : {}),
    };
  };
  // 'Run it!': the claimer speaks first (its own line), the other side may grumble
  if (action.type === 'runIt') out.push({ kind: 'runIt', side: sideOf(action.seat, r), seat: action.seat, gap: gapFor(sideOf(action.seat, r)), ...factsFor(sideOf(action.seat, r)) });
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
      if (card === 'BJ' && li >= 0 && bi > li) out.push({ kind: 'nuke', seat, side, card, them: all[li]!.seat, ...factsFor(side) });
      else if (takes && partnerWinning && isTrump(card, r) && !isTrump(prevCard, r) && !isNilSeat(before, prevWin)) {
        // cut your own partner's winner: the partner groans (or the other side laughs)
        out.push({ kind: 'partnerBlunder', seat, side, card, them: seat, ...factsFor(side) });
      } else if (takes && (card === 'BJ' || card === 'LJ')) out.push({ kind: 'joker', seat, side, card, them: prevWin, ...factsFor(side) });
      else if (takes && isTrump(card, r) && !isTrump(plays[0]!.card, r)) out.push({ kind: isTrump(prevCard, r) ? 'overcut' : 'cut', seat, side, card, them: prevWin, ...(prevCard[0] === 'A' && !isTrump(prevCard, r) ? { ace: true } : {}), ...factsFor(side) });
      else if (!takes && !isTrump(card, r) && effectiveSuit(card, r) !== led && LOW.has(card[0]!) && sideOf(prevWin, r) !== side) out.push({ kind: 'duck', seat, side, card, them: seat, ...factsFor(side) });
      else if (!takes && r.partnerships && all.length === r.playerCount && !partnerWinning && !isNilSeat(before, seat) && needsBooks(before, side)) {
        // last to play, the book was there for the taking, and the side still needs books: ducked a sure book
        const could = legalPlays(before, seat).some((c) => trickWinner([...plays, { seat, card: c }], r) === seat);
        if (could) out.push({ kind: 'partnerBlunder', seat, side, card, them: seat, ...factsFor(side) });
      }
      // a trick taken with a big card by the last player: a slam
      if (takes && all.length === r.playerCount && (card[0] === 'A' || card[0] === 'K' || card === 'BJ' || (isTrump(card, r) && 'AKQ'.includes(card[0]!)))) out.push({ kind: 'slam', seat, side, card, them: prevWin, ...factsFor(side) });
      // the trick just completed (density pass): the cadence floor — the
      // talk engine decides whether anyone pops (profile-gated, dormant at
      // standard tables). `seat`/`side` name the WINNER; `them` is a seat
      // that lost the book.
      if (all.length === r.playerCount) {
        const winner = trickWinner(all, r);
        const wSide = sideOf(winner, r);
        const loser = all.find((p) => sideOf(p.seat, r) !== wSide)?.seat;
        out.push({ kind: 'trickPop', seat: winner, side: wSide, ...(loser !== undefined ? { them: loser } : {}), ...factsFor(wSide) });
      }
      // a Nil just took its first book
      const nilTaker = trickWinner(all, r);
      if (all.length === r.playerCount && isNilSeat(before, nilTaker) && (before.tricksWon[nilTaker] ?? 0) === 0 && r.partnerships) {
        out.push({ kind: 'nilBust', side: 1 - sideOf(nilTaker, r), them: nilTaker, ...factsFor(1 - sideOf(nilTaker, r), { seat: nilTaker, side: sideOf(nilTaker, r) }) });
      }
    }
  }
  if (action.type === 'bid' && typeof action.bid === 'number') {
    const big = r.partnerships ? 6 : 5;
    if (action.bid >= big) {
      out.push({ kind: 'bigBid', seat: action.seat, side: sideOf(action.seat, r), bid: action.bid, ...factsFor(sideOf(action.seat, r), { seat: action.seat, side: sideOf(action.seat, r) }) });
      out.push({ kind: 'bidTooHigh', seat: action.seat, side: sideOf(action.seat, r), them: action.seat, bid: action.bid, ...factsFor(sideOf(action.seat, r), { seat: action.seat, side: sideOf(action.seat, r) }) });
    }
    // the bidder's own hand (bluff-safe: keyed off the bid only, and sometimes said with a decent hand too)
    if (action.bid <= 2 || (action.bid <= 4 && hashBit(`${before.seed}:${before.handNo}:${action.seat}`))) out.push({ kind: 'badHand', seat: action.seat, side: sideOf(action.seat, r), ...factsFor(sideOf(action.seat, r), { seat: action.seat, side: sideOf(action.seat, r) }) });
  }
  if (action.type === 'bid' && action.bid === 'nil') out.push({ kind: 'nilBid', seat: action.seat, side: sideOf(action.seat, r), them: action.seat, ...factsFor(sideOf(action.seat, r), { seat: action.seat, side: sideOf(action.seat, r) }) });
  if (action.type === 'bid' && action.bid === 'blindNil') out.push({ kind: 'blindNil', seat: action.seat, side: sideOf(action.seat, r), them: action.seat, ...factsFor(sideOf(action.seat, r), { seat: action.seat, side: sideOf(action.seat, r) }) });
  if (action.type === 'bid' && before.phase === 'bidding' && after.phase !== 'bidding' && r.partnerships) {
    // bidding done: roast a scared-small or huge team bid
    for (let side = 0; side < 2; side++) {
      const total = after.bids.reduce<number>((s, b, i) => s + (sideOf(i, r) === side && typeof b === 'number' ? b : 0), 0);
      if (total >= 10 || (total > 0 && total <= 3)) out.push({ kind: 'roastBid', side: 1 - side, bid: total, ...factsFor(1 - side) });
    }
  }
  if (after.history.length > before.history.length) {
    const h = after.history[after.history.length - 1]!;
    for (const s of h.sides) {
      const other = r.partnerships ? 1 - s.side : undefined;
      if (r.partnerships ? (s.contract >= 10 && s.contractMade) || (h.bids.every((b) => b === 'books') && s.tricks >= 10) : s.tricks >= 10) out.push({ kind: 'wheels', side: s.side, seat: s.seats[0], bid: s.contract, books: s.tricks, gap: gapFor(s.side), ...factsFor(s.side, { seat: s.seats[0]!, side: s.side }) });
      for (const n of s.nils) {
        if (n.made) out.push({ kind: 'nilMade', side: s.side, seat: n.seat, ...factsFor(s.side, { seat: n.seat, side: s.side }) });
        // (a busted Nil is called the moment it takes its first book, above)
      }
      if (s.contractMade === false && other !== undefined) out.push({ kind: 'setThem', side: other, them: s.seats[0], bid: s.contract, books: s.tricks, gap: gapFor(other), ...((after.scores[s.side] ?? 0) < 0 ? { neg: true } : {}), ...factsFor(other, { seat: s.seats[0]!, side: s.side }) });
      if ((s.bagPenaltyCount > 0 || (s.contractMade && s.tricks - s.contract >= 3)) && other !== undefined) out.push({ kind: 'bags', side: other, them: s.seats[0], ...factsFor(other, { seat: s.seats[0]!, side: s.side }) });
      if (s.tricks >= 13 && typeof s.contract === 'number') out.push({ kind: 'boston', side: s.side, seat: s.seats[0], ...factsFor(s.side, { seat: s.seats[0]!, side: s.side }) });
      if (s.shot && !after.result && other !== undefined) out.push({ kind: 'onNotice', side: other, them: s.seats[0], ...factsFor(other, { seat: s.seats[0]!, side: s.side }) });
    }
    for (const s of h.sides) if (s.contractMade && !(s.contract >= 10)) out.push({ kind: 'made', side: s.side, seat: s.seats[0], bid: s.contract, ...factsFor(s.side, { seat: s.seats[0]!, side: s.side }) });
    // streak: the same side out-scored everyone the last 3 hands
    const last = after.history.slice(-3);
    if (last.length === 3 && !after.result) {
      const best = (x: typeof h) => x.sides.reduce((a, b) => (b.points > a.points ? b : a)).side;
      const b0 = best(last[0]!);
      if (last.every((x) => best(x) === b0)) out.push({ kind: 'streak', side: b0, ...factsFor(b0) });
    }
    // bags trouble: a side is 7–9 bags deep, one or two books from the 10-bag penalty
    if (r.partnerships && !after.result) {
      for (const s of h.sides) {
        const other = 1 - s.side;
        const already = out.some((e) => e.kind === 'bags' && e.them === s.seats[0]);
        if (!already && (after.bags[s.side] ?? 0) >= 7) out.push({ kind: 'bags', side: other, them: s.seats[0], ...factsFor(other, { seat: s.seats[0]!, side: s.side }) });
      }
    }
    // match point: the leading side sits within one big hand (100) of the target
    if (!after.result) {
      const lead = Math.max(...after.scores);
      after.scores.forEach((score, side) => {
        const left = r.targetScore - score;
        if (score === lead && left > 0 && left <= 100) out.push({ kind: 'matchPoint', side, ...factsFor(side), pressure: true });
      });
    }
  }
  if (after.result && !before.result) {
    const w = after.result.winners[0]!;
    if (after.result.endReason === 'shotOut') out.push({ kind: 'shotOut', side: w, gap: gapFor(w), ...factsFor(w), pressure: true });
    out.push({ kind: 'win', side: w, gap: gapFor(w), ...factsFor(w), pressure: true });
  }
  void sideCount;
  // the most recently completed hand's winner, for 'wonPrevHand' lines
  // ("back to back"): at play time that's the hand before this one; for
  // the hand-completion events above it's the hand that just finished
  const lastRec = after.history[after.history.length - 1];
  if (lastRec) {
    const pw = lastRec.sides.reduce((a, b) => (b.points > a.points ? b : a)).side;
    for (const ev of out) ev.prevWinnerSide = pw;
  }
  return out;
}

/** score-gap bucket for a side, scaled to the target (500: big = 125+, close = within 50) */
export function gapBucketForScores(scores: number[], target: number, side: number): GapBucket | undefined {
  const gap = (scores[side] ?? 0) - Math.max(...scores.filter((_, i) => i !== side), -Infinity);
  const big = Math.max(75, target * 0.25), close = Math.max(25, target * 0.1);
  return gap >= big ? 'aheadBig' : gap <= -big ? 'behindBig' : Math.abs(gap) <= close ? 'close' : undefined;
}

/**
 * What just happened in the last completed hand, in banter terms — the context the
 * card-collection banter routes on (talk.ts `collectionBanter`). Computed from the
 * hand record + totals with the SAME predicates momentsFor uses for its hand-end
 * events, so the two never disagree about what happened.
 */
export interface BanterContext {
  setSides: number[];
  madeSides: number[];
  bostonSides: number[];
  wheelsSides: number[];
  nilMadeSeats: number[];
  nilBustSeats: number[];
  /** sides that ate a bag penalty this hand */
  bagsSides: number[];
  /** sides whose running bags are 7–9: a penalty is one or two books away */
  bagsHotSides: number[];
  shotSides: number[];
  streakSide?: number;
  matchPointSides: number[];
  /** per-side score-gap bucket after the hand */
  buckets: (GapBucket | undefined)[];
  /** per side: points scored in the last hand */
  handPoints: number[];
  /** per side: tricks taken in the last hand */
  handTricks: number[];
  /** per side: the seat that held the side's contract in the last hand */
  contractSeat: (number | undefined)[];
  /** per side: that contract, when numeric */
  contractBid: (number | undefined)[];
}

export function banterContextFor(after: GameState): BanterContext | null {
  const h = after.history[after.history.length - 1];
  if (!h) return null;
  const r = rulesForLive(after);
  const ctx: BanterContext = {
    setSides: [], madeSides: [], bostonSides: [], wheelsSides: [], nilMadeSeats: [], nilBustSeats: [],
    bagsSides: [], bagsHotSides: [], shotSides: [], matchPointSides: [],
    buckets: after.scores.map((_, side) => gapBucketForScores(after.scores, r.targetScore, side)),
    handPoints: [], handTricks: [], contractSeat: [], contractBid: [],
  };
  for (const s of h.sides) {
    ctx.handPoints[s.side] = s.points;
    ctx.handTricks[s.side] = s.tricks;
    ctx.contractSeat[s.side] = s.seats[0];
    ctx.contractBid[s.side] = typeof s.contract === 'number' ? s.contract : undefined;
    if (s.contractMade === false) ctx.setSides.push(s.side);
    if (s.contractMade) ctx.madeSides.push(s.side);
    if (r.partnerships ? (s.contract >= 10 && s.contractMade) || (h.bids.every((b) => b === 'books') && s.tricks >= 10) : s.tricks >= 10) ctx.wheelsSides.push(s.side);
    for (const n of s.nils) (n.made ? ctx.nilMadeSeats : ctx.nilBustSeats).push(n.seat);
    if (s.bagPenaltyCount > 0) ctx.bagsSides.push(s.side);
    else if ((after.bags[s.side] ?? 0) >= 7) ctx.bagsHotSides.push(s.side);
    if (s.tricks >= 13 && typeof s.contract === 'number') ctx.bostonSides.push(s.side);
    if (s.shot && !after.result) ctx.shotSides.push(s.side);
  }
  const last = after.history.slice(-3);
  if (last.length === 3 && !after.result) {
    const best = (x: typeof h) => x.sides.reduce((a, b) => (b.points > a.points ? b : a)).side;
    const b0 = best(last[0]!);
    if (last.every((x) => best(x) === b0)) ctx.streakSide = b0;
  }
  if (!after.result) {
    const lead = Math.max(...after.scores);
    after.scores.forEach((score, side) => {
      const left = r.targetScore - score;
      if (score === lead && left > 0 && left <= 100) ctx.matchPointSides.push(side);
    });
  }
  return ctx;
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
