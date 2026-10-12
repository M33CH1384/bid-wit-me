import { describe, expect, it } from 'vitest';
import { siteGamesToday } from '../src/social/Compete';

describe('site games header', () => {
  it('labels the server-wide count as the site, not a personal total', () => {
    expect(siteGamesToday(1)).toBe('Site: 1 game today');
    expect(siteGamesToday(0)).toBe('Site: 0 games today');
    expect(siteGamesToday(12)).toBe('Site: 12 games today');
  });
});
