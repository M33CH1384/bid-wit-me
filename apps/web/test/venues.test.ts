import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseClientMsg, rollVenue, VENUES } from '@spades/protocol';
import { VENUE_DEFS, VENUE_LIST, resolveVenue, venueAssetUrls, venueLabel } from '../src/venues';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';

const pub = resolve(__dirname, '../public');

describe('venues', () => {
  it('ten venues plus the classic table, each fully described', () => {
    expect(VENUES.length).toBe(11);
    expect(VENUE_LIST.filter((v) => v.id !== 'classic').length).toBeGreaterThanOrEqual(10);
    for (const v of VENUE_LIST) {
      expect(v.name.length).toBeGreaterThan(2);
      expect(v.felt).toMatch(/^#[0-9a-f]{6}$/i);
      if (v.id !== 'classic') expect(v.bed).not.toBe('none');
    }
  });
  it('every venue ships small, lazy assets (backdrop ≤ 120 KB, env ≤ 130 KB, textures ≤ 90 KB)', () => {
    for (const v of VENUES) {
      for (const q of ['high', 'low'] as const) {
        const u = venueAssetUrls(v, q);
        if (v === 'classic') { expect(u.bg).toBeNull(); continue; }
        const files = [u.bg, u.env, u.floor, u.rail].filter((x): x is string => !!x);
        if (q === 'low') expect(u.env).toBeNull(); // no HDRI on Low
        for (const f of files) {
          const p = `${pub}${f}`;
          expect(existsSync(p), f).toBe(true);
          const kb = statSync(p).size / 1024;
          expect(kb, f).toBeLessThan(f.endsWith('.hdr') ? 130 : f.includes('/tex/') ? 90 : 120);
        }
      }
    }
  });
  it('Random never lands on classic, avoids the last venue, and offline Random is stable per seed', () => {
    for (let i = 0; i < 200; i++) {
      const r = i / 200;
      expect(rollVenue(r)).not.toBe('classic');
      expect(rollVenue(r, 'beach')).not.toBe('beach');
    }
    expect(resolveVenue('random', 0.42)).toBe(resolveVenue('random', 0.42));
    expect(resolveVenue('yacht')).toBe('yacht');
    expect(resolveVenue(undefined)).toBe('classic');
    expect(venueLabel('random')).toMatch(/Random/);
    expect(venueLabel('barbershop')).toBe(`${VENUE_DEFS.barbershop.emoji} Barbershop`);
  });
  it('settings default to the classic table and drop unknown venues', () => {
    expect(DEFAULT_SETTINGS.venue).toBe('classic');
    expect(normalizeSettings({ venue: 'random' } as never).venue).toBe('random');
    expect(normalizeSettings({ venue: 'moon' } as never).venue).toBe('classic');
    expect(normalizeSettings({}).venue).toBe('classic');
  });
  it('protocol: venue message validated', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'venue', venue: 'vegas' }))).toEqual({ t: 'venue', venue: 'vegas' });
    expect(parseClientMsg(JSON.stringify({ t: 'venue', venue: 'random' }))).toEqual({ t: 'venue', venue: 'random' });
    expect(parseClientMsg(JSON.stringify({ t: 'venue', venue: 'mars' }))).toBeNull();
  });
});
