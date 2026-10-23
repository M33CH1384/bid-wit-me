/**
 * 'Run it!' as every client sees it. The server attaches one public play-out (real seats) to the
 * state that resolves the claim. This turns that into the same zoom the runner gets, in local seats.
 * A state jump with no playback (offline, or a bot claim bundled with the play that enabled it)
 * still finds the run even when an ordinary trick arrives first.
 */
import { type Card, type GameState, hasBothJokers } from '@spades/rules';
import type { RunPlayback } from '@spades/protocol';

export interface RunSequence {
  claimer: number;
  /** the claimer's cards that were still in hand — the zoom / slam */
  cards: Card[];
  others: { seat: number; card: Card }[];
  books: number;
  tricks: RunPlayback['tricks'];
  /** ☢☢ the claimer ran it with BOTH Jokers in hand: the mega celebration, a tier above the nuke */
  mega: boolean;
}

/** Real seat → local seat. A spectator (me null) is anchored at seat 0, so the rotation is identity. */
export function orientRun(run: RunPlayback, me: number | null, n: number): RunPlayback {
  if (me === null || me === 0) return run;
  const L = (s: number) => (s - me + n * 4) % n;
  return {
    ...run,
    claimer: L(run.claimer),
    tricks: run.tricks.map((t) => ({
      winner: L(t.winner),
      plays: t.plays.map((p) => ({ ...p, seat: L(p.seat) })),
    })),
  };
}

/** Claimer's remaining cards, then everyone else's, then each remaining trick. */
export function sequenceRun(run: RunPlayback): RunSequence {
  const fresh = run.tricks.flatMap((t) => t.plays.filter((p) => !p.played));
  return {
    claimer: run.claimer,
    cards: fresh.filter((p) => p.seat === run.claimer).map((p) => p.card),
    others: fresh.filter((p) => p.seat !== run.claimer).map((p) => ({ seat: p.seat, card: p.card })),
    books: run.books,
    tricks: run.tricks,
    mega: run.mega === true,
  };
}

/**
 * A jump that contains a run, even when the first new trick is an ordinary one
 * (a bot claim resolved in the same broadcast as the play that made it legal).
 */
export function showForJump(before: GameState, after: GameState): RunSequence | null {
  if (before.handNo !== after.handNo || after.tricks.length <= before.tricks.length) return null;
  const runTricks = after.tricks.slice(before.tricks.length).filter((t) => t.plays.some((p) => p.run));
  if (!runTricks.length) return null;
  const claimer = runTricks.at(-1)!.winner;
  if (claimer === null) return null;
  const plays = runTricks.flatMap((t) => {
    const first = t.plays.findIndex((p) => p.run);
    return t.plays.slice(Math.max(0, first)).filter((p) => p.run);
  });
  const cards = plays.filter((p) => p.seat === claimer).map((p) => p.card);
  if (!cards.length) return null;
  return {
    claimer,
    // the claimer's run cards ARE their hand at the claim (runPlayout's mega fact), so the
    // same both-Jokers test derives the mega here — a Joker played before the claim is not in them
    mega: hasBothJokers(cards),
    cards,
    others: plays.filter((p) => p.seat !== claimer).map((p) => ({ seat: p.seat, card: p.card })),
    books: runTricks.length,
    tricks: runTricks.map((t) => {
      const first = t.plays.findIndex((p) => p.run);
      return {
        winner: t.winner!,
        plays: t.plays.map((p, k) => ({ seat: p.seat, card: p.card, ...(k < first ? { played: true as const } : {}) })),
      };
    }),
  };
}

export interface RunShow extends RunSequence {
  /** playback seq when this came from the server; 0 for a local jump (the table stamps Date.now()) */
  id: number;
  fromServer: boolean;
}

/** Server playback wins, so the same claim does not start the show twice. */
export function pickRunShow(before: GameState, after: GameState, playback: RunPlayback | null, playedSeq: number | null): RunShow | null {
  if (playback && playback.handNo === after.handNo && playback.seq !== playedSeq) {
    const seq = sequenceRun(playback);
    if (!seq.cards.length) return null;
    return { id: playback.seq, fromServer: true, ...seq };
  }
  const jump = showForJump(before, after);
  if (!jump) return null;
  return { id: 0, fromServer: false, ...jump };
}

export type RunBeat =
  | { t: 'reveal'; seat: number; card: Card }
  | { t: 'trick'; index: number; winner: number; plays: { seat: number; card: Card }[] }
  | { t: 'score' };

/** Reveal the remaining cards, play each remaining trick, then open the score. */
export function runBeats(run: RunPlayback): RunBeat[] {
  const seq = sequenceRun(run);
  return [
    ...seq.cards.map((card) => ({ t: 'reveal' as const, seat: seq.claimer, card })),
    ...seq.others.map((o) => ({ t: 'reveal' as const, seat: o.seat, card: o.card })),
    ...seq.tricks.map((tr, index) => ({
      t: 'trick' as const,
      index,
      winner: tr.winner,
      plays: tr.plays.map((p) => ({ seat: p.seat, card: p.card })),
    })),
    { t: 'score' },
  ];
}

/** The score screen stays shut while a trick is held or a Run it! show is up. */
export function scoreOpened(phase: string, pause: boolean, showingRun: boolean): boolean {
  return (phase === 'handOver' || phase === 'gameOver') && !pause && !showingRun;
}
