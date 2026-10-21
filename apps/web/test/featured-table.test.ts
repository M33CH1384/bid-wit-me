/** League P-G (Demetrius 2026-10-20): the Featured Table spotlight — highest
 *  combined REAL ratings from presence, Big Bank fallback, honest empty
 *  state. No table is ever scored with invented ratings. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpenTable, PresenceEntry } from '@spades/protocol';
import { pickFeaturedTable } from '../src/social/Compete';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const user = (name: string, code: string, rating: { team?: number; cutthroat?: number }, extra: Partial<PresenceEntry['status']> = {}): PresenceEntry => ({
  id: `u:${name}`, name, guest: false, rating,
  status: { kind: 'table', code, mode: 'joker', ...extra },
});
const table = (code: string, over: Partial<OpenTable> = {}): OpenTable => ({
  code, host: 'H', mode: 'joker', playerCount: 4, target: 500, venue: 'v', humans: 2, bots: 0, open: 1, status: 'playing', spectators: 0, ...over,
});

describe('pickFeaturedTable', () => {
  it('picks the table with the highest combined ratings (pool follows the mode)', () => {
    const users = [
      user('A', 'T1', { team: 1500 }), user('B', 'T1', { team: 1400 }),
      user('C', 'T2', { team: 1600 }), user('D', 'T2', { team: 900 }),
    ];
    const pick = pickFeaturedTable(users, { T1: table('T1'), T2: table('T2') });
    expect(pick?.code).toBe('T1');
    expect(pick?.combined).toBe(2900);
    expect(pick?.names).toEqual(['A', 'B']);
  });
  it('needs two rated players; offline and finished tables never qualify', () => {
    expect(pickFeaturedTable([user('A', 'T1', { team: 1500 })], { T1: table('T1') })).toBeNull();
    const offline = [user('A', 'T1', { team: 1500 }, { offline: true }), user('B', 'T1', { team: 1500 }, { offline: true })];
    expect(pickFeaturedTable(offline, { T1: table('T1') })).toBeNull();
    const done = [user('A', 'T1', { team: 1500 }), user('B', 'T1', { team: 1500 })];
    expect(pickFeaturedTable(done, { T1: table('T1', { status: 'over' }) })).toBeNull();
  });
  it('cutthroat tables draw on cutthroat ratings', () => {
    const users = [
      user('A', 'T1', { team: 2000, cutthroat: 1100 }, { mode: 'cutthroat' }),
      user('B', 'T1', { team: 2000, cutthroat: 1200 }, { mode: 'cutthroat' }),
    ];
    const pick = pickFeaturedTable(users, { T1: table('T1', { mode: 'cutthroat' }) });
    expect(pick?.combined).toBe(2300);
  });
});

describe('featured placement', () => {
  it('spotlight sits at the head of the leaderboard, with wager + empty fallbacks', () => {
    const c = read('../src/social/Compete.tsx');
    expect(c).toContain('data-testid="featured-table"');
    expect(c).toContain('data-testid="featured-join"');
    expect(c).toContain('data-testid="featured-watch"');
    expect(c).toContain('data-testid="featured-wager"');
    expect(c).toContain('data-testid="featured-empty"');
    expect(c).toContain('fetchWagerList()');
    expect(c).toContain('social.showChallenge(wager.id)');
  });
});
