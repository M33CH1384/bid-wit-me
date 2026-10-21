import { describe, expect, it } from 'vitest';
import { CC_BY_LINE, CC_BY_LINES, TRACKS, generalPool, nextShuffle } from '../src/audio';

describe('music playlist', () => {
  it('shuffles every track once per round with no immediate repeats, across many rounds', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let prev: number | null = null, bag: number[] = [];
    const seq: number[] = [];
    for (let i = 0; i < TRACKS.length * 200; i++) {
      const r = nextShuffle(prev, bag, TRACKS.length, rnd);
      seq.push(r.pick); bag = r.bag; prev = r.pick;
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    for (let k = 0; k < 200; k++) expect(new Set(seq.slice(k * TRACKS.length, (k + 1) * TRACKS.length)).size).toBe(TRACKS.length);
  });
  it('has the 18 approved tracks (5 originals first) and the exact CC-BY attribution', () => {
    expect(TRACKS.map((t) => t.title).slice(0, 5)).toEqual(['Windows Down', 'Coins', 'Final Level', '2 Hour Delay', 'Chillin Hard']);
    expect(TRACKS.filter((t) => !t.storyOnly).length).toBe(18);
    expect(CC_BY_LINE).toBe('"Chillin Hard" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/');
  });
  it('the story score rides along as original, story-only tracks — never in the general pool, never CC-BY', () => {
    expect(TRACKS.length).toBe(22);
    const story = TRACKS.filter((t) => t.storyOnly);
    expect(story.map((t) => t.file)).toEqual(['story-theme', 'story-theme-sparse', 'story-danger', 'story-king']);
    for (const t of story) { expect(t.license).toBe('Original'); expect(t.credit).toBeUndefined(); }
    expect(CC_BY_LINES.length).toBe(11);
    const pool = generalPool();
    expect(pool.length).toBe(18);
    for (const i of pool) expect(TRACKS[i]!.storyOnly).toBeFalsy();
  });
});
