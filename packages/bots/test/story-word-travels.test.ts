/**
 * WORD TRAVELS FAST (owner, 2026-10-24): "my actual next stop is the
 * rooftop but if I go back and play the porch it tells me my next stop
 * is the barbershop… Not only do I want them to know we won but how we
 * won, if it was a close one or an annihilation. The actual next stops
 * should know that as well and have something to say about it when they
 * feel like it… such and such got smoke wit y'all."
 *
 * Pins: next-stop truth on replays (progress-derived, never played+1),
 * first-clear invariance (the authored scenes are byte-identical where
 * they were always true), recognition (a different trigger than
 * retry), manner bands scaled to the stop's target, smoke disciplined
 * to the decisive flavors, buzz caps — and the fence: every line this
 * system speaks is text-only scene copy in a real character's voice.
 */
import { describe, expect, it } from 'vitest';
import {
  STORY_BUZZ, STORY_CHARACTERS, STORY_INTRO_VARIANTS, STORY_SCRIPTS, STORY_STOPS,
  beatsFor, buzzMomentFor, mannerBandOf, recognitionBeatsFor, replayOutroFor, targetForStop,
  type StoryBeat, type StoryBeatFacts,
} from '../src';

const stop = (id: string) => STORY_STOPS.find((s) => s.id === id)!;
const text = (beats: readonly StoryBeat[]) => beats.map((x) => x.line).join('\n');

/** The owner's exact position: six stops cleared, Rooftop (7) current,
 *  the Church Basement cleared decisively (margin 300 of 500 = rout). */
const AT_ROOFTOP: StoryBeatFacts = {
  attempts: 4, cleared: true,
  currentStopN: 7, currentStopName: 'The Rooftop', currentPairNames: 'Poet and Seven',
  clearedCount: 6, routeCompleted: false,
  heatBand: 'rout', heatStopName: 'The Church Basement', heatPairNames: 'Deacon Ford and Sister Mae',
};

describe('manner bands (storyManner — the one definition)', () => {
  it('scales with the stop target: the same raw margin is a different story at 250 and at 750', () => {
    expect(mannerBandOf({ won: true, margin: 160, endReason: 'target' }, 250)).toBe('rout'); // 64% of the Porch
    expect(mannerBandOf({ won: true, margin: 160, endReason: 'target' }, 750)).toBe('solid'); // 21% of the King
    expect(mannerBandOf({ won: true, margin: 50, endReason: 'target' }, 250)).toBe('close'); // exactly 20%
    expect(mannerBandOf({ won: true, margin: 140, endReason: 'target' }, 250)).toBe('rout'); // 56%
    expect(mannerBandOf({ won: true, margin: 130, endReason: 'target' }, 250)).toBe('solid'); // 52%
    expect(mannerBandOf({ won: true, margin: 420, endReason: 'target' }, 750)).toBe('rout'); // 56%
    expect(mannerBandOf({ won: true, margin: 400, endReason: 'target' }, 750)).toBe('solid'); // 53%
  });

  it('an early ending is its own flavor, outranking the margin; through the floor is a rout', () => {
    expect(mannerBandOf({ won: true, margin: 10, endReason: 'shotOut' }, 500)).toBe('early');
    expect(mannerBandOf({ won: true, margin: 10, endReason: 'third-set' }, 500)).toBe('early');
    expect(mannerBandOf({ won: true, margin: 490, endReason: 'shotOut' }, 500)).toBe('early');
    expect(mannerBandOf({ won: true, margin: 10, endReason: 'floor' }, 500)).toBe('rout');
  });

  it('no fact, no band: losses, missing margins and missing facts stay silent', () => {
    expect(mannerBandOf({ won: false, margin: -300, endReason: 'target' }, 500)).toBeNull();
    expect(mannerBandOf({ won: true, endReason: 'target' }, 500)).toBeNull(); // win, manner unrecorded
    expect(mannerBandOf(null, 500)).toBeNull();
    expect(mannerBandOf(undefined, 500)).toBeNull();
  });

  it('targets come from the stops themselves (Porch 250, King 750, standard 500)', () => {
    expect(targetForStop(stop('porch'))).toBe(250);
    expect(targetForStop(stop('king'))).toBe(750);
    expect(targetForStop(stop('rooftop'))).toBe(500);
    for (const s of STORY_STOPS) expect(targetForStop(s)).toBeGreaterThan(0);
  });
});

describe('next-stop truth — the replay outro swap', () => {
  it('the owner’s case: cleared through stop 6, replaying the Porch points at the Rooftop — never the Barbershop', () => {
    const beats = beatsFor(stop('porch'), 'outroWin', { ...AT_ROOFTOP, firstClear: false });
    expect(text(beats)).toContain('The Rooftop');
    expect(text(beats)).not.toContain('Barbershop');
    expect(beats.length).toBeLessThanOrEqual(4); // the outro cap holds through the swap
    expect(beats.some((x) => x.next)).toBe(false); // no onward beat survives unswapped
  });

  it('replaying a mid stop (Rec Center, 3) also points at 7, not 4', () => {
    const beats = beatsFor(stop('rec-center'), 'outroWin', { ...AT_ROOFTOP, attempts: 2, firstClear: false });
    expect(text(beats)).toContain('The Rooftop');
    expect(text(beats)).not.toContain('Twins are next');
  });

  it('BOTH of the High-Rise’s onward beats are swapped (it authored two)', () => {
    const beats = beatsFor(stop('high-rise'), 'outroWin', {
      attempts: 2, cleared: true, firstClear: false,
      currentStopN: 10, currentStopName: 'The Legends’ Table', routeCompleted: false,
    });
    expect(text(beats)).toContain('The Legends’ Table');
    expect(text(beats)).not.toContain('Pj’s next');
    expect(text(beats)).not.toContain('Pj’s is next');
    expect(beats.some((x) => x.next)).toBe(false);
  });

  it('route complete: the swap says the true thing — there is no next stop', () => {
    const beats = beatsFor(stop('porch'), 'outroWin', {
      attempts: 9, cleared: true, firstClear: false,
      currentStopN: null, routeCompleted: true,
    });
    expect(text(beats)).toContain('homecoming');
    expect(text(beats)).not.toContain('{current}');
    expect(text(beats)).not.toContain('Barbershop');
  });

  it('the Porch reacts to THIS game’s manner on a replay (tease vs respect)', () => {
    const rout = beatsFor(stop('porch'), 'outroWin', { ...AT_ROOFTOP, firstClear: false, justBand: 'rout' });
    expect(text(rout)).toContain('DEMONSTRATION');
    expect(text(rout)).toContain('The Rooftop');
    const close = beatsFor(stop('porch'), 'outroWin', { ...AT_ROOFTOP, firstClear: false, justBand: 'close' });
    expect(text(close)).toContain('down to the wire');
    const early = beatsFor(stop('porch'), 'outroWin', { ...AT_ROOFTOP, firstClear: false, justBand: 'early' });
    expect(text(early)).toContain('Ended it EARLY');
  });

  it('FIRST-CLEAR INVARIANCE: a genuine first pass at stop 1 still says the Barbershop is next — it is true there', () => {
    const first = beatsFor(stop('porch'), 'outroWin', { attempts: 0, cleared: false, firstClear: true });
    expect(first).toBe(STORY_SCRIPTS['porch']!.outroWin); // the authored array, by reference
    expect(text(first)).toContain('Next is the Barbershop');
    // …and a legacy caller that never says firstClear gets the same scene
    expect(beatsFor(stop('porch'), 'outroWin', { attempts: 1, cleared: true })).toBe(STORY_SCRIPTS['porch']!.outroWin);
    // every stop's first-clear outro is untouched
    for (const s of STORY_STOPS) {
      expect(beatsFor(s, 'outroWin', { ...AT_ROOFTOP, attempts: 0, cleared: false, firstClear: true }), s.id)
        .toEqual(expect.arrayContaining(STORY_SCRIPTS[s.id]!.outroWin));
    }
  });

  it('a replay outro never carries first-clear framing, and a loss outro is never swapped', () => {
    const beats = beatsFor(stop('porch'), 'outroWin', { ...AT_ROOFTOP, firstClear: false });
    expect(text(beats)).not.toMatch(/unlock|first clear/i);
    expect(beatsFor(stop('porch'), 'outroLose', { ...AT_ROOFTOP, firstClear: false })).toBe(STORY_SCRIPTS['porch']!.outroLose);
    // replayOutroFor with nothing to swap returns the base untouched
    expect(replayOutroFor(stop('king'), STORY_SCRIPTS['king']!.outroWin, { attempts: 2, cleared: true })).toBe(STORY_SCRIPTS['king']!.outroWin);
  });
});

describe('replay recognition — word travels fast (intros)', () => {
  it('fires for a cleared-stop replay with position ahead, naming the real current stop', () => {
    const beats = beatsFor(stop('porch'), 'intro', AT_ROOFTOP);
    const t = text(beats);
    expect(t).toContain('seated up at The Rooftop now');
    // the champion scene still frames it — recognition is woven in, not a replacement
    expect(t).toContain('champions of the route');
  });

  it('carries the heat in relay voice, band-gated: decisive wins leave smoke — with the pair ahead AND the pair behind', () => {
    const t = text(beatsFor(stop('porch'), 'intro', AT_ROOFTOP));
    // Dee relays the advancing win's smoke (the pair behind holds it)
    expect(t).toContain('Deacon Ford and Sister Mae got smoke wit y’all');
    expect(t).toContain('The Church Basement');
    // inverted: Ray relays who holds smoke for him NOW (the pair at his current stop)
    expect(t).toContain('Poet and Seven got smoke wit y’all');
  });

  it('a CLOSE advancing win earns war stories, not smoke (band discipline)', () => {
    const t = text(beatsFor(stop('porch'), 'intro', { ...AT_ROOFTOP, heatBand: 'close' }));
    expect(t).toContain('barely got out of The Church Basement');
    expect(t).toContain('war story');
    expect(t).not.toContain('got smoke wit');
  });

  it('no recorded manner → no manner line (position still lands)', () => {
    const t = text(beatsFor(stop('porch'), 'intro', { ...AT_ROOFTOP, heatBand: null, heatStopName: undefined, heatPairNames: undefined }));
    expect(t).toContain('The Rooftop');
    expect(t).not.toContain('got smoke wit');
    expect(t).not.toContain('barely got out');
  });

  it('does NOT fire on first visits or on loss-retries of uncleared stops — recognition is not retry', () => {
    const first = beatsFor(stop('porch'), 'intro', { ...AT_ROOFTOP, attempts: 0, cleared: false });
    expect(first).toBe(STORY_SCRIPTS['porch']!.intro);
    const retry = beatsFor(stop('porch'), 'intro', { ...AT_ROOFTOP, attempts: 2, cleared: false });
    expect(retry).toBe(STORY_INTRO_VARIANTS['porch']!.grind);
    expect(text(retry)).not.toContain('seated up at');
  });

  it('does not fire when the route stands at this stop (no position ahead), and stays the champion scene', () => {
    const facts: StoryBeatFacts = { ...AT_ROOFTOP, currentStopN: 1, currentStopName: 'The Porch' };
    expect(recognitionBeatsFor(stop('porch'), facts)).toEqual([]);
    expect(beatsFor(stop('porch'), 'intro', facts)).toBe(STORY_INTRO_VARIANTS['porch']!.champion);
  });

  it('route complete: the finisher is greeted as one, and no pair ahead is invented to hold smoke', () => {
    const t = text(beatsFor(stop('porch'), 'intro', {
      ...AT_ROOFTOP, currentStopN: null, currentStopName: undefined, currentPairNames: undefined, routeCompleted: true,
    }));
    expect(t).toContain('The whole route, babies');
    expect(t).not.toContain('Poet and Seven got smoke');
  });

  it('generalizes: every stop on the route carries recognition copy (the King: complete only)', () => {
    for (const s of STORY_STOPS) {
      const beats = recognitionBeatsFor(s, {
        attempts: 3, cleared: true, currentStopN: 11, currentStopName: 'The King of the Block',
        currentPairNames: 'The King and The Ringer', routeCompleted: false,
      });
      if (s.id === 'king') expect(beats).toEqual([]); // nothing stands ahead of the King
      else expect(beats.length, s.id).toBeGreaterThan(0);
      expect(text(beats)).not.toContain('{current}');
    }
  });
});

describe('forward buzz — the next stop has heard (in-match, when they feel like it)', () => {
  const rooftop = stop('rooftop');
  const buzzFacts = (over: Partial<Parameters<typeof buzzMomentFor>[2]> = {}) => ({
    attempts: 1, checks: 0, fired: 0, said: [] as string[],
    prevWon: true, prevBand: 'rout' as const, prevStopName: 'The Church Basement', prevPairNames: 'Deacon Ford and Sister Mae',
    ...over,
  });
  /** Sweep the seeded roll cursor: the set of distinct lines a moment can land across a match's worth of evaluations. */
  const landed = (moment: 'sitDown' | 'handEnd', over = {}) => {
    const seen = new Map<string, StoryBeat[]>();
    for (let checks = 0; checks < 60; checks++) {
      const beats = buzzMomentFor(rooftop, moment, buzzFacts({ ...over, checks }));
      if (beats) for (const bt of beats) seen.set(bt.line, beats);
    }
    return [...seen.values()];
  };

  it('can pick the previous-clear manner line at the next stop when the fact exists and the moment fits', () => {
    const hits = landed('sitDown');
    expect(hits.length).toBeGreaterThan(0); // reachable, not guaranteed — "when they feel like it"
    const smokeLines = new Set(STORY_BUZZ['rooftop']!.smoke.flat().map((x) => x.line));
    for (const beats of hits) {
      for (const bt of beats) expect(smokeLines.has(bt.line), bt.line).toBe(true); // decisive band → the smoke family only
      expect(text(beats)).not.toContain('{'); // tokens always filled
    }
    // the direct variant names the previous pair (the owner's template)
    expect(hits.some((beats) => text(beats).includes('Deacon Ford and Sister Mae got smoke wit y’all'))).toBe(true);
    // …and a vague variant rides beside it, so it never lands identically every time
    expect(hits.some((beats) => text(beats).includes('The last table you ran got smoke wit y’all'))).toBe(true);
  });

  it('CANNOT fire without the fact: no recorded result at the previous stop → silence at every roll', () => {
    for (let checks = 0; checks < 60; checks++) {
      expect(buzzMomentFor(rooftop, 'sitDown', buzzFacts({ checks, prevWon: undefined, prevBand: null }))).toBeNull();
      expect(buzzMomentFor(rooftop, 'handEnd', buzzFacts({ checks, prevWon: undefined, prevBand: null }))).toBeNull();
    }
  });

  it('band discipline: a close win draws war stories, never smoke; a loss draws the honest grind', () => {
    const war = landed('sitDown', { prevBand: 'close' });
    expect(war.length).toBeGreaterThan(0);
    for (const beats of war) {
      expect(text(beats)).toContain('barely got out of the basement');
      expect(text(beats)).not.toContain('smoke wit');
    }
    const grind = landed('sitDown', { prevWon: false, prevBand: null });
    expect(grind.length).toBeGreaterThan(0);
    for (const beats of grind) expect(text(beats)).toContain('keeps the last visit');
    const earlies = landed('handEnd', { prevBand: 'early' });
    const smokeLines = new Set(STORY_BUZZ['rooftop']!.smoke.flat().map((x) => x.line));
    expect(earlies.length).toBeGreaterThan(0);
    for (const beats of earlies) for (const bt of beats) expect(smokeLines.has(bt.line), bt.line).toBe(true);
  });

  it('caps + repetition: one buzz a match, and a said line never repeats', () => {
    for (let checks = 0; checks < 20; checks++) {
      expect(buzzMomentFor(rooftop, 'sitDown', buzzFacts({ checks, fired: 1 }))).toBeNull();
    }
    const first = landed('sitDown')[0]!;
    const said = first.map((x) => x.line);
    for (let checks = 0; checks < 60; checks++) {
      const beats = buzzMomentFor(rooftop, 'sitDown', buzzFacts({ checks, said }));
      if (beats) for (const bt of beats) expect(said).not.toContain(bt.line);
    }
    // pool exhausted → silence
    const allSmoke = STORY_BUZZ['rooftop']!.smoke.flat().map((x) => x.line);
    for (let checks = 0; checks < 20; checks++) {
      expect(buzzMomentFor(rooftop, 'sitDown', buzzFacts({ checks, said: allSmoke }))).toBeNull();
    }
  });

  it('the Porch has no previous stop — no buzz there, ever; every later stop has a full pool', () => {
    for (let checks = 0; checks < 10; checks++) {
      expect(buzzMomentFor(stop('porch'), 'sitDown', buzzFacts({ checks }))).toBeNull();
    }
    for (const s of STORY_STOPS) {
      if (s.n < 2) continue;
      const set = STORY_BUZZ[s.id]!;
      expect(set, s.id).toBeTruthy();
      for (const fam of ['smoke', 'war', 'word', 'grind'] as const) expect(set[fam].length, `${s.id} ${fam}`).toBeGreaterThan(0);
      for (const beats of [...set.smoke, ...set.war, ...set.word, ...set.grind]) {
        for (const bt of beats) expect(STORY_CHARACTERS[bt.speaker], `${s.id}: ${bt.speaker}`).toBeTruthy();
      }
    }
  });
});

describe('the fence — every new line is a real character’s text, no placeholders survive', () => {
  it('recognition + replay + heat lines name only seated/known voices and fill their tokens', () => {
    for (const s of STORY_STOPS) {
      const recog = recognitionBeatsFor(s, { ...AT_ROOFTOP, attempts: 3 });
      for (const bt of recog) {
        expect(STORY_CHARACTERS[bt.speaker], `${s.id} recognition: ${bt.speaker}`).toBeTruthy();
        expect(bt.line).not.toContain('{');
      }
      const outro = replayOutroFor(s, STORY_SCRIPTS[s.id]!.outroWin, { ...AT_ROOFTOP, attempts: 3, firstClear: false });
      for (const bt of outro) expect(bt.line).not.toContain('{');
    }
  });
});
