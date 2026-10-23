/**
 * Dee's Rundown — the SOLO meet-them briefing (rundown spec §3/§5/§8):
 * the 34 verbatim scripts (11 first-meet + 11 return-after-loss +
 * 11 return-after-clear + the King leg-2 piece), the fact-keyed
 * selector with its precedence (leg2 > clear > loss > first), the
 * word bounds, the Church profanity pin, the no-spoilers pin, and the
 * corpus-dump enumeration. The texts are the RECORDED display texts —
 * each one is the key of Dee's take in her cast sprite (lilcuz-f) — so
 * the inventory pin below (exact chars + words per entry, from the
 * spec's §6 table) and the sha1 clip-id pin guard them byte-for-byte.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PAIR_AWARENESS_RUNDOWNS, PAIR_FIRST_RUNDOWNS, PAIR_RETURN_CLEAR_RUNDOWNS, PAIR_RETURN_LOSS_RUNDOWNS,
  RUNDOWN_FIRST, RUNDOWN_KING_LEG2, RUNDOWN_RETURN_CLEAR, RUNDOWN_RETURN_LOSS,
  STORY_SECRETS, STORY_STOPS, allSoloRundowns, rundownFor, rundownWordCount, storyStopById,
} from '../src/index';
import { storyCorpus } from '../../../scripts/voice-bake/dump-story-lines';

const clipId = (text: string): string => createHash('sha1').update(`dee|${text}`, 'utf8').digest('hex').slice(0, 12);
const byKey = (stopId: string, variant: string) => allSoloRundowns().find((r) => r.stopId === stopId && r.variant === variant);

/** The spec §6 inventory: [chars, words] per (stop, variant), counted from the scripts as approved. */
const INVENTORY: Record<string, [number, number]> = {
  'porch|first': [496, 94], 'porch|returnLoss': [243, 46], 'porch|returnClear': [203, 40],
  'barbershop|first': [481, 89], 'barbershop|returnLoss': [214, 43], 'barbershop|returnClear': [212, 38],
  'rec-center|first': [556, 102], 'rec-center|returnLoss': [245, 46], 'rec-center|returnClear': [213, 39],
  'cookout|first': [552, 100], 'cookout|returnLoss': [211, 39], 'cookout|returnClear': [205, 39],
  'corner|first': [534, 103], 'corner|returnLoss': [225, 45], 'corner|returnClear': [217, 38],
  'church-basement|first': [637, 117], 'church-basement|returnLoss': [249, 43], 'church-basement|returnClear': [219, 40],
  'rooftop|first': [606, 111], 'rooftop|returnLoss': [242, 44], 'rooftop|returnClear': [197, 35],
  'high-rise|first': [562, 103], 'high-rise|returnLoss': [237, 46], 'high-rise|returnClear': [203, 36],
  'the-pjs|first': [561, 105], 'the-pjs|returnLoss': [245, 48], 'the-pjs|returnClear': [207, 39],
  'legends|first': [589, 108], 'legends|returnLoss': [234, 45], 'legends|returnClear': [207, 38],
  'king|first': [629, 119], 'king|kingLeg2': [335, 64], 'king|returnLoss': [271, 53], 'king|returnClear': [282, 53],
};

describe('the solo rundown inventory (spec §5/§6)', () => {
  it('exactly 34 scripts: every stop × first/returnLoss/returnClear, plus the King leg-2 piece', () => {
    const all = allSoloRundowns();
    expect(all).toHaveLength(34);
    expect(new Set(all.map((r) => `${r.stopId}|${r.variant}`)).size).toBe(34);
    for (const stop of STORY_STOPS) {
      for (const variant of ['first', 'returnLoss', 'returnClear'] as const) {
        expect(byKey(stop.id, variant)?.text.length, `${stop.id} ${variant}`).toBeGreaterThan(0);
      }
    }
    expect(all.filter((r) => r.variant === 'kingLeg2').map((r) => r.stopId)).toEqual(['king']);
    expect(Object.keys(RUNDOWN_FIRST)).toEqual(STORY_STOPS.map((s) => s.id));
    expect(Object.keys(RUNDOWN_RETURN_LOSS)).toEqual(STORY_STOPS.map((s) => s.id));
    expect(Object.keys(RUNDOWN_RETURN_CLEAR)).toEqual(STORY_STOPS.map((s) => s.id));
  });

  it('every script matches the spec inventory exactly (chars + words)', () => {
    for (const [key, [chars, words]] of Object.entries(INVENTORY)) {
      const [stopId, variant] = key.split('|') as [string, string];
      const r = byKey(stopId, variant)!;
      expect(r.text.length, `${key} chars`).toBe(chars);
      expect(rundownWordCount(r.text), `${key} words`).toBe(words);
    }
  });

  it('word bounds: first-meet 80–130, returns 30–60, leg-2 50–75', () => {
    for (const r of allSoloRundowns()) {
      const w = rundownWordCount(r.text);
      if (r.variant === 'first') expect(w, r.stopId).toBeGreaterThanOrEqual(80), expect(w, r.stopId).toBeLessThanOrEqual(130);
      else if (r.variant === 'kingLeg2') expect(w).toBeGreaterThanOrEqual(50), expect(w).toBeLessThanOrEqual(75);
      else expect(w, `${r.stopId} ${r.variant}`).toBeGreaterThanOrEqual(30), expect(w, `${r.stopId} ${r.variant}`).toBeLessThanOrEqual(60);
    }
  });

  it('clip ids: the Porch first-meet is the spec’s worked example; all 34 are distinct', () => {
    expect(clipId(RUNDOWN_FIRST['porch']!)).toBe('872b0ad54292');
    const ids = allSoloRundowns().map((r) => clipId(r.text));
    expect(new Set(ids).size).toBe(34);
  });

  it('the solo set never collides with the co-op pair set (different scripts, different keys)', () => {
    const pairTexts = new Set([
      ...Object.values(PAIR_FIRST_RUNDOWNS), ...Object.values(PAIR_AWARENESS_RUNDOWNS),
      ...Object.values(PAIR_RETURN_LOSS_RUNDOWNS), ...Object.values(PAIR_RETURN_CLEAR_RUNDOWNS),
    ]);
    for (const r of allSoloRundowns()) expect(pairTexts.has(r.text)).toBe(false);
  });
});

describe('rundownFor — the fact-keyed selector (spec §3)', () => {
  const stop = (id: string) => storyStopById(id)!;

  it('first meet: no attempts, not cleared, at every stop', () => {
    for (const s of STORY_STOPS) {
      const r = rundownFor(s, { attempts: 0, cleared: false })!;
      expect(r.variant, s.id).toBe('first');
      expect(r.text).toBe(RUNDOWN_FIRST[s.id]);
      expect(r.stopId).toBe(s.id);
    }
  });

  it('return after a loss: attempts ≥ 1 and not cleared (attempt 2 and the grind alike)', () => {
    for (const s of STORY_STOPS) {
      expect(rundownFor(s, { attempts: 1, cleared: false })!.variant, s.id).toBe('returnLoss');
      expect(rundownFor(s, { attempts: 4, cleared: false })!.text, s.id).toBe(RUNDOWN_RETURN_LOSS[s.id]);
    }
  });

  it('return after a clear: cleared beats attempts', () => {
    for (const s of STORY_STOPS) {
      expect(rundownFor(s, { attempts: 0, cleared: true })!.variant, s.id).toBe('returnClear');
      expect(rundownFor(s, { attempts: 3, cleared: true })!.text, s.id).toBe(RUNDOWN_RETURN_CLEAR[s.id]);
    }
  });

  it('King leg 2: doublePending at the King outranks every other variant', () => {
    const king = stop('king');
    expect(rundownFor(king, { attempts: 0, cleared: false, doublePending: true }))
      .toEqual({ variant: 'kingLeg2', stopId: 'king', text: RUNDOWN_KING_LEG2 });
    expect(rundownFor(king, { attempts: 2, cleared: false, doublePending: true })!.variant).toBe('kingLeg2');
    expect(rundownFor(king, { attempts: 1, cleared: true, doublePending: true })!.variant).toBe('kingLeg2');
    // …and without the double pending, the King selects like any stop.
    expect(rundownFor(king, { attempts: 0, cleared: false, doublePending: false })!.variant).toBe('first');
    expect(rundownFor(king, { attempts: 1, cleared: false })!.variant).toBe('returnLoss');
  });

  it('doublePending means nothing away from the King', () => {
    const porch = stop('porch');
    expect(rundownFor(porch, { attempts: 0, cleared: false, doublePending: true })!.variant).toBe('first');
    expect(rundownFor(porch, { attempts: 1, cleared: false, doublePending: true })!.variant).toBe('returnLoss');
  });
});

describe('the scripts’ standing rules', () => {
  it('Church Basement scripts (all three variants) are profanity-free', () => {
    for (const variant of ['first', 'returnLoss', 'returnClear'] as const) {
      expect(byKey('church-basement', variant)!.text, variant).not.toMatch(/damn|hell|shit|ass/i);
    }
  });

  it('no script spoils a find: no egg id, name, tale, hint, or beat line appears in any rundown', () => {
    const scripts = allSoloRundowns().map((r) => r.text);
    for (const secret of Object.values(STORY_SECRETS)) {
      const guarded = [secret.egg.id, secret.egg.name, secret.egg.tale, secret.egg.hint, ...(secret.egg.beat ?? []).map((b) => b.line)];
      for (const g of guarded) for (const s of scripts) expect(s.includes(g), `${secret.egg.id}: ${g.slice(0, 40)}`).toBe(false);
    }
  });
});

describe('the corpus dump registration (spec §7.3)', () => {
  it('the rundown family enumerates exactly the 34, all under speaker dee', () => {
    const fam = storyCorpus().filter((c) => c.source.startsWith('rundown:'));
    expect(fam).toHaveLength(34);
    expect(fam.every((c) => c.speaker === 'dee')).toBe(true);
    expect(new Set(fam.map((c) => c.line))).toEqual(new Set(allSoloRundowns().map((r) => r.text)));
    for (const r of allSoloRundowns()) {
      expect(fam.some((c) => c.source === `rundown:${r.variant}:${r.stopId}` && c.line === r.text), `${r.variant}:${r.stopId}`).toBe(true);
    }
  });
});
