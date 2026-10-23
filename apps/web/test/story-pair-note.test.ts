import { describe, expect, it } from 'vitest';
import { coopPairNote } from '../src/story/pairNote';

/**
 * Story co-op versus headline (2026-10-23): the pair's own facts at the
 * stop, in story register — attempts/clears the server recorded for THIS
 * pair, nothing else. Absent facts = no line.
 */
describe('coop pair note: narrative facts only, from the pair’s real record at the stop', () => {
  it('no pair facts, no line', () => {
    expect(coopPairNote('The Rooftop', null)).toBeNull();
    expect(coopPairNote('The Rooftop', undefined)).toBeNull();
  });
  it('a first run together says so', () => {
    expect(coopPairNote('The Rooftop', { attempts: 0, clears: 0 })).toBe('Your first run at The Rooftop together.');
  });
  it('uncleared attempts count up honestly (attempts are completed runs; this one is next)', () => {
    expect(coopPairNote('The Rooftop', { attempts: 2, clears: 0 })).toBe('Attempt 3 together at The Rooftop — still hunting the clear.');
  });
  it('a cleared stop is held, in the pair’s name', () => {
    expect(coopPairNote('The Porch', { attempts: 3, clears: 2 })).toBe('You two hold this table — cleared 2× together. Here you go again.');
  });
  it('a standing double outranks the rest — it is the live fact of the run', () => {
    expect(coopPairNote('King of the Block', { attempts: 1, clears: 0, doublePending: true }))
      .toBe('The double is live — one more win together takes the crown.');
  });
});
