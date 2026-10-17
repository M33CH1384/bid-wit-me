import { describe, expect, it } from 'vitest';
import { makeRules, newGame, viewFor, type GameState } from '@spades/rules';
import { rotateView } from '../src/online/rotate';
import { dealTimeline, seatDealDelay, dealtSlotCount } from '../src/three/dealTimeline';
import { noteDiag, getDiagnostics, diagFailureCount, resetDiagnostics } from '../src/diagnostics';

describe('Cutthroat first load after an ejection', () => {
  it('rotation keeps eliminated/failStreak/trickCount, permuted into the local seat frame', () => {
    const rules = makeRules('cutthroat', { playerCount: 4 });
    const st = newGame(rules, 'rotate-eject');
    // seat 1 is out; three live seats are dealt 17 each by the next deal
    const withOut: GameState = { ...st, eliminated: [false, true, false, false], failStreak: [0, 2, 1, 0], trickCount: 17, hands: [[], [], [], []], handCounts: undefined as never };
    const view = viewFor({ ...withOut, hands: st.hands }, 2); // I sit at real seat 2
    expect(view.eliminated).toEqual([false, true, false, false]); // server view: real-seat order
    const { st: local, view: localView } = rotateView(view);
    // local frame: me (real 2) -> 0, real 3 -> 1, real 0 -> 2, real 1 (out) -> 3
    expect(local.eliminated).toEqual([false, false, false, true]);
    expect(localView.eliminated).toEqual([false, false, false, true]);
    expect(local.failStreak).toEqual([1, 0, 0, 2]);
    expect(local.trickCount).toBe(17);
  });

  it('deal schedule goes around live seats only: the last card leaves within the deal clock', () => {
    const tl = dealTimeline(1, 4, 51);
    const live = [0, 2, 3]; // seat 1 ejected, dealer 3
    // human (seat 0) 17th card (slot 16): old 4-seat math scheduled it at order 64, past the
    // 51-card deal span (order 50); live-seat math keeps every card inside the deal window.
    const lastOld = seatDealDelay(tl, 4, 16, 0, 3);
    const lastLive = seatDealDelay(tl, 4, 16, 0, 3, live);
    expect(lastLive).toBeLessThan(lastOld);
    expect(lastLive).toBeLessThanOrEqual(tl.shuffle + 50 * tl.step + 1e-9);
    expect(dealtSlotCount(tl.total, tl, 4, 0, 3, 17, live)).toBe(17);
    // no ejection: behaviour unchanged
    expect(seatDealDelay(tl, 4, 3, 2, 3)).toBe(seatDealDelay(tl, 4, 3, 2, 3, [0, 1, 2, 3]));
    expect(seatDealDelay(tl, 4, 3, 2, 3, live)).not.toBe(seatDealDelay(tl, 4, 3, 2, 3));
  });

  it('diagnostics buffer counts and dedupes load failures, readable for inspection', () => {
    resetDiagnostics();
    noteDiag('deck-art', '/assets/decks/egypt/QD.jpg');
    noteDiag('deck-art', '/assets/decks/egypt/QD.jpg');
    noteDiag('card-back', '/assets/card-backs/Egypt-back.png');
    expect(diagFailureCount()).toBe(3);
    expect(getDiagnostics()).toHaveLength(2);
    expect(getDiagnostics()[0]).toMatchObject({ kind: 'deck-art', count: 2 });
    expect((globalThis as unknown as { __bwmDiag?: () => { count: number } }).__bwmDiag?.().count).toBe(3);
    resetDiagnostics();
  });
});
