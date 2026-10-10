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
