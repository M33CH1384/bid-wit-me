import { describe, expect, it } from 'vitest';
import { metricText, ranksEmptyLine, ranksFilterSummary, siteGamesToday, trendDir } from '../src/social/Compete';

describe('ranks copy', () => {
  it('summarises the active filters in one line', () => {
    expect(ranksFilterSummary('rating', 'global', 'week')).toBe('Rating · Global · This week');
    expect(ranksFilterSummary('wins', 'local', 'month')).toBe('Wins · Local · This month');
    expect(ranksFilterSummary('accuracy', 'global', 'all')).toBe('Bid accuracy · Global · All-time');
    expect(ranksFilterSummary('duos', 'local', 'week')).toBe('Best duos · Local · This week');
    expect(ranksFilterSummary('pace', 'global', 'week')).toBe('Fastest climbers · Global · This week');
  });

  it('keeps the empty state to one sentence', () => {
    expect(ranksEmptyLine('rating', 'week', 'global')).toBe('No rating changes this week yet.');
    expect(ranksEmptyLine('rating', 'week', 'local')).toBe('No rating changes nearby this week yet.');
    expect(ranksEmptyLine('rating', 'month', 'global')).toBe('No rating changes this month yet.');
    expect(ranksEmptyLine('rating', 'all', 'global')).toBe('No rated players yet.');
    expect(ranksEmptyLine('wins', 'week', 'global')).toBe('No wins on this board yet.');
    expect(ranksEmptyLine('accuracy', 'week', 'local')).toBe('Not enough bids nearby for this board yet.');
    expect(ranksEmptyLine('duos', 'all', 'global')).toBe('No duos on this board yet.');
    expect(ranksEmptyLine('pace', 'week', 'global')).toBe('No one has 5 games this week yet — Fastest Climbers opens at 5 games.');
    expect(ranksEmptyLine('pace', 'month', 'local')).toBe('No one has 5 games nearby this month yet — Fastest Climbers opens at 5 games.');
    expect(ranksEmptyLine('pace', 'all', 'global')).toBe('No one has 5 games yet — Fastest Climbers opens at 5 games.');
    for (const line of [
      ranksEmptyLine('rating', 'week', 'global'),
      ranksEmptyLine('duos', 'month', 'local'),
    ]) expect(line.endsWith('.')).toBe(true);
  });

  it('still formats the site-wide games line', () => {
    expect(siteGamesToday(1)).toBe('Site: 1 game today');
  });
});

describe('Fastest Climbers row rendering (pace board)', () => {
  const row = (o: Partial<{ value: number; trend: number }>) => ({ rank: 1, id: 'u:x', name: 'X', value: 0, games: 5, ...o });
  it('the arrow follows the server trend: up / down / flat, missing trend is flat', () => {
    expect(trendDir('pace', 'week', row({ trend: 135 }))).toBe('up');
    expect(trendDir('pace', 'month', row({ trend: -40 }))).toBe('down');
    expect(trendDir('pace', 'all', row({ trend: 0 }))).toBe('flat');
    expect(trendDir('pace', 'week', row({}))).toBe('flat');
  });
  it('other boards keep their arrow rules (rating period-only, the rest flat)', () => {
    expect(trendDir('rating', 'week', row({ value: 12 }))).toBe('up');
    expect(trendDir('rating', 'all', row({ value: 12 }))).toBe('flat');
    expect(trendDir('wins', 'week', row({ value: 12, trend: 99 }))).toBe('flat');
  });
  it('the pace value is the window XP, thousands-grouped', () => {
    expect(metricText('pace', 'week', row({ value: 267 }))).toBe('267');
    expect(metricText('pace', 'all', row({ value: 12345 }))).toBe('12,345');
  });
});
