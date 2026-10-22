/**
 * Story co-op Phase 3 — the awareness layer (spec §7): the case matrix
 * over fabricated pair-context facts, the verbatim seated banks, the
 * scene variant (awareness meet lines replace the pair-first opener —
 * and solo selection is untouched without awareness facts), and the
 * co-op rundown selection keyed to PAIR facts.
 */
import { describe, expect, it } from 'vitest';
import {
  AWARENESS_NEVER_RECORD, PAIR_AWARENESS_RUNDOWNS, PAIR_FIRST_RUNDOWNS,
  PAIR_RETURN_CLEAR_RUNDOWNS, PAIR_RETURN_LOSS_RUNDOWNS, SEATED_AWARENESS_LINES,
  STORY_SCRIPTS, STORY_STOPS, awarenessCaseFor, awarenessFactsFor, awarenessIssues,
  awarenessMeetBeats, awarenessOpenerLength, beatsFor, coopRundownFor, rundownWordCount, storyStopById,
  type PairContextFacts,
} from '../src/index';

const player = (over: Partial<PairContextFacts['players'][number]> = {}): PairContextFacts['players'][number] => ({
  handle: 'P', knowsStop: false, clearedStop: false, clearedStops: 0, ...over,
});
const ctx = (players: [PairContextFacts['players'][number], PairContextFacts['players'][number]], pair: Partial<PairContextFacts['pair']> = {}): PairContextFacts => ({
  players, pair: { attempts: 0, clears: 0, doublePending: false, ...pair },
});

describe('awareness case matrix (§7.2)', () => {
  it('(a) true first meet: pair new, neither player knows the stop', () => {
    expect(awarenessCaseFor('porch', ctx([player(), player()]))).toBe('a');
  });
  it('(e) pair return beats personal history: the pair itself played here', () => {
    const c = ctx([player({ knowsStop: true, clearedStop: true }), player()], { attempts: 2 });
    expect(awarenessCaseFor('barbershop', c)).toBe('e');
  });
  it('(b) known faces: pair new, one player knows the stop but never cleared it', () => {
    const c = ctx([player({ knowsStop: true }), player()]);
    expect(awarenessCaseFor('corner', c)).toBe('b');
  });
  it('(b) both know it, neither cleared: still known faces, not veteran+rookie', () => {
    const c = ctx([player({ knowsStop: true }), player({ knowsStop: true })]);
    expect(awarenessCaseFor('corner', c)).toBe('b');
  });
  it('(d) veteran + rookie: exactly one cleared, the other never played', () => {
    const c = ctx([player({ handle: 'Vet', knowsStop: true, clearedStop: true, clearedStops: 4 }), player({ handle: 'Rook' })]);
    expect(awarenessCaseFor('porch', c)).toBe('d');
    const f = awarenessFactsFor('porch', c)!;
    expect(f.case).toBe('d');
    expect(f.vetHandle).toBe('Vet');
    expect(f.rookieHandle).toBe('Rook');
  });
  it('a veteran whose partner has PLAYED (not cleared) is (b), and the vet is the clearer', () => {
    const c = ctx([player({ handle: 'Vet', knowsStop: true, clearedStop: true }), player({ handle: 'Mid', knowsStop: true })]);
    expect(awarenessCaseFor('legends', c)).toBe('b');
    expect(awarenessFactsFor('legends', c)!.vetHandle).toBe('Vet');
    expect(awarenessFactsFor('legends', c)!.rookieHandle).toBeUndefined();
  });
  it('finale: a standing King double mark outranks every other case', () => {
    const c = ctx([player({ knowsStop: true, clearedStop: true }), player()], { attempts: 1, doublePending: true });
    expect(awarenessCaseFor('king', c)).toBe('finale');
    // ...but a double mark is a King-only state; other stops ignore it
    expect(awarenessCaseFor('porch', c)).toBe('e');
  });
  it('awareness facts exist only for (b)/(d)', () => {
    expect(awarenessFactsFor('porch', ctx([player(), player()]))).toBeNull();
    expect(awarenessFactsFor('porch', ctx([player(), player()], { attempts: 1 }))).toBeNull();
  });
});

describe('the seated awareness banks (§7.6, verbatim)', () => {
  it('are internally honest: two lines per stop, spoken by the pair in order', () => {
    expect(awarenessIssues()).toEqual([]);
    for (const stop of STORY_STOPS) expect(SEATED_AWARENESS_LINES[stop.id]).toHaveLength(2);
  });
  it("the Ringer's line is the stage direction and sits in the never-record set", () => {
    const ringer = SEATED_AWARENESS_LINES['king']![1]!;
    expect(ringer.speaker).toBe('ringer');
    expect(ringer.line).toBe('(The Ringer says nothing. He is looking at the new one.)');
    expect(AWARENESS_NEVER_RECORD.has(ringer.line)).toBe(true);
  });
  it('Church lines are profanity-free; every bank line is unique across stops', () => {
    const all = Object.values(SEATED_AWARENESS_LINES).flat().map((b) => b.line);
    expect(new Set(all).size).toBe(all.length);
    for (const b of SEATED_AWARENESS_LINES['church-basement']!) expect(b.line).not.toMatch(/damn|hell|shit|ass/i);
  });
});

describe('the awareness scene variant (§7.5)', () => {
  const vetFacts = { attempts: 0, cleared: false, railCast: [] as string[], awareness: { case: 'b' as const, vetHandle: 'Vet' } };
  it('replaces the meet opener; the remaining beats are the pair-first set', () => {
    for (const stop of STORY_STOPS) {
      const scene = beatsFor(stop, 'intro', vetFacts);
      const meet = awarenessMeetBeats(stop.id);
      expect(scene.slice(0, 2)).toEqual(meet);
      // railCast [] keeps the rail acknowledgment out of BOTH selections,
      // so the scene is exactly: awareness lines + pair-first intro minus
      // its leading seated-pair opener beats.
      const first = beatsFor(stop, 'intro', { attempts: 0, cleared: false, railCast: [] });
      const opener = awarenessOpenerLength(stop.id, first);
      expect(opener).toBeGreaterThan(0);
      expect(scene).toEqual([...meet, ...first.slice(opener)]);
    }
  });
  it('does not fire on a pair return (attempts > 0) or a cleared stop', () => {
    const stop = storyStopById('porch')!;
    const returned = beatsFor(stop, 'intro', { attempts: 1, cleared: false, awareness: { case: 'b', vetHandle: 'V' } });
    expect(returned).toEqual(beatsFor(stop, 'intro', { attempts: 1, cleared: false }));
    const cleared = beatsFor(stop, 'intro', { attempts: 0, cleared: true, awareness: { case: 'b', vetHandle: 'V' } });
    expect(cleared).toEqual(beatsFor(stop, 'intro', { attempts: 0, cleared: true }));
  });
  it('SOLO IS UNTOUCHED: without awareness facts every band selects exactly as before', () => {
    for (const stop of STORY_STOPS) {
      for (const facts of [
        { attempts: 0, cleared: false }, { attempts: 1, cleared: false },
        { attempts: 3, cleared: false }, { attempts: 0, cleared: true },
      ]) {
        const withUndef = beatsFor(stop, 'intro', { ...facts, awareness: undefined });
        expect(withUndef).toEqual(beatsFor(stop, 'intro', facts));
      }
    }
  });
});

describe('co-op rundown selection (§5.1 — keyed to PAIR facts)', () => {
  it('case (a) → pairFirst; (b)/(d) → pairAwareness', () => {
    expect(coopRundownFor('porch', 'a', { attempts: 0, clears: 0 })).toEqual({ variant: 'pairFirst', stopId: 'porch', text: PAIR_FIRST_RUNDOWNS['porch'] });
    expect(coopRundownFor('king', 'd', { attempts: 0, clears: 0 })!.variant).toBe('pairAwareness');
    expect(coopRundownFor('king', 'b', { attempts: 0, clears: 0 })!.text).toBe(PAIR_AWARENESS_RUNDOWNS['king']);
  });
  it('case (e) → the return variant matching the pair record', () => {
    expect(coopRundownFor('cookout', 'e', { attempts: 2, clears: 0 })!.variant).toBe('pairReturnLoss');
    expect(coopRundownFor('cookout', 'e', { attempts: 3, clears: 1 })!.variant).toBe('pairReturnClear');
  });
  it('finale → no rundown (the proposal owns that sit-down)', () => {
    expect(coopRundownFor('king', 'finale', { attempts: 1, clears: 0 })).toBeNull();
  });
  it('all four sets cover all 11 stops', () => {
    for (const set of [PAIR_FIRST_RUNDOWNS, PAIR_AWARENESS_RUNDOWNS, PAIR_RETURN_LOSS_RUNDOWNS, PAIR_RETURN_CLEAR_RUNDOWNS])
      expect(Object.keys(set).sort()).toEqual(STORY_STOPS.map((s) => s.id).sort());
  });
  it('return scripts hold the §8.9 discipline: 35–55 words, pair framing', () => {
    for (const set of [PAIR_RETURN_LOSS_RUNDOWNS, PAIR_RETURN_CLEAR_RUNDOWNS])
      for (const [stopId, text] of Object.entries(set)) {
        const n = rundownWordCount(text);
        expect(n, `${stopId}: ${n} words`).toBeGreaterThanOrEqual(35);
        expect(n, `${stopId}: ${n} words`).toBeLessThanOrEqual(55);
        expect(text).toMatch(/you-two|your pair|you both/i);
      }
  });
  it('solo scripts and co-op scripts are different sets (no shared text)', () => {
    const coop = new Set([...Object.values(PAIR_FIRST_RUNDOWNS), ...Object.values(PAIR_AWARENESS_RUNDOWNS),
      ...Object.values(PAIR_RETURN_LOSS_RUNDOWNS), ...Object.values(PAIR_RETURN_CLEAR_RUNDOWNS)]);
    expect(coop.size).toBe(44);
    for (const stop of STORY_STOPS)
      for (const beat of STORY_SCRIPTS[stop.id]!.intro) expect(coop.has(beat.line)).toBe(false);
  });
});
