/**
 * Story co-op Phase 3 — Dee's guide layer (spec §5.3–5.4, §8): trigger
 * selection on real score bands, the density constitution (max 1 line
 * per hand, class spacing, slow stops measurably quieter), the
 * once-only beats (awareness callback, comeback, depth), never-repeat
 * dedupe, and the fence-facing shape: lines are plain board-truth
 * strings — no card facts, no voice payload anywhere in the layer.
 */
import { describe, expect, it } from 'vitest';
import {
  GUIDE_AWARE, GUIDE_COMEBACK, GUIDE_DEPTH, GUIDE_FINALE, GUIDE_FOCUS, GUIDE_LOSING,
  GUIDE_MATCH_POINT_THEM, GUIDE_MATCH_POINT_US, GUIDE_NIL, GUIDE_OUTRO, GUIDE_SET_THEM,
  GUIDE_SET_US, GUIDE_SPEAK_P, GUIDE_WINNING, STOP_DENSITY_CLASS, STORY_STOPS,
  allGuideLines, guideEventLine, guideHandLine, guideIssues, newGuideState,
  type GuideHandFacts, type GuideState,
} from '../src/index';

/** deterministic rng for the evaluator (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** an rng that always passes its rolls (state reads always fire) */
const always = () => 0;

const facts = (over: Partial<GuideHandFacts> = {}): GuideHandFacts => ({
  handNo: 1, us: 0, them: 0, prevUs: 0, prevThem: 0, target: 250,
  usPoints: 30, themPoints: 20, setOnUs: false, setOnThem: false,
  nil: null, partnerMoment: false, awareCase: 'a', ...over,
});

describe('the banks (§8 verbatim counts)', () => {
  it('hold exactly the specced lines', () => {
    expect(GUIDE_WINNING).toHaveLength(10);
    expect(GUIDE_LOSING).toHaveLength(10);
    expect(GUIDE_FOCUS).toHaveLength(4);
    expect(GUIDE_AWARE).toHaveLength(6);
    expect(GUIDE_FINALE).toHaveLength(12);
    expect(Object.keys(GUIDE_DEPTH).sort()).toEqual(STORY_STOPS.map((s) => s.id).sort());
    for (const lines of Object.values(GUIDE_DEPTH)) expect(lines).toHaveLength(2);
    expect(GUIDE_OUTRO.win).toHaveLength(2);
    expect(GUIDE_OUTRO.loss).toHaveLength(2);
    // the mini-bake tally: 47 chatter (incl. outro 6) + 22 depth + 6 aware + 12 finale = 87 Dee guide clips
    expect(allGuideLines()).toHaveLength(87);
  });
  it('are internally honest: no line in two pools, depth at every stop', () => {
    expect(guideIssues()).toEqual([]);
  });
  it('speak from the board only — no card/rank/suit talk anywhere (no-disclosure)', () => {
    for (const { line } of allGuideLines()) {
      expect(line).not.toMatch(/\b(ace|king|queen|jack|joker) of\b/i);
      expect(line).not.toMatch(/\b\d\s?of (spades|hearts|diamonds|clubs)\b/i);
      expect(line.toLowerCase()).not.toContain('trump');
    }
  });
});

describe('trigger selection on real bands', () => {
  it('match point entered fires the match-point pool (us, then them)', () => {
    const st = newGuideState('porch', 't1');
    const us = guideHandLine('porch', st, facts({ handNo: 5, us: 210, them: 100, prevUs: 180, prevThem: 90 }), always);
    expect(us?.trigger).toBe('matchPoint');
    expect(GUIDE_MATCH_POINT_US).toContain(us!.text);
    const st2 = newGuideState('porch', 't2');
    const them = guideHandLine('porch', st2, facts({ handNo: 5, us: 90, them: 205, prevUs: 80, prevThem: 170 }), always);
    expect(them?.trigger).toBe('matchPoint');
    expect(GUIDE_MATCH_POINT_THEM).toContain(them!.text);
  });
  it('match point does NOT re-fire while a side simply stays in the band', () => {
    const st = newGuideState('porch', 't3');
    const line = guideHandLine('porch', st, facts({ handNo: 6, us: 230, them: 100, prevUs: 210, prevThem: 90, usPoints: 20, themPoints: 10 }), () => 0.99);
    expect(line?.trigger).not.toBe('matchPoint');
  });
  it('a set fires the set pool — ours on them reads as the cheer, theirs on us as the lesson', () => {
    const st = newGuideState('corner', 't4');
    const cheer = guideHandLine('corner', st, facts({ handNo: 2, setOnThem: true }), always);
    expect(cheer?.trigger).toBe('set');
    expect(GUIDE_SET_US).toContain(cheer!.text);
    const st2 = newGuideState('corner', 't5');
    const lesson = guideHandLine('corner', st2, facts({ handNo: 2, setOnUs: true }), always);
    expect(GUIDE_SET_THEM).toContain(lesson!.text);
  });
  it('the comeback fires once: lead taken after trailing ≥100', () => {
    const st = newGuideState('cookout', 't6');
    guideHandLine('cookout', st, facts({ handNo: 3, us: 40, them: 160, prevUs: 30, prevThem: 90, usPoints: 10, themPoints: 70 }), () => 0.99);
    const back = guideHandLine('cookout', st, facts({ handNo: 5, us: 180, them: 170, prevUs: 40, prevThem: 160, usPoints: 40, themPoints: 30 }), always);
    expect(back?.trigger).toBe('comeback');
    expect(GUIDE_COMEBACK).toContain(back!.text);
    const again = guideHandLine('cookout', st, facts({ handNo: 7, us: 190, them: 100, prevUs: 180, prevThem: 170, usPoints: 10, themPoints: -70 }), always);
    expect(again?.trigger).not.toBe('comeback');
  });
  it('nil outcomes map to their lines; a made nil for THEM earns silence from this pool', () => {
    const st = newGuideState('church-basement', 't7');
    const made = guideHandLine('church-basement', st, facts({ handNo: 3, nil: 'oursMade' }), always);
    expect(made?.text).toBe(GUIDE_NIL.oursMade);
    const st2 = newGuideState('church-basement', 't8');
    const busted = guideHandLine('church-basement', st2, facts({ handNo: 3, nil: 'theirsBusted' }), always);
    expect(busted?.text).toBe(GUIDE_NIL.theirsBusted);
    const st3 = newGuideState('church-basement', 't9');
    const theirs = guideHandLine('church-basement', st3, facts({ handNo: 3, nil: 'theirsMade', usPoints: 10, themPoints: 10 }), () => 0.99);
    expect(theirs?.trigger).not.toBe('nil');
  });
  it('the state read reads the band: ≥40 winning, ≤−40 losing, inside 40 focus', () => {
    const win = guideHandLine('porch', newGuideState('porch', 's1'), facts({ us: 60, them: 10 }), always);
    expect(win?.trigger).toBe('state');
    expect(GUIDE_WINNING).toContain(win!.text);
    const lose = guideHandLine('porch', newGuideState('porch', 's2'), facts({ us: 0, them: 55 }), always);
    expect(GUIDE_LOSING).toContain(lose!.text);
    const even = guideHandLine('porch', newGuideState('porch', 's3'), facts({ us: 20, them: 15 }), always);
    expect(GUIDE_FOCUS).toContain(even!.text);
  });
  it('a big swing (≥60 hand points) outranks the plain state read', () => {
    const st = newGuideState('porch', 's4');
    const line = guideHandLine('porch', st, facts({ us: 30, them: 25, usPoints: 90, themPoints: 10 }), always);
    expect(line?.trigger).toBe('bigSwing');
  });
});

describe('the density constitution (§5.4)', () => {
  /** play a synthetic match of alternating quiet hands; count guide lines */
  function sim(stopId: string, hands: number, seed: number): { lines: number; state: GuideState; firedHands: number[] } {
    const st = newGuideState(stopId, `sim-${stopId}-${seed}`);
    const r = rng(seed);
    const firedHands: number[] = [];
    let us = 0; let them = 0;
    for (let h = 1; h <= hands; h++) {
      const prevUs = us; const prevThem = them;
      us += 25; them += 20;
      const line = guideHandLine(stopId, st, facts({ handNo: h, us, them, prevUs, prevThem, usPoints: 25, themPoints: 20 }), r);
      if (line) firedHands.push(h);
    }
    return { lines: firedHands.length, state: st, firedHands };
  }
  it('never two lines in one hand, and spacing per class is respected', () => {
    for (const stop of STORY_STOPS) {
      const { firedHands } = sim(stop.id, 14, 7);
      const spacing = stop.id === 'church-basement' || stop.id === 'rooftop' || stop.id === 'corner' || stop.id === 'the-pjs' || stop.id === 'high-rise' ? 2 : 1;
      for (let i = 1; i < firedHands.length; i++) expect(firedHands[i]! - firedHands[i - 1]!).toBeGreaterThanOrEqual(spacing);
      expect(new Set(firedHands).size).toBe(firedHands.length);
    }
  });
  it('the slow stops are measurably quieter than the loud ones over the same match', () => {
    let slow = 0; let loud = 0;
    for (let seed = 1; seed <= 12; seed++) {
      slow += sim('church-basement', 12, seed).lines + sim('rooftop', 12, seed).lines;
      loud += sim('rec-center', 12, seed).lines + sim('cookout', 12, seed).lines;
    }
    expect(slow).toBeLessThan(loud);
    expect(loud).toBeGreaterThan(0);
  });
  it('with rolls forced to fail, slow stops go silent except the seeded depth beat — presence without flooding', () => {
    const st = newGuideState('rooftop', 'quiet');
    let us = 0; let them = 0;
    for (let h = 1; h <= 6; h++) {
      const p = { prevUs: us, prevThem: them };
      us += 20; them += 25;
      const line = guideHandLine('rooftop', st, facts({ handNo: h, us, them, ...p, usPoints: 20, themPoints: 25 }), () => 0.99);
      if (line) expect(line.trigger).toBe('depth'); // the one un-rolled beat
    }
    expect(st.handsSeen).toBe(6);
  });
  it('the class speech probabilities are the specced numbers', () => {
    expect(GUIDE_SPEAK_P[STOP_DENSITY_CLASS['porch']!]).toBe(0.85);
    expect(GUIDE_SPEAK_P[STOP_DENSITY_CLASS['church-basement']!]).toBe(0.45);
    expect(GUIDE_SPEAK_P[STOP_DENSITY_CLASS['corner']!]).toBe(0.55);
    expect(GUIDE_SPEAK_P[STOP_DENSITY_CLASS['barbershop']!]).toBe(0.7);
  });
});

describe('once-only beats and memory', () => {
  it('the awareness callback fires once, only when case (b)/(d) facts exist', () => {
    const st = newGuideState('porch', 'a1');
    const first = guideHandLine('porch', st, facts({ handNo: 1, awareCase: 'b' }), always);
    expect(first?.trigger).toBe('aware');
    expect(GUIDE_AWARE).toContain(first!.text);
    let awareAgain = 0;
    for (let h = 3; h <= 9; h += 2) {
      const l = guideHandLine('porch', st, facts({ handNo: h, awareCase: 'b', us: h * 10, them: 0, prevUs: (h - 1) * 10, prevThem: 0 }), always);
      if (l?.trigger === 'aware') awareAgain++;
    }
    expect(awareAgain).toBe(0);
    const solo = newGuideState('porch', 'a2');
    expect(guideHandLine('porch', solo, facts({ handNo: 1, awareCase: 'a' }), always)?.trigger).not.toBe('aware');
    const returned = newGuideState('porch', 'a3');
    expect(guideHandLine('porch', returned, facts({ handNo: 1, awareCase: 'e' }), always)?.trigger).not.toBe('aware');
  });
  it('story depth fires at its seeded hand (2–4) and, at loud stops only, once more at 7+', () => {
    for (const stopId of ['cookout', 'church-basement'] as const) {
      const st = newGuideState(stopId, 'depth-seed');
      expect(st.depthHand1).toBeGreaterThanOrEqual(2);
      expect(st.depthHand1).toBeLessThanOrEqual(4);
      if (stopId === 'cookout') expect(st.depthHand2).not.toBeNull();
      else expect(st.depthHand2).toBeNull();
      // silence every other trigger: failing rolls, neutral board — depth is not chance-gated
      const depth = guideHandLine(stopId, st, facts({ handNo: st.depthHand1, usPoints: 20, themPoints: 15 }), () => 0.99);
      expect(depth?.trigger).toBe('depth');
      expect(GUIDE_DEPTH[stopId]).toContain(depth!.text);
    }
  });
  it('no line ever repeats within a match', () => {
    const st = newGuideState('legends', 'dedupe');
    const r = rng(42);
    const texts: string[] = [];
    let us = 0; let them = 0;
    for (let h = 1; h <= 16; h++) {
      const p = { prevUs: us, prevThem: them };
      us += h % 3 === 0 ? -30 : 45; them += h % 4 === 0 ? 60 : 15;
      const l = guideHandLine('legends', st, facts({ handNo: h, us, them, ...p, usPoints: 45, themPoints: 15, target: 500 }), r);
      if (l) texts.push(l.text);
    }
    expect(new Set(texts).size).toBe(texts.length);
  });
  it('the nuke reaction (guideEventLine) spends the hand’s one slot', () => {
    const st = newGuideState('porch', 'nuke');
    const ev = guideEventLine('porch', st, 4, always);
    expect(ev?.trigger).toBe('partnerMoment');
    expect(GUIDE_FOCUS).toContain(ev!.text);
    const handEnd = guideHandLine('porch', st, facts({ handNo: 4, us: 80, them: 0, prevUs: 40, prevThem: 0 }), always);
    expect(handEnd).toBeNull();
  });
});
