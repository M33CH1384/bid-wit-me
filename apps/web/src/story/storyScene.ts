/**
 * Story scene glue: turns the live GameState into the story session's
 * honest memory — milestone detection (deterministic from state, each
 * milestone once per game), in-match event records (only things that
 * really happened — they gate endgame callbacks), live-play triggers
 * (deal, a big bid, a joker, a spade cut), and the finished game's fact
 * sheet the server uses for feats / match-event eggs. Pure functions —
 * Table.tsx feeds snapshots in; nothing here touches React or the DOM,
 * and nothing here runs for non-story games.
 */
import type { GameState } from '@spades/rules';
import type { StoryGameFacts, StoryMilestone } from '@spades/bots';

export interface StorySnap {
  phase: GameState['phase'];
  handNo: number;
  historyLen: number;
  scores: readonly number[];
  target: number;
  /** bids by seat for the hand in flight (null until bid) */
  bids: readonly (string | number | null)[];
  tricksDone: number;
  /** per-trick facts for the current hand's last completed trick */
  lastTrick: { winner: number | null; jokerPlayed: boolean; cutWon: boolean } | null;
  lastHand: {
    myPoints: number; theirPoints: number;
    nilBidSides: boolean[]; // a nil/blindNil was bid by this side this hand
    nilMade: boolean; nilBusted: boolean; // from the hand's actual nil results
    mySet: boolean; theirSet: boolean;
  } | null;
}

const isNilBid = (b: unknown) => b === 'nil' || b === 'blindNil';

export function storySnap(st: GameState): StorySnap {
  const last = st.history[st.history.length - 1];
  const trick = st.tricks[st.tricks.length - 1];
  let lastTrick: StorySnap['lastTrick'] = null;
  if (trick && trick.winner !== null && trick.plays.length) {
    const ledSuit = trick.plays[0]!.card.slice(-1);
    const winPlay = trick.plays.find((p) => p.seat === trick.winner);
    const winCard = winPlay?.card ?? '';
    lastTrick = {
      winner: trick.winner,
      jokerPlayed: trick.plays.some((p) => p.card === 'BJ' || p.card === 'LJ'),
      cutWon: winCard.endsWith('S') && ledSuit !== 'S' && trick.plays[0]!.card !== 'BJ' && trick.plays[0]!.card !== 'LJ',
    };
  }
  return {
    phase: st.phase,
    handNo: st.handNo,
    historyLen: st.history.length,
    scores: [...st.scores],
    target: st.rules.targetScore,
    bids: st.bids.map((b) => (b === null ? null : b)),
    tricksDone: st.tricks.length,
    lastTrick,
    lastHand: last ? {
      myPoints: last.sides[0]?.points ?? 0,
      theirPoints: last.sides[1]?.points ?? 0,
      nilBidSides: [0, 1].map((side) => last.bids.some((b, seat) => seat % 2 === side && isNilBid(b))),
      nilMade: last.sides.some((s) => s.nils.some((n) => n.made)),
      nilBusted: last.sides.some((s) => s.nils.some((n) => !n.made)),
      mySet: last.sides[0]?.contractMade === false,
      theirSet: last.sides[1]?.contractMade === false,
    } : null,
  };
}

const MATCH_POINT_WITHIN = 100;
const PULL_AWAY_GAP = 150;

/** Milestones crossed between two snapshots, in firing order. Deterministic from state. */
export function storyMilestones(prev: StorySnap, next: StorySnap): { milestone: StoryMilestone; ahead: 'us' | 'them' | null }[] {
  const out: { milestone: StoryMilestone; ahead: 'us' | 'them' | null }[] = [];
  if (next.historyLen <= prev.historyLen) return out;
  const lh = next.lastHand!;
  if (next.historyLen === 1) out.push({ milestone: 'firstHand', ahead: null });
  if (lh.nilBidSides.some(Boolean)) out.push({ milestone: 'nilAttempt', ahead: null });
  const gap = Math.abs(next.scores[0]! - next.scores[1]!);
  const prevGap = Math.abs(prev.scores[0]! - prev.scores[1]!);
  if (gap >= PULL_AWAY_GAP && prevGap < PULL_AWAY_GAP) out.push({ milestone: 'pullAway', ahead: next.scores[0]! > next.scores[1]! ? 'us' : 'them' });
  const mp = (s: readonly number[]) => s.some((x) => x >= next.target - MATCH_POINT_WITHIN);
  if (mp(next.scores) && !mp(prev.scores)) out.push({ milestone: 'matchPoint', ahead: null });
  if (mp(next.scores) && next.phase !== 'gameOver') out.push({ milestone: 'finalHand', ahead: null });
  return out;
}

/** In-match events that really happened when moving prev → next (recorded in session memory). */
export type StoryEventId = 'nilBusted' | 'bigSwing' | 'nilMade' | 'jokerDropped' | 'cutMade' | 'bigBid';
export function storyEvents(prev: StorySnap, next: StorySnap): StoryEventId[] {
  const out: StoryEventId[] = [];
  // bids appearing during bidding
  const newBids = next.bids.filter((b, i) => b !== null && prev.bids[i] === null);
  if (newBids.some((b) => typeof b === 'number' && b >= 6)) out.push('bigBid');
  if (next.tricksDone > prev.tricksDone && next.lastTrick) {
    if (next.lastTrick.jokerPlayed) out.push('jokerDropped');
    if (next.lastTrick.cutWon) out.push('cutMade');
  }
  if (next.historyLen > prev.historyLen && next.lastHand) {
    const lh = next.lastHand;
    if (lh.nilBusted) out.push('nilBusted');
    if (lh.nilMade) out.push('nilMade');
    if (Math.abs(lh.myPoints - lh.theirPoints) >= 100) out.push('bigSwing');
  }
  return out;
}

/** The finished game's honest fact sheet (from its own hand history). */
export function storyFactsOf(st: GameState): StoryGameFacts {
  const my = (rec: GameState['history'][number]) => rec.sides[0];
  const their = (rec: GameState['history'][number]) => rec.sides[1];
  let ourNilsMade = 0; let ourBlindNilsMade = 0; let deeNilsMade = 0;
  let deeSteady = st.history.length > 0;
  for (const rec of st.history) {
    let deeNilMadeHere = false;
    for (const n of my(rec)?.nils ?? []) {
      if (n.made) { ourNilsMade++; if (n.kind === 'blindNil') ourBlindNilsMade++; if (n.seat === 2) { deeNilsMade++; deeNilMadeHere = true; } }
    }
    // Steady = her side brought the contract home AND Dee delivered her part:
    // a trick taken — or a nil made (a made nil takes zero tricks by design).
    const deeTook = (rec.tricksWon[2] ?? 0) >= 1;
    if ((!deeTook && !deeNilMadeHere) || my(rec)?.contractMade === false) deeSteady = false;
  }
  const first = st.history[0];
  return {
    margin: (st.scores[0] ?? 0) - (st.scores[1] ?? 0),
    handsPlayed: st.history.length,
    setsAgainstUs: st.history.filter((r) => my(r)?.contractMade === false).length,
    setsAgainstThem: st.history.filter((r) => their(r)?.contractMade === false).length,
    ourNilsMade, ourBlindNilsMade, deeNilsMade, deeSteady,
    setOnFirstHand: !!first && (my(first)?.contractMade === false || their(first)?.contractMade === false),
    oppSetTwice: st.history.filter((r) => their(r)?.contractMade === false).length >= 2,
  };
}
