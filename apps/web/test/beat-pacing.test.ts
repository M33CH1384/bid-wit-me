import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { beatStartOffsets } from '../src/story/beatPacing';

/**
 * Story beat pacing (defect fix, owner 2026-10-22: story lines "cut
 * short"). The Table story channel scheduled beat sequences on a fixed
 * stagger (base + ix · gap) while the lines' recorded clips run
 * 3.3–8.2 s against 1.4–1.7 s staggers; the voice engine only talks
 * over a playing line's tail (≤ 3 s left), so every later arrival
 * REPLACED the line mid-sentence. The scheduler now paces by each
 * line's real clip duration (spokenClipDurationMs — the same manifest
 * lookup ScriptPlayer paces its typewriter against): a beat starts
 * only after the previous beat's voice has finished, plus the gap.
 * A beat with no clip (text-only) occupies its legacy stagger slot.
 * These tests pin the arithmetic and the scheduler wiring with stubbed
 * durations; Table itself is pinned by source at the end.
 */
const durs = vi.hoisted(() => ({ map: new Map<string, number | null>(), calls: [] as string[] }));
vi.mock('../src/talkPrefs', () => ({
  spokenClipDurationMs: (name: string, line: string) => {
    durs.calls.push(`${name}|${line}`);
    return Promise.resolve(durs.map.get(`${name}|${line}`) ?? null);
  },
}));
import { scheduleStoryBeats } from '../src/story/beatPacing';

interface TB { speaker: string; line: string }
const beat = (speaker: string, line: string): TB => ({ speaker, line });
const names: Record<string, string> = { dee: 'Dee', pat: 'Pat', uncleRay: 'Uncle Ray', you: 'You' };
const nameOf = (bt: TB) => names[bt.speaker] ?? bt.speaker;

describe('beatStartOffsets: the pacing arithmetic', () => {
  it('the Porch signature case: 5015 / 7115 / 8190 ms lines at the old 1700 ms stagger no longer overlap-cut', () => {
    const offs = beatStartOffsets([5015, 7115, 8190], 1700);
    expect(offs).toEqual([0, 5015 + 1700, 5015 + 1700 + 7115 + 1700]);
    // every beat starts only after the previous line's voice has ended
    const d = [5015, 7115, 8190];
    for (let ix = 1; ix < offs.length; ix++) expect(offs[ix]! - offs[ix - 1]!).toBeGreaterThanOrEqual(d[ix - 1]!);
    // the legacy stagger it replaces started beat 1 at 1700 ms — 3.3 s into Dee's 5015 ms line
    expect(1700).toBeLessThan(d[0]!);
  });

  it('text-only beats fall back to exactly the legacy stagger', () => {
    expect(beatStartOffsets([null, null, null], 1500)).toEqual([0, 1500, 3000]);
    expect(beatStartOffsets([null, null], 1400)).toEqual([0, 1400]);
  });

  it('a silent beat inside a voiced sequence still holds its slot', () => {
    // voiced 5 s, then a text-only line, then a voiced 1 s line, gap 1 s:
    // starts 0 / 5000+gap / 6000 + the null beat's legacy slot (the gap itself)
    expect(beatStartOffsets([5000, null, 1000], 1000)).toEqual([0, 6000, 7000]);
  });

  it('degenerate sequences', () => {
    expect(beatStartOffsets([], 1500)).toEqual([]);
    expect(beatStartOffsets([3000], 1500)).toEqual([0]);
  });
});

describe('scheduleStoryBeats: durations drive the timers, text falls back', () => {
  it('a beat never fires before the previous line’s duration has elapsed (stubbed Porch durations)', async () => {
    durs.map.clear(); durs.calls = [];
    durs.map.set('Dee|dee line', 5015);
    durs.map.set('Pat|pat line', 7115);
    durs.map.set('Uncle Ray|ray line', 8190);
    const fired: { line: string; delay: number; ix: number }[] = [];
    const beats = [beat('dee', 'dee line'), beat('pat', 'pat line'), beat('uncleRay', 'ray line')];
    await scheduleStoryBeats(beats, { baseMs: 3400, gapMs: 1700, nameOf, audible: () => true },
      (bt, delay, ix) => fired.push({ line: bt.line, delay, ix }));
    expect(fired.map((f) => f.delay)).toEqual([3400, 3400 + 5015 + 1700, 3400 + 5015 + 1700 + 7115 + 1700]);
    expect(fired.map((f) => f.ix)).toEqual([0, 1, 2]); // caller's index survives for attribution
    const ds = [5015, 7115, 8190];
    for (let ix = 1; ix < fired.length; ix++) expect(fired[ix]!.delay - fired[ix - 1]!.delay).toBeGreaterThanOrEqual(ds[ix - 1]!);
  });

  it('when no beat has a clip, the delays are exactly the legacy stagger', async () => {
    durs.map.clear(); durs.calls = [];
    const fired: number[] = [];
    const beats = [beat('dee', 'a'), beat('pat', 'b'), beat('uncleRay', 'c')];
    await scheduleStoryBeats(beats, { baseMs: 700, gapMs: 1400, nameOf, audible: () => true },
      (_bt, delay) => fired.push(delay));
    expect(fired).toEqual([700, 700 + 1400, 700 + 2 * 1400]);
  });

  it('inaudible beats (the player’s own line, a muted seat) are never looked up and hold the legacy slot', async () => {
    durs.map.clear(); durs.calls = [];
    durs.map.set('Dee|dee line', 5000);
    durs.map.set('Pat|pat line', 1000);
    const fired: number[] = [];
    const beats = [beat('dee', 'dee line'), beat('you', 'your line'), beat('pat', 'pat line')];
    await scheduleStoryBeats(beats, {
      baseMs: 0, gapMs: 1000, nameOf,
      audible: (bt) => bt.speaker !== 'you',
    }, (_bt, delay) => fired.push(delay));
    expect(durs.calls).toEqual(['Dee|dee line', 'Pat|pat line']); // no lookup for 'you'
    expect(fired).toEqual([0, 5000 + 1000, 5000 + 1000 + 1000]); // Dee's duration + gap, then your silent slot
  });
});

describe('Table wiring (source pins)', () => {
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
  it('the story channel and the rail exchanges both schedule through the paced helper', () => {
    expect(table).toContain("import { scheduleStoryBeats } from './story/beatPacing';");
    expect(table.split('scheduleStoryBeats(').length - 1).toBeGreaterThanOrEqual(2); // deliver() + rail
  });
  it('no fixed-stagger story scheduling remains', () => {
    expect(table).not.toContain('baseMs + ix * gapMs');
    expect(table).not.toContain('baseDelay + ix * 1700');
  });
});
