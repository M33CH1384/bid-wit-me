import type { Card, PlayerView } from '@spades/rules';
import type { BotLevel } from './bidding';
import {
  type Knowledge, byPowerAsc, currentWinner, highest, isBoss, know, lowest, power, suitLength, suitOf, trump, winsNow,
} from './knowledge';

/** Lowest non-trump of the shortest side suit (to create voids), else plain lowest. */
function discard(k: Knowledge, cards: Card[]): Card {
  const non = cards.filter((c) => !trump(k, c));
  if (!non.length) return lowest(k, cards);
  const nonBoss = non.filter((c) => !isBoss(k, c));
  const pool = nonBoss.length ? nonBoss : non;
  return [...pool].sort((a, b) => suitLength(k, suitOf(k, a)) - suitLength(k, suitOf(k, b)) || power(k, a) - power(k, b))[0]!;
}

function playAsNil(k: Knowledge, legal: Card[]): Card {
  if (!k.plays.length) {
    // lead the lowest card, preferring non-trumps
    return lowest(k, legal);
  }
  const losers = legal.filter((c) => !winsNow(k, c));
  if (losers.length) return highest(k, losers); // dump the highest card that still loses
  const isLast = k.plays.length === k.n - 1;
  return isLast ? highest(k, legal) : lowest(k, legal);
}

function coverPartnerNil(k: Knowledge, legal: Card[]): Card {
  const partnerPlayed = k.plays.some((p) => p.seat === k.partner);
  const winners = legal.filter((c) => winsNow(k, c));
  if (!k.plays.length) {
    const bosses = legal.filter((c) => isBoss(k, c) && !trump(k, c));
    if (bosses.length) return highest(k, bosses);
    return highest(k, legal.filter((c) => !trump(k, c)).length ? legal.filter((c) => !trump(k, c)) : legal);
  }
  if (!partnerPlayed) {
    // partner still to play: win as high as possible so partner can duck under
    return winners.length ? highest(k, winners) : lowest(k, legal);
  }
  if (currentWinner(k) === k.partner) {
    if (winners.length) return k.plays.length === k.n - 1 ? lowest(k, winners) : highest(k, winners);
    return lowest(k, legal);
  }
  return discard(k, legal);
}

function wantTricks(k: Knowledge): boolean {
  if (k.booksHand) return true; // no contract and no bags: every book is +10
  if (k.need > 0) return true;
  // try to set the opponents when it's realistic (partner modes)
  return k.r.partnerships && k.oppNeed > 0 && k.remainingTricks - k.oppNeed <= 2;
}

function standardPlay(k: Knowledge, legal: Card[], level: BotLevel): Card {
  const isLast = k.plays.length === k.n - 1;
  if (!wantTricks(k)) {
    // contract made: duck to avoid bags
    if (!k.plays.length) return lowest(k, legal);
    const losers = legal.filter((c) => !winsNow(k, c));
    if (losers.length) return highest(k, losers);
    return isLast ? highest(k, legal) : lowest(k, legal);
  }
  if (!k.plays.length) {
    if (level === 'easy') return highest(k, legal);
    const nonTrump = legal.filter((c) => !trump(k, c));
    const bosses = nonTrump.filter((c) => isBoss(k, c));
    if (bosses.length) return [...bosses].sort((a, b) => suitLength(k, suitOf(k, b)) - suitLength(k, suitOf(k, a)))[0]!;
    const trumps = legal.filter((c) => trump(k, c));
    const myTrumps = k.hand.filter((c) => trump(k, c));
    if (trumps.length && isBoss(k, highest(k, trumps)) && myTrumps.length >= 3) return highest(k, trumps);
    if (nonTrump.length) {
      // singleton low lead when holding trumps to ruff later
      const singles = nonTrump.filter((c) => suitLength(k, suitOf(k, c)) === 1);
      if (singles.length && myTrumps.length) return lowest(k, singles);
      const longest = [...nonTrump].sort((a, b) => suitLength(k, suitOf(k, b)) - suitLength(k, suitOf(k, a)))[0]!;
      return lowest(k, nonTrump.filter((c) => suitOf(k, c) === suitOf(k, longest)));
    }
    return lowest(k, legal);
  }
  const winner = currentWinner(k)!;
  const winners = legal.filter((c) => winsNow(k, c));
  if (winner === k.partner && level === 'normal') {
    const winningCard = k.plays.find((p) => p.seat === winner)!.card;
    const safe = isLast || (isBoss(k, winningCard) && (trump(k, winningCard) || suitOf(k, winningCard) === suitOf(k, k.plays[0]!.card)));
    if (safe || !winners.length) return discard(k, legal);
  }
  if (!winners.length) return discard(k, legal);
  if (isLast || level === 'easy') return lowest(k, winners);
  const bossWinners = winners.filter((c) => isBoss(k, c));
  if (bossWinners.length) return [...bossWinners].sort(byPowerAsc(k))[0]!;
  if (winners.every((c) => trump(k, c))) return lowest(k, winners);
  // second hand low (partner still to play), third hand high
  const partnerStillToPlay = k.partner !== null && !k.plays.some((p) => p.seat === k.partner);
  if (partnerStillToPlay && k.plays.length === 1) return discard(k, legal);
  return highest(k, winners);
}

function setOpponentNil(k: Knowledge, legal: Card[]): Card | null {
  const nilSeat = k.oppCleanNils[0];
  if (nilSeat === undefined) return null;
  if (!k.plays.length) {
    // lead low in a suit to force the nil player to win
    return lowest(k, legal);
  }
  const nilPlayed = k.plays.some((p) => p.seat === nilSeat);
  if (nilPlayed && currentWinner(k) === nilSeat) {
    const losers = legal.filter((c) => !winsNow(k, c));
    if (losers.length) return highest(k, losers);
  }
  if (!nilPlayed) return lowest(k, legal); // leave room underneath
  return null;
}

export function choosePlay(v: PlayerView, level: BotLevel): Card {
  const legal = v.legal;
  if (legal.length === 1) return legal[0]!;
  const k = know(v);
  if (k.myNil) return playAsNil(k, legal);
  if (k.partnerCleanNil) return coverPartnerNil(k, legal);
  if (level === 'normal' && k.oppCleanNils.length) {
    const c = setOpponentNil(k, legal);
    if (c) return c;
  }
  return standardPlay(k, legal, level);
}

/** Blind Nil exchange: the nil player passes high cards, the partner passes low ones. */
export function chooseExchange(v: PlayerView): Card[] {
  const k = know(v);
  const step = v.exchange[0]!;
  const sorted = [...k.hand].sort(byPowerAsc(k));
  return v.bids[v.seat] === 'blindNil' ? sorted.slice(-step.count) : sorted.slice(0, step.count);
}
