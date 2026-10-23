import { describe, expect, it } from 'vitest';
import { TIP_EVERY, TIP_LABEL, TIP_URL, tipNudgeDue } from '../src/support';
import { versionLine } from '../src/version';
import { describeContext } from '../src/feedbackContext';

describe('tip jar', () => {
  it('is configured for Cash App', () => {
    expect(TIP_URL).toBe('https://cash.app/$m33ch84');
    expect(TIP_LABEL).toBe('Tip the devs (Cash App)');
  });
  it('victory nudge: never game 1, at most once every few games, never after "Don\'t show again", hidden without a URL', () => {
    expect(tipNudgeDue({ games: 1, shownAt: -99, never: false })).toBe(false);
    expect(tipNudgeDue({ games: 2, shownAt: -99, never: false })).toBe(true);
    expect(tipNudgeDue({ games: 3, shownAt: 2, never: false })).toBe(false);
    expect(tipNudgeDue({ games: 2 + TIP_EVERY, shownAt: 2, never: false })).toBe(true);
    expect(tipNudgeDue({ games: 9, shownAt: -99, never: true })).toBe(false);
    expect(tipNudgeDue({ games: 9, shownAt: -99, never: false }, '')).toBe(false);
  });
});

describe('version + feedback context', () => {
  it('version line', () => {
    expect(versionLine({ version: '0.3.0', sha: 'abc1234', date: '2026-10-10', channel: 'beta' })).toBe('v0.3.0 beta · abc1234 · 2026-10-10');
  });
  it('describes what is sent', () => {
    const lines = describeContext({ version: 'v0.3.0 beta', platform: 'iPhone', touch: true, viewport: '390x664 @3x', browser: 'Safari', table: 'ABCDE', game: { mode: 'joker', hand: 3 } });
    expect(lines.join('\n')).toMatch(/Online table: ABCDE/);
    expect(lines.join('\n')).toMatch(/Game: mode joker · hand 3/);
  });
});

import { existsSync } from 'node:fs';
import { CC_BY_LINES, TRACKS } from '../src/audio';
describe('music playlist', () => {
  it('24 tracks, every file present, every CC BY track carries its attribution line', () => {
    expect(TRACKS.length).toBe(24);
    expect(new Set(TRACKS.map((t) => t.file)).size).toBe(24);
    for (const t of TRACKS) expect(existsSync(new URL(`../public/audio/music/${t.file}.mp3`, import.meta.url))).toBe(true);
    for (const t of TRACKS.filter((x) => x.license.startsWith('CC BY'))) expect(t.credit).toBeTruthy();
    expect(CC_BY_LINES.length).toBe(11);
  });
});
