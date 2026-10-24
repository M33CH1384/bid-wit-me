/**
 * WORD TRAVELS FAST (owner, 2026-10-24) — the web derivations:
 * next stop comes from PROGRESS, never from the stop just played;
 * route facts (position, heat, previous-stop result) are read off the
 * recorded rows only — a row without a recorded last result yields no
 * manner band, and the scene layer stays silent.
 */
import { describe, expect, it } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import { routeFactsFor, trueNextStop, type StoryProgress, type StoryStopProgress } from '../src/story/storyApi';

const stop = (id: string) => STORY_STOPS.find((s) => s.id === id)!;

function progressWith(rows: Partial<Record<string, Partial<StoryStopProgress>>>, over: Partial<StoryProgress> = {}): StoryProgress {
  const stops = STORY_STOPS.map((s) => {
    const r = rows[s.id] ?? {};
    return {
      stopId: s.id, n: s.n, state: 'locked', attempts: 0, clears: 0, firstClearedAt: null, lastResult: null,
      ...r,
    } as StoryStopProgress;
  });
  const clearedCount = stops.filter((x) => x.clears > 0).length;
  return {
    track: 'solo', stops,
    currentStop: clearedCount >= STORY_STOPS.length ? null : clearedCount + 1,
    completed: false, completedAt: null, completionMark: null,
    finds: { eggs: [], feats: [] },
    ...over,
  };
}

/** The owner's exact state: stops 1–6 cleared, the Rooftop current.
 *  The Church Basement (the advancing win) was a rout: 300 of 500.
 *  The Porch's latest was a solid win: 160 of 250. */
const AT_ROOFTOP = progressWith({
  porch: { state: 'cleared', attempts: 3, clears: 2, lastResult: { won: true, margin: 160, endReason: 'target' } },
  barbershop: { state: 'cleared', attempts: 1, clears: 1, lastResult: { won: true, margin: 90, endReason: 'target' } },
  'rec-center': { state: 'cleared', attempts: 2, clears: 1, lastResult: { won: true, margin: 210, endReason: 'target' } },
  cookout: { state: 'cleared', attempts: 1, clears: 1, lastResult: { won: true, margin: 260, endReason: 'target' } },
  corner: { state: 'cleared', attempts: 4, clears: 1, lastResult: { won: true, margin: 120, endReason: 'target' } },
  'church-basement': { state: 'cleared', attempts: 2, clears: 1, lastResult: { won: true, margin: 300, endReason: 'target' } },
  rooftop: { state: 'current', attempts: 1, clears: 0 },
});

describe('trueNextStop — progress-derived, never played-derived', () => {
  it('a Porch replay routes to the Rooftop, never the Barbershop', () => {
    expect(trueNextStop(AT_ROOFTOP, 'porch')?.id).toBe('rooftop');
    expect(trueNextStop(AT_ROOFTOP, 'porch')?.name).toBe('The Rooftop');
  });

  it('replaying a mid stop (Rec Center) also points at 7, not 4', () => {
    expect(trueNextStop(AT_ROOFTOP, 'rec-center')?.id).toBe('rooftop');
  });

  it('a win AT the current stop points at the following stop', () => {
    const after = progressWith({
      porch: { state: 'cleared', attempts: 1, clears: 1 },
      barbershop: { state: 'current', attempts: 0, clears: 0 },
    });
    expect(trueNextStop(after, 'porch')?.id).toBe('barbershop'); // the first-clear truth: n+1 IS next there
  });

  it('a loss at the current stop offers no "next" — it is still his stop (run it back covers it)', () => {
    expect(trueNextStop(AT_ROOFTOP, 'rooftop')).toBeUndefined();
  });

  it('route complete → no next stop is fabricated', () => {
    const done = progressWith({}, { completed: true, currentStop: null });
    expect(trueNextStop(done, 'porch')).toBeUndefined();
    expect(trueNextStop(null, 'porch')).toBeUndefined();
  });
});

describe('routeFactsFor — position, heat, and the previous stop’s record', () => {
  it('names the real position from any stop’s view', () => {
    const f = routeFactsFor(AT_ROOFTOP, stop('porch'));
    expect(f.currentStopN).toBe(7);
    expect(f.currentStopName).toBe('The Rooftop');
    expect(f.currentPairNames).toBe('Poet and Seven');
    expect(f.clearedCount).toBe(6);
    expect(f.routeCompleted).toBe(false);
  });

  it('the heat is the ADVANCING win’s manner — the stop just behind his current one', () => {
    const f = routeFactsFor(AT_ROOFTOP, stop('porch'));
    expect(f.heatStopName).toBe('The Church Basement');
    expect(f.heatPairNames).toBe('Deacon Ford and Sister Mae');
    expect(f.heatBand).toBe('rout'); // 300 of the Church’s 500
  });

  it('at the current stop, the buzz fact is the previous stop’s latest record', () => {
    const f = routeFactsFor(AT_ROOFTOP, stop('rooftop'));
    expect(f.prevWon).toBe(true);
    expect(f.prevBand).toBe('rout');
    expect(f.prevStopName).toBe('The Church Basement');
    expect(f.prevPairNames).toBe('Deacon Ford and Sister Mae');
  });

  it('bands scale by the PREVIOUS stop’s own target, not the viewed stop’s', () => {
    // the Porch's latest: margin 160 — a rout at the Porch's 250 (64%),
    // merely solid against a 500 target. The Barbershop's buzz reads it.
    const f = routeFactsFor(AT_ROOFTOP, stop('barbershop'));
    expect(f.prevBand).toBe('rout');
    expect(f.prevStopName).toBe('The Porch');
    expect(f.prevPairNames).toBe('Uncle Ray and Pat');
  });

  it('a LOSS as the latest record at the previous stop: prevWon false, no band — the grind, never a win', () => {
    const p = progressWith({
      porch: { state: 'cleared', attempts: 2, clears: 1 },
      barbershop: { state: 'cleared', attempts: 3, clears: 1, lastResult: { won: false, margin: -140, endReason: 'target' } },
      'rec-center': { state: 'current', attempts: 0, clears: 0 },
    });
    const f = routeFactsFor(p, stop('rec-center'));
    expect(f.prevWon).toBe(false);
    expect(f.prevBand).toBeNull();
    // and the heat (barbershop is also the advancing stop here) stays silent too
    expect(f.heatBand).toBeNull();
    expect(f.heatStopName).toBeUndefined();
  });

  it('no recorded last result (pre-migration history) → no band, no prevWon: silence, not invention', () => {
    const p = progressWith({
      porch: { state: 'cleared', attempts: 2, clears: 1, lastResult: null },
      barbershop: { state: 'current', attempts: 0, clears: 0 },
    });
    const f = routeFactsFor(p, stop('barbershop'));
    expect(f.prevWon).toBeUndefined();
    expect(f.prevBand).toBeNull();
    expect(f.heatBand).toBeNull();
  });

  it('an early ending at the previous stop carries its flavor through (shot out → early)', () => {
    const p = progressWith({
      porch: { state: 'cleared', attempts: 1, clears: 1 },
      barbershop: { state: 'cleared', attempts: 1, clears: 1 },
      'rec-center': { state: 'cleared', attempts: 1, clears: 1 },
      cookout: { state: 'cleared', attempts: 1, clears: 1 },
      corner: { state: 'cleared', attempts: 1, clears: 1, lastResult: { won: true, margin: 30, endReason: 'shotOut' } },
      'church-basement': { state: 'current', attempts: 0, clears: 0 },
    });
    // a 30-point margin would read "close" — the shot-out outranks it
    expect(routeFactsFor(p, stop('church-basement')).prevBand).toBe('early');
  });

  it('signed-out / no progress: position facts are empty, never fabricated', () => {
    const f = routeFactsFor(null, stop('porch'));
    expect(f.currentStopN).toBeNull();
    expect(f.routeCompleted).toBe(false);
    expect(f.heatBand).toBeNull();
    expect(f.prevWon).toBeUndefined();
  });
});
