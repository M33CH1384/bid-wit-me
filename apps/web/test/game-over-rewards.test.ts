import { describe, expect, it } from 'vitest';
import { computeRewards, type RewardsProfile } from '../src/GameOverRewards';

function profile(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return {
    level: { level: 8, xp: 1000, title: 'Prospect', xpForNext: 300, xpIntoLevel: 83 },
    coins: { balance: 1250 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
    ...over,
  };
}

describe('computeRewards', () => {
  it('computes xp, coin, and elo deltas', () => {
    const before = profile();
    const after = profile({
      level: { level: 8, xp: 1050, title: 'Prospect', xpForNext: 300, xpIntoLevel: 133 },
      coins: { balance: 1400 },
      rank: { team: { elo: 1012 }, cutthroat: { elo: 1000 } },
    });
    const d = computeRewards(before, after, { won: true, headline: 'VICTORY!', sub: '3 hands played', kind: 'team' });
    expect(d.signedIn).toBe(true);
    expect(d.xpGained).toBe(50);
    expect(d.coinsGained).toBe(150);
    expect(d.eloBefore).toBe(1000);
    expect(d.eloAfter).toBe(1012);
    expect(d.eloKindLabel).toBe('Partnership');
    expect(d.won).toBe(true);
  });

  it('detects newly unlocked achievements', () => {
    const before = profile({ achievements: [{ id: 'a1', title: 'First Win', xp: 50, coins: 25, unlockedAt: 100 }] });
    const after = profile({
      achievements: [
        { id: 'a1', title: 'First Win', xp: 50, coins: 25, unlockedAt: 100 },
        { id: 'a2', title: 'Sharpshooter', xp: 100, coins: 50, unlockedAt: 200 },
      ],
    });
    const d = computeRewards(before, after, { won: true, headline: 'VICTORY!', sub: '', kind: 'team' });
    expect(d.achievements).toHaveLength(1);
    expect(d.achievements[0]!.title).toBe('Sharpshooter');
  });

  it('detects newly claimed challenges', () => {
    const ch = (claimed: boolean) => ({ id: 'c1', title: 'Win 3', xp: 25, coins: 10, claimed, progress: 3, target: 3 });
    const before = profile({ challenges: { daily: [ch(false)], weekly: [] } });
    const after = profile({ challenges: { daily: [ch(true)], weekly: [] } });
    const d = computeRewards(before, after, { won: true, headline: 'VICTORY!', sub: '', kind: 'cutthroat' });
    expect(d.challenges).toHaveLength(1);
    expect(d.eloKindLabel).toBe('Cutthroat');
  });

  it('handles missing snapshots gracefully (signed out)', () => {
    const d = computeRewards(null, null, { won: false, headline: 'DEFEAT', sub: '', kind: 'team' });
    expect(d.signedIn).toBe(false);
    expect(d.xpGained).toBe(0);
    expect(d.achievements).toEqual([]);
  });

  it('never reports negative deltas', () => {
    const before = profile({ coins: { balance: 2000 } });
    const after = profile({ coins: { balance: 1500 } });
    const d = computeRewards(before, after, { won: false, headline: 'DEFEAT', sub: '', kind: 'team' });
    expect(d.coinsGained).toBe(0);
    expect(d.xpGained).toBe(0);
  });
});

describe('computeRewards level-bar before progress', () => {
  it('carries the pre-game bar progress from the before snapshot', () => {
    const before = profile();
    const after = profile({
      level: { level: 9, xp: 1150, title: 'Certified', xpForNext: 375, xpIntoLevel: 25 },
    });
    const d = computeRewards(before, after, { won: true, headline: 'VICTORY!', sub: '', kind: 'team' });
    expect(d.xpIntoLevelBefore).toBe(83);
    expect(d.xpForNextBefore).toBe(300);
    expect(d.levelBefore).toBe(8);
    expect(d.levelAfter).toBe(9);
  });

  it('defaults the before progress when snapshots are missing', () => {
    const d = computeRewards(null, null, { won: false, headline: 'DEFEAT', sub: '', kind: 'team' });
    expect(d.xpIntoLevelBefore).toBe(0);
    expect(d.xpForNextBefore).toBe(1);
  });
});
