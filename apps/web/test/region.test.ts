/** League P-B (Demetrius 2026-10-20): self-declared Region — migration,
 *  cleaning, the POST route, profile payloads, and the Regions leaderboard
 *  scope incl. its place in the rotation. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanRegion, REGION_MAX } from '../../server/src/cred/region';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const mig = () => read('../../server/migrations/0018_region.sql');
const credRoutes = () => read('../../server/src/cred/routes.ts');
const socialRoutes = () => read('../../server/src/social/routes.ts');
const boards = () => read('../../server/src/stats/boards.ts');
const profileView = () => read('../src/profile/ProfileView.tsx');
const compete = () => read('../src/social/Compete.tsx');

describe('cleanRegion', () => {
  it('keeps a plain region, trimmed and whitespace-collapsed', () => {
    expect(cleanRegion('  Harlem  ')).toEqual({ ok: true, region: 'Harlem' });
    expect(cleanRegion('South   Bronx')).toEqual({ ok: true, region: 'South Bronx' });
  });
  it('blank clears (null); non-strings are rejected', () => {
    expect(cleanRegion('   ')).toEqual({ ok: true, region: null });
    expect(cleanRegion('')).toEqual({ ok: true, region: null });
    expect(cleanRegion(42).ok).toBe(false);
    expect(cleanRegion(undefined).ok).toBe(false);
  });
  it('caps at REGION_MAX like the tagline cap pattern', () => {
    expect(REGION_MAX).toBe(24);
    const r = cleanRegion('x'.repeat(60));
    expect(r.ok && r.region && r.region.length).toBe(24);
  });
});

describe('region wiring', () => {
  it('migration 0018 adds users.region', () => {
    expect(mig()).toContain('ALTER TABLE users ADD COLUMN region TEXT');
  });
  it('POST /api/profile/me/region mirrors the tagline route', () => {
    expect(credRoutes()).toContain("parts[3] === 'region' && req.method === 'POST'");
    expect(credRoutes()).toContain('UPDATE users SET region = ? WHERE id = ?');
    expect(credRoutes()).toContain('regionOf(db, userId)');
  });
  it('profile payloads carry region (social profile + cred /me)', () => {
    expect(socialRoutes()).toContain('region: string | null');
    expect(socialRoutes()).toContain('region: u.region');
    expect(credRoutes()).toContain('socialLinks: links, region');
  });
  it('the regions leaderboard scope filters on the declared region only', () => {
    expect(socialRoutes()).toContain("q.get('scope') === 'regions'");
    expect(socialRoutes()).toContain('Set your region on your profile to see your regional board.');
    expect(boards()).toContain('declaredRegion');
    expect(boards()).toContain("const decl = o.declaredRegion ? 'AND u.region = ?' : '';");
  });
  it('client: header shows "Region: X" plainly; editor lives in Edit profile', () => {
    const pv = profileView();
    expect(pv).toContain('data-testid="profile-region"');
    expect(pv).toContain('Region: {regionText}');
    expect(pv).toContain('data-testid="region-input"');
    expect(pv).toContain('data-testid="region-save"');
    expect(pv).toContain("'/api/profile/me/region'");
    expect(pv).toContain('maxLength={24}');
  });
  it('leaderboard: Regions scope exists, is server-backed, joins rotation only with a region', () => {
    const c = compete();
    expect(c).toContain("regions: 'Regions'");
    expect(c).toContain("scope === 'regions' ? 'regions' : 'global'");
    expect(c).toContain("myRegion ? [...ROTATION, 'regions'] : ROTATION");
    expect(c).toContain("['regions', 'Regions']");
  });
});
