import { type Card, type PlayerView, type Seat, createRng, effectiveSuit, isNilBid, isTrump, renegeOn } from '@spades/rules';
import { type BotLevel, type BotSkill, skillOf } from './bidding';
import { currentWinner, know, lowest, winsNow } from './knowledge';

/**
 * Renege tables (rules.renege): how bots take part. Two separate decisions, both made from the
 * seat's own view — a bot never reads the engine's private renege record.
 *
 *  - `chooseRenege`: should this bot cut a suit it is still holding? Rare, and only when a book it
 *    needs is slipping away. The DRIVER decides which bots may (never a bot partnered with a human:
 *    nobody should pay three books for a cheat their bot partner chose).
 *  - `chooseRenegeCall`: has this bot caught an opponent? Only a renege the table has SEEN: the
 *    opponent threw off the led suit in a finished book and later played a card of that suit. Weaker
 *    bots miss more of them. A bot never calls on a hunch, so a bot's call is never wrong.
 */

/** Chance, per hand, that a bot is willing to renege at all (it then needs the right spot to come up). */
export const RENEGE_HAND_RATE: Record<BotSkill, number> = { novice: 0.12, regular: 0.08, pro: 0.12, shark: 0.2 };

/** Chance a bot notices a renege once the proof is on the table. Rolled once per renege, per bot. */
export const RENEGE_NOTICE_RATE: Record<BotSkill, number> = { novice: 0.25, regular: 0.5, pro: 0.75, shark: 0.95 };

/** One stable roll per key: asking again about the same thing always gets the same answer. */
function roll(v: PlayerView, key: string): number {
  return createRng(`renege:${v.seat}:${v.handNo}:${v.dealer}:${v.scores.join(',')}:${key}`).float();
}

/**
 * The trump this bot will cut with while still holding the led suit — or null to play it straight.
 * The spot: following a non-trump lead, holding that suit, nothing honest wins the book, the partner
 * is not already winning it, the side still needs books, and the bot has not cut a suit this hand yet.
 */
export function chooseRenege(v: PlayerView, level: BotLevel): Card | null {
  const r = v.rules;
  if (!renegeOn(r) || v.phase !== 'playing' || v.turn !== v.seat || !v.hand || !v.tricks.length) return null;
  const plays = v.trick.plays;
  if (!plays.length || plays[0]!.seat !== v.trick.leader || isTrump(plays[0]!.card, r)) return null;
  if (isNilBid(v.bids[v.seat])) return null;
  const led = effectiveSuit(plays[0]!.card, r);
  const follow = v.hand.filter((c) => effectiveSuit(c, r) === led);
  const trumps = v.hand.filter((c) => isTrump(c, r));
  if (!follow.length || !trumps.length) return null;
  // one cut per hand, at most: a bot that already trumped a side-suit lead leaves it there
  const cutBefore = v.tricks.some((t) => t.plays.length && !isTrump(t.plays[0]!.card, r) && t.plays.some((p) => p.seat === v.seat && isTrump(p.card, r)));
  if (cutBefore) return null;
  const k = know(v);
  if (!k.booksHand && k.need <= 0) return null;
  if (k.partner !== null && currentWinner(k) === k.partner) return null;
  if (follow.some((c) => winsNow(k, c))) return null;
  const winners = trumps.filter((c) => winsNow(k, c));
  if (!winners.length) return null;
  if (roll(v, 'slick') >= RENEGE_HAND_RATE[skillOf(level)]) return null;
  return lowest(k, winners);
}

/**
 * The renege call this bot makes now, or null. Reads only the public books: an opponent who threw
 * off the led suit in a finished book and has since played a card of that suit is caught on the
 * table — if this bot noticed.
 */
export function chooseRenegeCall(v: PlayerView, level: BotLevel): { target: Seat; trick: number } | null {
  const open = v.renege?.open;
  if (!open?.length) return null;
  const r = v.rules;
  const notice = RENEGE_NOTICE_RATE[skillOf(level)];
  for (const { trick, targets } of open) {
    const t = v.tricks[trick];
    if (!t?.plays.length) continue;
    const led = effectiveSuit(t.plays[0]!.card, r);
    for (const target of targets) {
      const p = t.plays.find((x) => x.seat === target);
      if (!p || effectiveSuit(p.card, r) === led) continue;
      const later = [...v.tricks.slice(trick + 1).flatMap((x) => x.plays), ...v.trick.plays];
      if (!later.some((x) => x.seat === target && effectiveSuit(x.card, r) === led)) continue;
      if (roll(v, `call:${trick}:${target}`) < notice) return { target, trick };
    }
  }
  return null;
}
