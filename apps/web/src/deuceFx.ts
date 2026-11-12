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
 *   Big over Little. The steal is a duelist's strike at the landing
 *   (escalated 2026-11-01 — "like the nuke stands out, this needs to
 *   stand out", still inside the same play beat, no added time): a
 *   blade streak sweeps the beaten trump in the winner's colour, the
 *   beaten card is cut in two and its halves shear apart as it knocks
 *   and dims, a coloured shockwave + shard burst + light burst go off
 *   at the clash point, the winning card rears up and catches the light
 *   over the pile, and the layered strike sound (shing → whoosh →
 *   sword hit, the thump under it) lands with the cards.
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
 *
 * - DUEL (owner, 2026-11-04): one pairing inside the Cut is singled out —
 *   the 2♦ taking the trick from the standing 2♠ gets its OWN moment,
 *   replacing The Cut for that pairing alone. The diamond strikes crystal,
 *   not steel: a recorded glass-bell strike with a glass-crack edge (the
 *   `deuceDuel` sample, never the sword), a white-hot shard burst in the
 *   layer instead of the blade sweep, and the beaten 2♠ is knocked and
 *   dimmed but NOT cut in two — the split is The Cut's wound, not this
 *   one's. Every other marquee steal keeps The Cut byte-for-byte, and a
 *   duel never double-fires with it: exactly one strike sound, one wound
 *   language, per landing.
 */
export interface DeuceFxInfo {
  /** A trump deuce: the landing drops with weight. */
  drop: boolean;
  /** A marquee steal: the trump this play beats (the standing winner it crosses). */
  cut: { victim: Card; victimSeat: number } | null;
  /**
   * The Deuce Duel: the one Cut pairing with its own moment — this play is
   * the 2♦ and the trump it crosses is the standing 2♠. Only ever true
   * alongside a `cut` (it refines it); replaces The Cut's sound + visuals.
   */
  duel: boolean;
  /**
   * The generic over-cut treatment (landCue's level ≥ 2) also claimed this
   * play before the Cut replaced it. Scene reads this to keep the play's
   * tuned over-cut flight now that the cue segment is stripped — flight
   * shapes do not change. Jokers never had that flight, so never true
   * for them (mirrors landCueFor's own condition).
   */
  wasOvercut: boolean;
}

const NO_FX: DeuceFxInfo = { drop: false, cut: null, wasOvercut: false, duel: false };

/** A deuce the engine counts as trump (its power sits in the trump order). */
export const isTrumpDeuce = (card: Card, r: GameState['rules']): boolean => rankOf(card) === '2' && isTrump(card, r);

/**
 * The Cut's colour key, by the WINNING trump (the stealer — never the
 * victim): a diamond cuts red, a spade cuts steel, and the Jokers each
 * take their own heraldry — gold for the Big, violet for the Little.
 * `core` is the near-white heart of the blade streak; `glow` is the
 * saturated colour the trail, ring, shards, light burst and the hero
 * card's caught light all wear. Non-marquee cards key nothing.
 */
export function cutColorFor(card: Card): { core: string; glow: string } | null {
  switch (card) {
    case 'BJ': return { core: '#fff3c4', glow: '#ffb52e' };
    case 'LJ': return { core: '#f2e6ff', glow: '#a678ff' };
    case '2D': return { core: '#ffe9e4', glow: '#ff4438' };
    case '2S': return { core: '#ffffff', glow: '#9fc2ff' };
    default: return null;
  }
}

/**
 * The Duel's colours: diamond, not heraldry — a white-hot core over ice.
 * Deliberately NOT the 2♦'s Cut red (`cutColorFor('2D')`): the layer's
 * burst, ring, flash and light all wear this when the duel fires, so the
 * pairing reads as crystal striking, never as another blade.
 */
export const DUEL_COLORS = { core: '#ffffff', glow: '#cfeaff' } as const;

/** Cards that can make a Cut: Jokers and trump deuces. */
const isMarquee = (card: Card, r: GameState['rules']): boolean => isJoker(card) || isTrumpDeuce(card, r);

/** Classify one played card from the game state it was played into. */
export function classifyDeuceFx(st: GameState, card: Card): DeuceFxInfo {
  const r = st.rules;
  const drop = isTrumpDeuce(card, r);
  if (!isMarquee(card, r)) return drop ? { drop, cut: null, wasOvercut: false, duel: false } : NO_FX;
  const t = [...st.tricks, st.trick].find((x) => x.plays.some((pl) => pl.card === card));
  if (!t) return { drop, cut: null, wasOvercut: false, duel: false };
  const i = t.plays.findIndex((pl) => pl.card === card);
  if (i <= 0) return { drop, cut: null, wasOvercut: false, duel: false }; // led the trick: nothing standing to steal from
  const before = t.plays.slice(0, i);
  const winnerSeat = trickWinner(before, r);
  const beaten = before.find((pl) => pl.seat === winnerSeat);
  if (!beaten || !isTrump(beaten.card, r)) return { drop, cut: null, wasOvercut: false, duel: false }; // standing winner is not trump: an ordinary take, not a Cut
  if (cardPower(card, r) <= cardPower(beaten.card, r)) return { drop, cut: null, wasOvercut: false, duel: false }; // did not cross it: Drop only
  const me = t.plays[i]!;
  if (sideOf(me.seat, r) === sideOf(winnerSeat, r)) return { drop, cut: null, wasOvercut: false, duel: false }; // partner's trump: the side already held the trick
  return { drop, cut: { victim: beaten.card, victimSeat: winnerSeat }, wasOvercut: !isJoker(card) && cutLevel(t.plays, i, r) >= 2, duel: card === '2D' && beaten.card === '2S' };
}

/**
 * The landing cue for a played card: landCueFor's string, with the deuce
 * treatment composed in. A Cut strips any generic over-cut segment (the
 * clash replaces the popup/slam/hold — see the header), then the recorded
 * thump and the metallic cut layer in, in that order, so fireCue plays
 * card-smack → thump → metal on the landing beat. The thump sits under
 * EVERY Cut (it is the strike's low end — a Joker steal lands on it too,
 * not just a deuce steal) as well as under every trump-deuce Drop.
 * The Duel swaps the metal for the diamond strike (`deuceDuel`) — the
 * thump stays (it is the deuce's own weight), the sword never sounds.
 * Non-marquee plays return landCueFor's string byte-for-byte.
 */
export function deuceLandCue(st: GameState, card: Card): string {
  const info = classifyDeuceFx(st, card);
  if (!info.drop && !info.cut) return landCueFor(st, card);
  let cue = landCueFor(st, card);
  // The lightning survives a marquee steal (owner, 2026-11-12: his partner's
  // 2♠ was the THIRD spade to cut a trick "but the lightning didn't happen").
  // The bolt belongs to the third cut of a trick, whoever throws it: when a
  // trump deuce makes that cut, the level-3 over-cut segment (callout,
  // lightning, thunder) is carried over and rides after the clash's own
  // cues. A plain level-2 over-cut still yields to the clash, and Jokers
  // keep their own effects — they never carry an over-cut segment.
  let bolt = '';
  if (info.cut && !isJoker(card)) bolt = cue.match(/,overcut3\|[^,]*$/)?.[0] ?? '';
  if (info.cut) {
    // The generic cut vocabulary goes quiet for a marquee steal: the
    // over-cut segment (popup + slam + hold) and the plain ',cut' hit
    // (a Joker crossing a cut-in trump still carries one in its base)
    // both yield to the clash. Joker rumbles and 'broken' stay.
    cue = cue.replace(/,overcut.*$/, '').replace(/,cut(?=,|$)/, '');
  }
  if (info.drop || info.cut) cue += ',deuceThump';
  if (info.duel) cue += ',deuceDuel';
  else if (info.cut) cue += ',trumpCut';
  return cue + bolt;
}
