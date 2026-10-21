/** League P-F (Demetrius 2026-10-20): rivalries from the h2h payload, season
 *  League Awards in the Achievements tab, and the all-time Record Book.
 *  Streak honors are deliberately absent — streaks are not stored data. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { topRivalry } from '../src/profile/ProfileView';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('topRivalry', () => {
  it('most games wins; ties go to the closest series', () => {
    const h = [
      { name: 'A', games: 10, wins: 9, losses: 1 },
      { name: 'B', games: 10, wins: 5, losses: 5 },
      { name: 'C', games: 4, wins: 2, losses: 2 },
    ];
    expect(topRivalry(h)?.name).toBe('B');
    expect(topRivalry([h[2]!])?.name).toBe('C');
    expect(topRivalry([])).toBeNull();
  });
});

describe('honors wiring', () => {
  it('server computes awards + records from stored stats only', () => {
    const honors = read('../../server/src/stats/honors.ts');
    expect(honors).toContain("id: string; label: string; userId: string");
    expect(honors).toContain("'Most wins this season'");
    expect(honors).toContain("'Highest rating ever'");
    expect(honors).not.toContain('Longest streak');
    expect(honors).not.toContain('bestStreak');
    expect(read('../../server/src/social/routes.ts')).toContain("a === 'honors' && req.method === 'GET'");
  });
  it('profile: rivalry strip in Stats, League awards in Achievements', () => {
    const pv = read('../src/profile/ProfileView.tsx');
    expect(pv).toContain('data-testid="profile-rivalry"');
    expect(pv).toContain('data-testid="league-awards"');
    expect(pv).toContain("fetch('/api/social/honors'");
  });
  it('league surface: Record Book section under Power Rankings', () => {
    const c = read('../src/social/Compete.tsx');
    expect(c).toContain('data-testid="record-book"');
    expect(c).toContain('<RecordBook onOpen=');
    expect(c).toContain("get('/api/social/honors')");
  });
});
