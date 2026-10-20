import type { Card } from './cards';
import type { TableRules } from './config';
import type { Action, GameState, Seat } from './game';
import { runClearedHands, runPlayout } from './game';
import type { Bid } from './scoring';

/**
 * Hand-history logging (Demetrius 2026-10-19): a ground-truth record of every hand, built for
 * testing. When something on screen looks wrong — a 'Run it!' claim whose announced cards do
 * not match the recap, a trick credited to the wrong seat — this log is what actually happened,
 * captured at the engine boundary instead of reconstructed from what a client happened to show.
 *
 * The engine is deterministic from seed + actions, so a deal plus the ordered action list IS
 * the ground truth; the log records both, plus the derived facts a debugger reaches for first
 * (completed tricks with winners, hand-end scores, and for a run claim the claimer's real
 * remaining cards next to the cards the play-out actually played).
 *
 * Built by feeding every successful `applyAction` transition through {@link HandLogBuilder.record}.
 * Plain JSON throughout, so it can live in room storage (online) or localStorage (offline).
 */

export interface LoggedAction {
  /** monotone action counter within the game (the room's `seq` online; a local counter offline) */
  seq: number;
  action: Action;
}

/** One card the play-out played, in play order. */
export interface RunItPlayedCard { seat: Seat; card: Card }

/**
 * A resolved 'Run it!' claim, ground truth side by side:
 * `claimerHand` — the cards actually in the claimer's hand when the claim landed;
 * `played` — the cards the play-out actually played (every seat, in order);
 * `cleared` — exactly what `runClearedHands` hands the recap UI for each seat
 * (the claimer's row is directly comparable to `claimerHand`: if they differ, the recap lied;
 * if they match but an announcement named other cards, the announcement lied).
 */
export interface HandLogRunIt {
  seq: number;
  claimer: Seat;
  claimerHand: Card[];
  onTable: { seat: Seat; card: Card }[];
  played: RunItPlayedCard[];
  cleared: ({ card: Card; played?: true }[] | null)[];
}

export interface HandLogTrick {
  leader: Seat;
  winner: Seat | null;
  plays: { seat: Seat; card: Card; auto?: true; run?: true }[];
}

export interface HandLogHand {
  handNo: number;
  dealer: Seat;
  /** the deal at hand start (a misdeal replaces it — see `misdealRedeals`) */
  deal: Card[][];
  /** each misdeal redeal, in order: who called it and the fresh deal that replaced `deal` */
  misdealRedeals: { by: Seat; deal: Card[][] }[];
  actions: LoggedAction[];
  /** completed tricks in order (filled as they land; complete when `complete` is true) */
  tricks: HandLogTrick[];
  /** final bids (filled when the hand completes) */
  bids: (Bid | null)[];
  tricksWon: number[];
  /** cumulative game scores / bags after this hand (filled when the hand completes) */
  scores: number[];
  bags: number[];
  runIts: HandLogRunIt[];
  complete: boolean;
}

export interface GameHandLog {
  v: 1;
  /** the game seed — with `rules`, replays every hand exactly */
  seed: string;
  rules: TableRules;
  /** ms epoch when the log opened (the caller's clock) */
  startedAt: number;
  /** the table this game was played at, when known ('offline' for local games) */
  room?: string;
  hands: HandLogHand[];
}

const cloneHands = (hands: Card[][]): Card[][] => hands.map((h) => [...h]);

/** A fresh hand entry from the state right after a deal. */
function handEntry(st: GameState): HandLogHand {
  return {
    handNo: st.handNo,
    dealer: st.dealer,
    deal: cloneHands(st.hands),
    misdealRedeals: [],
    actions: [],
    tricks: [],
    bids: [...st.bids],
    tricksWon: [...st.tricksWon],
    scores: [...st.scores],
    bags: [...st.bags],
    runIts: [],
    complete: false,
  };
}

export class HandLogBuilder {
  constructor(readonly log: GameHandLog) {}

  /** Open a log for a game that just started; `st` is the fresh `newGame` state (hand 1 dealt). */
  static start(st: GameState, startedAt: number, room?: string): HandLogBuilder {
    const b = new HandLogBuilder({ v: 1, seed: st.seed, rules: st.rules, startedAt, ...(room ? { room } : {}), hands: [] });
    b.log.hands.push(handEntry(st));
    return b;
  }

  /** Resume wrapping a persisted log (room hibernation, saved offline log). */
  static wrap(log: GameHandLog): HandLogBuilder {
    return new HandLogBuilder(log);
  }

  private current(): HandLogHand | undefined {
    return this.log.hands[this.log.hands.length - 1];
  }

  /**
   * Feed one successful `applyAction` transition. Call AFTER the state advanced
   * (`after !== before`); a rejected or idempotent no-op action should not be recorded.
   * `seq` is the caller's monotone action counter.
   */
  record(before: GameState, after: GameState, action: Action, seq: number): void {
    if (action.type === 'nextHand') {
      // a fresh deal: open the next hand's entry from the dealt state
      this.log.hands.push(handEntry(after));
      return;
    }
    let hand = this.current();
    if (!hand || hand.handNo !== before.handNo) {
      // the game was resumed onto a hand the log never saw dealt: open it from the pre-action state
      hand = handEntry(before);
      this.log.hands.push(hand);
    }
    hand.actions.push({ seq, action });

    if (action.type === 'misdeal') {
      // the redeal replaced every hand with the same hand number
      hand.misdealRedeals.push({ by: action.seat, deal: cloneHands(after.hands) });
    }

    if (action.type === 'runIt') {
      const playout = runPlayout(before, after, action.seat);
      hand.runIts.push({
        seq,
        claimer: action.seat,
        claimerHand: [...before.hands[action.seat]!],
        onTable: before.trick.plays.map((p) => ({ seat: p.seat, card: p.card })),
        played: playout ? playout.tricks.flatMap((t) => t.plays.filter((p) => !p.played).map((p) => ({ seat: p.seat, card: p.card }))) : [],
        cleared: (runClearedHands(after) ?? []).map((row) => (row.length ? row : null)),
      });
    }

    // tricks completed by this step (a run play-out can finish several at once)
    for (let i = hand.tricks.length; i < after.tricks.length; i++) {
      const t = after.tricks[i]!;
      hand.tricks.push({
        leader: t.leader,
        winner: t.winner,
        plays: t.plays.map((p) => ({ seat: p.seat, card: p.card, ...(p.auto ? { auto: true as const } : {}), ...(p.run ? { run: true as const } : {}) })),
      });
    }

    if (after.history.length > before.history.length) {
      // the hand was scored by this step: freeze the outcome from the engine's own record
      const rec = after.history[after.history.length - 1]!;
      hand.bids = [...rec.bids];
      hand.tricksWon = [...rec.tricksWon];
      hand.scores = [...after.scores];
      hand.bags = [...after.bags];
      hand.complete = true;
    }
  }

  snapshot(): GameHandLog {
    return this.log;
  }
}
