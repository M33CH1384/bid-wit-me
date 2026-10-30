import { type Card, type GameState, cardPower, isJoker, isTrump, rankOf, sideOf, trickWinner } from '@spades/rules';
import { cutLevel, landCueFor } from './landCue';

/**
 * The Deuce Drop + The Cut (owner, 2026-10-30: "some umph when deuces get
 * played but different than jokers.. also an animation for when deuce of
 * diamonds beats deuce of spades, or jokers beating deuces").
 *
 * Two presentation effects, both derived from the same trick state the view
 * already holds — never from card identity alone — so every client (human,
 * bot, online-remote, story) renders them identically from shared state,
 * deterministically like the toss variants:
 *
 * - DROP: a TRUMP deuce lands (2♠ / 2♦ in Joker decks; 2♠ in standard decks,
 *   where it is the lowest trump). It hits with weight: a deep recorded
 *   thump, a felt shockwave ring, a tight table shake, a heavy settle.
 *   Plain off-suit deuces get nothing — they are the weakest cards in the
 *   deck and weight there would be a lie.
 * - CUT: a marquee trump (a Joker, or a trump deuce) lands BEATING the
 *   trump that is currently winning the trick, and takes the lead for its
 *   own side — 2♦ over 2♠, a Joker over a deuce, Little over a deuce,
 *   Big over Little. The steal clashes at the landing: a metallic cut
 *   sound over the thump, a spark/slash burst, and the beaten trump is
 *   knocked (shoved, tilted, dimmed, a crack of light across it).
 *   A deuce that does NOT beat the standing trump gets only the Drop;
 *   beating your own partner's trump never Cuts (your side already holds
 *   the trick — it still Drops if it is a deuce). In a standard 52 deck
 *   the only marquee card is 2♠, the lowest trump, so the Cut cannot
 *   fire there — by design, not by omission.
 *
 * The Cut replaces the generic over-cut treatment (landCue's popup +
 * overcut slam + hand-end hold) for these marquee clashes: those plays
 * were already the loudest steals in the game, and the clash IS their
 * moment now — different from what we already have, per the directive.
 * Everything else about the cue string is landCueFor's, untouched.
 */
export interface DeuceFxInfo {
  /** A trump deuce: the landing drops with weight. */
  drop: boolean;
  /** A marquee steal: the trump this play beats (the standing winner it crosses). */
  cut: { victim: Card; victimSeat: number } | null;
  /**
   * The generic over-cut treatment (landCue's level ≥ 2) also claimed this
   * play before the Cut replaced it. Scene reads this to keep the play's
   * tuned over-cut flight now that the cue segment is stripped — flight
   * shapes do not change. Jokers never had that flight, so never true
   * for them (mirrors landCueFor's own condition).
   */
  wasOvercut: boolean;
}

const NO_FX: DeuceFxInfo = { drop: false, cut: null, wasOvercut: false };

/** A deuce the engine counts as trump (its power sits in the trump order). */
export const isTrumpDeuce = (card: Card, r: GameState['rules']): boolean => rankOf(card) === '2' && isTrump(card, r);

/** Cards that can make a Cut: Jokers and trump deuces. */
const isMarquee = (card: Card, r: GameState['rules']): boolean => isJoker(card) || isTrumpDeuce(card, r);

/** Classify one played card from the game state it was played into. */
export function classifyDeuceFx(st: GameState, card: Card): DeuceFxInfo {
  const r = st.rules;
  const drop = isTrumpDeuce(card, r);
  if (!isMarquee(card, r)) return drop ? { drop, cut: null, wasOvercut: false } : NO_FX;
  const t = [...st.tricks, st.trick].find((x) => x.plays.some((pl) => pl.card === card));
  if (!t) return { drop, cut: null, wasOvercut: false };
  const i = t.plays.findIndex((pl) => pl.card === card);
  if (i <= 0) return { drop, cut: null, wasOvercut: false }; // led the trick: nothing standing to steal from
  const before = t.plays.slice(0, i);
  const winnerSeat = trickWinner(before, r);
  const beaten = before.find((pl) => pl.seat === winnerSeat);
  if (!beaten || !isTrump(beaten.card, r)) return { drop, cut: null, wasOvercut: false }; // standing winner is not trump: an ordinary take, not a Cut
  if (cardPower(card, r) <= cardPower(beaten.card, r)) return { drop, cut: null, wasOvercut: false }; // did not cross it: Drop only
  const me = t.plays[i]!;
  if (sideOf(me.seat, r) === sideOf(winnerSeat, r)) return { drop, cut: null, wasOvercut: false }; // partner's trump: the side already held the trick
  return { drop, cut: { victim: beaten.card, victimSeat: winnerSeat }, wasOvercut: !isJoker(card) && cutLevel(t.plays, i, r) >= 2 };
}

/**
 * The landing cue for a played card: landCueFor's string, with the deuce
 * treatment composed in. A Cut strips any generic over-cut segment (the
 * clash replaces the popup/slam/hold — see the header), then the recorded
 * thump (trump deuces) and the metallic cut layer in, in that order, so
 * fireCue plays card-smack → thump → metal on the landing beat.
 * Non-marquee plays return landCueFor's string byte-for-byte.
 */
export function deuceLandCue(st: GameState, card: Card): string {
  const info = classifyDeuceFx(st, card);
  if (!info.drop && !info.cut) return landCueFor(st, card);
  let cue = landCueFor(st, card);
  if (info.cut) {
    // The generic cut vocabulary goes quiet for a marquee steal: the
    // over-cut segment (popup + slam + hold) and the plain ',cut' hit
    // (a Joker crossing a cut-in trump still carries one in its base)
    // both yield to the clash. Joker rumbles and 'broken' stay.
    cue = cue.replace(/,overcut.*$/, '').replace(/,cut(?=,|$)/, '');
  }
  if (info.drop) cue += ',deuceThump';
  if (info.cut) cue += ',trumpCut';
  return cue;
}
