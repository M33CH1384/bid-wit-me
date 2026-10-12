import { describe, expect, it } from 'vitest';
import { ranksEmptyLine, ranksFilterSummary, siteGamesToday } from '../src/social/Compete';

describe('ranks copy', () => {
  it('summarises the active filters in one line', () => {
    expect(ranksFilterSummary('rating', 'global', 'week')).toBe('Rating · Global · This week');
    expect(ranksFilterSummary('wins', 'local', 'month')).toBe('Wins · Local · This month');
    expect(ranksFilterSummary('accuracy', 'global', 'all')).toBe('Bid accuracy · Global · All-time');
    expect(ranksFilterSummary('duos', 'local', 'week')).toBe('Best duos · Local · This week');
  });

  it('keeps the empty state to one sentence', () => {
    expect(ranksEmptyLine('rating', 'week', 'global')).toBe('No rating changes this week yet.');
    expect(ranksEmptyLine('rating', 'week', 'local')).toBe('No rating changes nearby this week yet.');
    expect(ranksEmptyLine('rating', 'month', 'global')).toBe('No rating changes this month yet.');
    expect(ranksEmptyLine('rating', 'all', 'global')).toBe('No rated players yet.');
    expect(ranksEmptyLine('wins', 'week', 'global')).toBe('No wins on this board yet.');
    expect(ranksEmptyLine('accuracy', 'week', 'local')).toBe('Not enough bids nearby for this board yet.');
    expect(ranksEmptyLine('duos', 'all', 'global')).toBe('No duos on this board yet.');
    for (const line of [
      ranksEmptyLine('rating', 'week', 'global'),
      ranksEmptyLine('duos', 'month', 'local'),
    ]) expect(line.endsWith('.')).toBe(true);
  });

  it('still formats the site-wide games line', () => {
    expect(siteGamesToday(1)).toBe('Site: 1 game today');
  });
});
