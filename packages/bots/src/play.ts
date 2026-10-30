import { type Card, type PlayerView, type Play, type Rng, createRng, legalPlaysFor, trickWinner, trumpOrder } from '@spades/rules';
import { type BotLevel, type BotSkill, skillOf } from './bidding';
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

/** The top trumps (Big / Little Joker, the 2s in the house order, A♠…) — "premium" cards a good player saves. */
export function isPremium(k: Pick<Knowledge, 'r'>, c: Card): boolean {
  const order = trumpOrder(k.r);
  const i = order.indexOf(c);
  return i >= 0 && i < Math.min(4, order.length);
}

function playAsNil(k: Knowledge, legal: Card[]): Card {
  if (!k.plays.length) return lowest(k, legal);
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
  if (!partnerPlayed) return winners.length ? highest(k, winners) : lowest(k, legal); // win high so partner can duck under
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

/** Seats still to play after me in this trick. */
function seatsAfter(k: Knowledge): number[] {
  const out: number[] = [];
  for (let i = k.plays.length + 1; i < k.n; i++) out.push((k.seat + i - k.plays.length) % k.n);
  return out;
}

/**
 * Could an opponent still to act beat `c`? Card counting (pro / shark): only unseen cards, and a card of another
 * suit only from a seat known to be void in the led suit (or when the led suit is nearly gone). Regular players
 * count nothing: a cut always "looks" safe to them unless it's beatable in-suit.
 */
function threatened(k: Knowledge, c: Card, counting: boolean): boolean {
  const opps = seatsAfter(k).filter((s) => s !== k.partner);
  if (!opps.length) return false;
  const plays: Play[] = [...k.plays, { seat: k.seat, card: c }];
  const led = suitOf(k, plays[0]!.card);
  const unseenLed = [...k.unseen].filter((u) => suitOf(k, u) === led).length;
  for (const s of opps) {
    const mayBeVoid = k.voids[s]!.has(led) || (counting && unseenLed <= Math.max(1, opps.length - 1));
    for (const u of k.unseen) {
      const us = suitOf(k, u);
      if (us !== led && !(counting ? mayBeVoid : false)) continue;
      if (us !== led && k.voids[s]!.has(us)) continue; // known out of that suit too
      if (trickWinner([...plays, { seat: s, card: u }], k.r) === s) return true;
    }
  }
  return false;
}

/**
 * The card to win with: the CHEAPEST winner that holds up against everyone still to play. Premium trumps (Jokers, 2s)
 * only go when nothing cheaper wins, the contract can't afford to lose this book, or they're needed to beat a high trump.
 */
function pickWinner(k: Knowledge, winners: Card[], skill: BotSkill): Card {
  const asc = [...winners].sort(byPowerAsc(k));
  if (skill === 'regular') return asc[0]!;
  const counting = skill === 'pro' || skill === 'shark';
  const safe = asc.filter((c) => !threatened(k, c, counting));
  if (!safe.length) return asc[0]!; // can't guarantee it: make them pay with the cheapest
  const s0 = safe[0]!;
  if (s0 === asc[0] || !isPremium(k, s0)) return s0;
  const top = k.plays.length ? k.plays.find((p) => p.seat === currentWinner(k))!.card : null;
  const mustHave = (k.need > 0 && k.need >= k.remainingTricks - 1) || (!!top && isPremium(k, top)) || k.remainingTricks <= 3;
  return mustHave ? s0 : asc[0]!;
}

function standardPlay(k: Knowledge, legal: Card[], skill: BotSkill): Card {
  const isLast = k.plays.length === k.n - 1;
  if (!wantTricks(k)) {
    // contract made: duck to avoid bags
    if (!k.plays.length) return lowest(k, legal);
    const losers = legal.filter((c) => !winsNow(k, c));
    if (losers.length) return highest(k, losers);
    return isLast ? highest(k, legal) : lowest(k, legal);
  }
  if (!k.plays.length) {
    const nonTrump = legal.filter((c) => !trump(k, c));
    const bosses = nonTrump.filter((c) => isBoss(k, c));
    if (bosses.length) return [...bosses].sort((a, b) => suitLength(k, suitOf(k, b)) - suitLength(k, suitOf(k, a)))[0]!;
    const trumps = legal.filter((c) => trump(k, c));
    const myTrumps = k.hand.filter((c) => trump(k, c));
    // pull trump with the boss when long in it (that's what the Jokers are for)
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
  if (!winners.length) return discard(k, legal);
  if (winner === k.partner) {
    const winningCard = k.plays.find((p) => p.seat === winner)!.card;
    // never over-trump your partner; let a partner's sure winner ride
    const partnerSafe = !threatened(k, discard(k, legal), skill !== 'regular');
    if (isLast || trump(k, winningCard) || partnerSafe) return discard(k, legal);
    // partner's card may get beaten: take over only with a cheap sure winner in the led suit (never a trump)
    const inSuit = winners.filter((c) => !trump(k, c) && !threatened(k, c, skill !== 'regular'));
    return inSuit.length ? lowest(k, inSuit) : discard(k, legal);
  }
  if (isLast) return lowest(k, winners);
  // second hand low when following suit with partner still to play and no cheap sure winner
  const partnerStillToPlay = k.partner !== null && !k.plays.some((p) => p.seat === k.partner);
  const following = !winners.every((c) => trump(k, c)) || trump(k, k.plays[0]!.card);
  if (following && partnerStillToPlay && k.plays.length === 1) {
    const sure = winners.filter((c) => !threatened(k, c, skill !== 'regular') && !isPremium(k, c));
    return sure.length ? lowest(k, sure) : discard(k, legal);
  }
  return pickWinner(k, winners, skill);
}

function setOpponentNil(k: Knowledge, legal: Card[]): Card | null {
  const nilSeat = k.oppCleanNils[0];
  if (nilSeat === undefined) return null;
  if (!k.plays.length) return lowest(k, legal); // lead low in a suit to force the nil player to win
  const nilPlayed = k.plays.some((p) => p.seat === nilSeat);
  if (nilPlayed && currentWinner(k) === nilSeat) {
    const losers = legal.filter((c) => !winsNow(k, c));
    if (losers.length) return highest(k, losers);
  }
  if (!nilPlayed) return lowest(k, legal); // leave room underneath
  return null;
}

/** How often a Novice makes a sloppy play (when it has a real choice). */
export const NOVICE_BLUNDER_RATE = 0.3;

/** A Novice mistake: wastes its highest winner (often a Joker / big trump) or just plays something random. Always legal. */
function sloppy(k: Knowledge, legal: Card[], rng: Rng): Card {
  // An empty pool must never reach rng.int (RangeError: bad range 0): fall back to the
  // ordinary selection over the legal set derived from the hand itself.
  if (!legal.length) return standardPlay(k, legalPlaysFor(k.r, k.hand, k.plays, k.v.spadesBroken), 'regular');
  const winners = k.plays.length ? legal.filter((c) => winsNow(k, c)) : [];
  if (winners.length && rng.float() < 0.7) return highest(k, winners);
  return legal[rng.int(legal.length)]!;
}

export function choosePlay(v: PlayerView, level: BotLevel, rng: Rng = createRng(`${v.seat}:${v.handNo}:${v.tricks.length}:${v.trick.plays.length}`)): Card {
  // A view can arrive with an empty legal list while the seat still holds cards (a resumed /
  // hand-built state — reproduced 2026-10-30 as a RangeError from the novice sloppy path).
  // Recompute the candidates from the hand the engine way instead of playing from an empty set.
  const legal = v.legal.length ? v.legal : legalPlaysFor(v.rules, v.hand ?? [], v.trick.plays, v.spadesBroken, v.rules.firstLead === 'twoOfClubs' && v.tricks.length === 0);
  if (legal.length === 1) return legal[0]!;
  const skill = skillOf(level);
  const k = know(v);
  if (skill === 'novice' && rng.float() < NOVICE_BLUNDER_RATE) return sloppy(k, legal, rng);
  if (k.myNil) return playAsNil(k, legal);
  if (k.partnerCleanNil) return coverPartnerNil(k, legal);
  if ((skill === 'pro' || skill === 'shark') && k.oppCleanNils.length) {
    const c = setOpponentNil(k, legal);
    if (c) return c;
  }
  if (skill === 'shark' && wantTricks(k) && !k.booksHand && k.hand.length <= 3) {
    const c = endgame(k, legal, rng);
    if (c) return c;
  }
  return standardPlay(k, legal, skill === 'novice' ? 'regular' : skill);
}

/**
 * Shark endgame: deal the unseen cards to the other seats consistently with their hand counts and known voids
 * (several samples), solve each deal exactly (alpha-beta, my side maximises its books), and play the card that wins
 * the most books on average (cheapest card on ties). Never peeks: only the seat's own view is used.
 */
function endgame(k: Knowledge, legal: Card[], rng: Rng): Card | null {
  const v = k.v;
  const counts = v.handCounts.map((c, s) => (s === k.seat ? 0 : c));
  const unseen = [...k.unseen];
  if (unseen.length !== counts.reduce((a, b) => a + b, 0)) return null;
  const mine = (s: number) => (k.partner === null ? s === k.seat : s === k.seat || s === k.partner);
  const score = new Map<Card, number>(legal.map((c) => [c, 0]));
  let budget = 150_000;
  const SAMPLES = 10;
  for (let n = 0; n < SAMPLES; n++) {
    const hands = deal(k, unseen, counts, rng);
    if (!hands) continue;
    hands[k.seat] = [...k.hand];
    for (const c of legal) {
      const h = hands.map((x) => [...x]);
      h[k.seat] = h[k.seat]!.filter((x) => x !== c);
      const plays = [...k.plays, { seat: k.seat, card: c }];
      const val = solve(h, plays, plays[0]!.seat, -1, 99);
      if (val === null) return null;
      score.set(c, score.get(c)! + val);
    }
  }
  return [...legal].sort((a, b) => score.get(b)! - score.get(a)! || byPowerAsc(k)(a, b))[0]!;

  // books my side takes from here (trick in progress included); `leader` leads the trick in `plays`
  function solve(h: Card[][], plays: Play[], leader: number, alpha: number, beta: number): number | null {
    if (--budget < 0) return null;
    if (plays.length === k.n) {
      const w = trickWinner(plays, k.r);
      const got = mine(w) ? 1 : 0;
      if (h.every((x) => !x.length)) return got;
      const rest = solve(h, [], w, alpha - got, beta - got);
      return rest === null ? null : got + rest;
    }
    const who = nextSeat(leader, plays.length);
    const opts = legalPlaysFor(k.r, h[who]!, plays, true);
    if (!opts.length) return 0;
    const max = mine(who);
    let best = max ? -1 : 99;
    for (const c of opts) {
      const nh = h.slice(); nh[who] = h[who]!.filter((x) => x !== c);
      const val = solve(nh, [...plays, { seat: who, card: c }], leader, alpha, beta);
      if (val === null) return null;
      if (max) { best = Math.max(best, val); alpha = Math.max(alpha, val); } else { best = Math.min(best, val); beta = Math.min(beta, val); }
      if (alpha >= beta) break;
    }
    return best;
  }
  function nextSeat(leader: number, i: number): number { return (leader + i) % k.n; }
}

function deal(k: Knowledge, unseen: Card[], counts: number[], rng: Rng): Card[][] | null {
  for (let tries = 0; tries < 30; tries++) {
    const pool = [...unseen];
    for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(i + 1); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    const hands: Card[][] = counts.map(() => []);
    let ok = true;
    for (const c of pool) {
      const s = suitOf(k, c);
      const seats = counts.map((n, i) => i).filter((i) => hands[i]!.length < counts[i]! && !k.voids[i]!.has(s));
      if (!seats.length) { ok = false; break; }
      const pick = seats[rng.int(seats.length)]!;
      hands[pick]!.push(c);
    }
    if (ok) return hands;
  }
  return null;
}

/** Blind Nil exchange: the nil player passes high cards, the partner passes low ones. */
export function chooseExchange(v: PlayerView): Card[] {
  const k = know(v);
  const step = v.exchange[0]!;
  const sorted = [...k.hand].sort(byPowerAsc(k));
  return v.bids[v.seat] === 'blindNil' ? sorted.slice(-step.count) : sorted.slice(0, step.count);
}
