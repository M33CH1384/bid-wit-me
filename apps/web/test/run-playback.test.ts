import { describe, expect, it } from 'vitest';
import { type Card, type GameState, applyAction, makeRules, newGame, runPlayout, spectatorView, viewFor } from '@spades/rules';
import type { RunPlayback } from '@spades/protocol';
import { rotateView } from '../src/online/rotate';
import { orientRun, pickRunShow, runBeats, scoreOpened, sequenceRun, showForJump } from '../src/runPlayback';
import { actingSeat } from '../src/turnState';

/** Late hand the server tests use: seat 2 (both jokers) can run it on seat 0's lead. */
function lateRun(): { before: GameState; after: GameState } {
  const base = newGame(makeRules('joker', { targetScore: 1000 }), 'run-playback');
  const hands = [['3H', '4H'], ['5C', '6C'], ['BJ', 'LJ'], ['3D', '7D']] as Card[][];
  const before: GameState = {
    ...base,
    phase: 'playing',
    hands,
    bids: [2, 2, 2, 2],
    revealed: [true, true, true, true],
    tricks: Array.from({ length: 11 }, () => ({ leader: 0, plays: [], winner: 1 })),
    tricksWon: [0, 0, 0, 0],
    turn: 0,
    trick: { leader: 0, plays: [], winner: null },
    spadesBroken: true,
  };
  return { before, after: applyAction(before, { type: 'runIt', seat: 2 }) };
}

function playbackOf(before: GameState, after: GameState): RunPlayback {
  const run = runPlayout(before, after, 2);
  expect(run).not.toBeNull();
  return { ...run!, seq: 9 };
}

describe('Run it! sequencing for someone who did not claim', () => {
  it('a non-actor sees the claimer in their own seat frame, every remaining trick, then the score', () => {
    const { before, after } = lateRun();
    const wire = playbackOf(before, after);
    const me = 1;
    const local = orientRun(wire, me, 4);
    expect(local.claimer).toBe((2 - me + 4) % 4);
    const seq = sequenceRun(local);
    expect(seq.cards).toEqual(expect.arrayContaining(['BJ', 'LJ']));
    expect(seq.books).toBeGreaterThanOrEqual(2);
    expect(seq.tricks).toHaveLength(seq.books);
    expect(seq.tricks.every((t) => t.winner === local.claimer)).toBe(true);

    const b = rotateView(viewFor(before, me)).st;
    const a = rotateView(viewFor(after, me)).st;
    const jump = showForJump(b, a);
    expect(jump!.claimer).toBe(local.claimer);
    expect(jump!.cards).toEqual(seq.cards);

    const show = pickRunShow(b, a, local, null);
    expect(show).toMatchObject({ fromServer: true, id: wire.seq, claimer: local.claimer });
    // the same playback does not start the show again
    expect(pickRunShow(a, a, local, wire.seq)).toBeNull();

    const beats = runBeats(local);
    expect(beats.at(-1)).toEqual({ t: 'score' });
    expect(beats.findIndex((x) => x.t === 'score')).toBe(beats.length - 1);
    const tricks = beats.filter((x) => x.t === 'trick');
    expect(tricks).toHaveLength(local.tricks.length);
    const revealed = new Set(beats.flatMap((x) => (x.t === 'reveal' ? [x.card] : [])));
    for (const t of local.tricks) for (const p of t.plays) if (!p.played) expect(revealed.has(p.card)).toBe(true);
    // a show covers the table: nobody is the acting seat
    expect(actingSeat({ turn: 0, phase: 'handOver', pause: false, dealing: false, locked: false, covered: true })).toBeNull();
    expect(scoreOpened('handOver', false, true)).toBe(false);
    expect(scoreOpened(after.phase, false, false)).toBe(true);
  });

  it('a spectator, anchored at seat 0, gets the same tricks in real seats before the score', () => {
    const { before, after } = lateRun();
    const wire = playbackOf(before, after);
    const local = orientRun(wire, null, 4);
    expect(local).toBe(wire);
    expect(local.claimer).toBe(2);
    const b = rotateView(spectatorView(before, 0)).st;
    const a = rotateView(spectatorView(after, 0)).st;
    expect(showForJump(b, a)!.claimer).toBe(2);
    expect(sequenceRun(local).cards).toEqual(expect.arrayContaining(['BJ', 'LJ']));
    const beats = runBeats(local);
    expect(beats.at(-1)!.t).toBe('score');
    expect(beats.filter((x) => x.t === 'trick').length).toBe(local.books);
    expect(beats.some((x) => x.t === 'reveal')).toBe(true);
    expect(scoreOpened('handOver', false, true)).toBe(false);
  });

  it('an ordinary trick bundled in front of the run still starts the show', () => {
    const { before, after } = lateRun();
    const b = rotateView(viewFor(before, 1)).st;
    const a = rotateView(viewFor(after, 1)).st;
    const ordinary = {
      leader: 0,
      winner: 0,
      plays: [
        { seat: 0, card: '2C' as Card },
        { seat: 1, card: '3C' as Card },
        { seat: 2, card: '4C' as Card },
        { seat: 3, card: '5C' as Card },
      ],
    };
    const bundled = { ...a, tricks: [...b.tricks, ordinary, ...a.tricks.slice(b.tricks.length)] };
    expect(bundled.tricks[b.tricks.length]!.plays.some((p) => p.run)).toBe(false);
    const jump = showForJump(b, bundled);
    expect(jump).not.toBeNull();
    expect(jump!.cards.length).toBeGreaterThan(0);
    expect(jump!.tricks.every((t) => t.plays.some((p) => p.card === 'BJ' || p.card === 'LJ' || !p.played))).toBe(true);
    expect(pickRunShow(b, bundled, null, null)!.fromServer).toBe(false);
    expect(scoreOpened('playing', false, false)).toBe(false);
    expect(scoreOpened('handOver', true, false)).toBe(false);
  });
});

describe('☢☢ mega run: the claimer ran it with BOTH Jokers', () => {
  it('the late-run fixture is a mega: the flag rides the playback to every viewer', () => {
    const { before, after } = lateRun(); // seat 2's hand at the claim is exactly BJ + LJ
    const wire = playbackOf(before, after);
    expect(wire.mega).toBe(true);
    const local = orientRun(wire, 1, 4);
    expect(local.mega).toBe(true);
    expect(sequenceRun(local).mega).toBe(true);
    const b = rotateView(viewFor(before, 1)).st;
    const a = rotateView(viewFor(after, 1)).st;
    expect(pickRunShow(b, a, local, null)!.mega).toBe(true);
    // the no-playback jump path derives the same fact from the claimer's run cards
    expect(showForJump(b, a)!.mega).toBe(true);
  });

  it('an ordinary run (top spades, no Jokers in hand) is not mega on either path', () => {
    const base = newGame(makeRules('joker', { targetScore: 1000 }), 'run-playback-plain');
    const hands = [['3H', '4H'], ['5C', '6C'], ['AS', 'KS'], ['3D', '7D']] as Card[][];
    const before: GameState = {
      ...base, phase: 'playing', hands, bids: [2, 2, 2, 2], revealed: [true, true, true, true],
      tricks: Array.from({ length: 11 }, () => ({ leader: 0, plays: [], winner: 1 })),
      tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, plays: [], winner: null }, spadesBroken: true,
    };
    const after = applyAction(before, { type: 'runIt', seat: 2 });
    const run = runPlayout(before, after, 2);
    expect(run).not.toBeNull();
    expect(run!.mega).toBeUndefined();
    const wire: RunPlayback = { ...run!, seq: 4 };
    expect(sequenceRun(orientRun(wire, 1, 4)).mega).toBe(false);
    const b = rotateView(viewFor(before, 1)).st;
    const a = rotateView(viewFor(after, 1)).st;
    expect(showForJump(b, a)!.mega).toBe(false);
    expect(pickRunShow(b, a, orientRun(wire, 1, 4), null)!.mega).toBe(false);
  });
});
