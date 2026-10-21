/** League P-E (Demetrius 2026-10-20): weekly Power Rankings — ISO week keys,
 *  the documented power formula, snapshot wiring, and the client block +
 *  ticker line. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isoWeekKey, powerScore, prevWeekKey } from '../../server/src/stats/power';
import { buildTickerLines } from '../src/social/Compete';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('isoWeekKey / powerScore', () => {
  it('ISO week keys: 2026-10-20 is week 43; year edges behave', () => {
    expect(isoWeekKey(Date.UTC(2026, 9, 20))).toBe('2026-W43');
    expect(isoWeekKey(Date.UTC(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeekKey(Date.UTC(2025, 11, 29))).toBe('2026-W01');
    expect(prevWeekKey(Date.UTC(2026, 9, 20))).toBe('2026-W42');
  });
  it('power = rating + 2 × (win% − 50); idle players are neutral', () => {
    expect(powerScore(1200, 0, 0)).toBe(1200);
    expect(powerScore(1200, 7, 10)).toBe(1240);
    expect(powerScore(1200, 3, 10)).toBe(1160);
    expect(powerScore(1200, 10, 10)).toBe(1300);
  });
});

describe('power wiring', () => {
  it('migration 0019 + snapshot-on-first-leaderboard-read + /api/social/power', () => {
    expect(read('../../server/migrations/0019_power_snapshots.sql')).toContain('league_power_snapshots');
    const routes = read('../../server/src/social/routes.ts');
    expect(routes).toContain("a === 'power' && req.method === 'GET'");
    expect(routes).toContain('ensurePowerSnapshot(db, now)');
  });
  it('client block renders movement and feeds the ticker', () => {
    const c = read('../src/social/Compete.tsx');
    expect(c).toContain('data-testid="power-rankings"');
    expect(c).toContain('First week — no movement yet');
    expect(buildTickerLines({ kind: 'team', top: [], online: [], mine: null, power: [{ name: 'Ace', power: 1310 }] }))
      .toEqual(['Power Rankings — #1 Ace (1310)']);
  });
});
