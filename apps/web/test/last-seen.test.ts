/**
 * Last online in the Friends view (owner, 2026-10-21): "Can't the friend view
 * show when my friends were last online?" Pins the relative label family and
 * the Social.tsx wiring — an offline friend WITH a stamp renders
 * "Last online …", an online friend keeps the presence status line untouched,
 * and a friend with no stamp keeps the plain existing "Offline" (nothing
 * extra, and no placeholder like "Unknown" anywhere).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lastOnlineLabel } from '../src/social/presence';

const now = 1_800_000_000_000;
const MIN = 60_000, H = 3_600_000, D = 86_400_000;

describe('lastOnlineLabel', () => {
  it('under a minute is "just now"', () => {
    expect(lastOnlineLabel(now, now)).toBe('just now');
    expect(lastOnlineLabel(now - 30_000, now)).toBe('just now');
  });
  it('minutes and hours carry "ago"', () => {
    expect(lastOnlineLabel(now - 12 * MIN, now)).toBe('12m ago');
    expect(lastOnlineLabel(now - 59 * MIN, now)).toBe('59m ago');
    expect(lastOnlineLabel(now - 3 * H, now)).toBe('3h ago');
    expect(lastOnlineLabel(now - 23 * H, now)).toBe('23h ago');
  });
  it('days up to ~30, then an absolute short date', () => {
    expect(lastOnlineLabel(now - 2 * D, now)).toBe('2d ago');
    expect(lastOnlineLabel(now - 29 * D, now)).toBe('29d ago');
    const old = lastOnlineLabel(now - 45 * D, now);
    expect(old).not.toContain('ago');
    expect(old).toBe(new Date(now - 45 * D).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  });
  it('a stamp in the future (clock skew) reads as "just now", never negative', () => {
    expect(lastOnlineLabel(now + 5 * MIN, now)).toBe('just now');
  });
});

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/social/store.ts', import.meta.url), 'utf8');
const presence = readFileSync(new URL('../src/social/presence.ts', import.meta.url), 'utf8');

describe('friends view wiring', () => {
  // Friend-activity presence (2026-10-22) moved the row's composition into
  // friendPresenceView (./presence): the "Last online …" fallback is its
  // last resort, below the live status and the fresh persisted activity —
  // the behavior matrix is pinned in friend-presence.test.ts.
  it('an offline friend with a stamp renders "Last online …" as the row’s secondary line', () => {
    expect(presence).toContain('`Last online ${lastOnlineLabel(seenAt, now)}`');
    expect(social).toContain('friendPresenceView(r, s.users[r.id], s.lastAt[r.id] ?? 0, modeName)');
  });
  it('the freshest stamp wins: the server ref stamp vs this session’s last activity vs the stale presence row', () => {
    expect(presence).toContain('Math.max(ref.lastSeen ?? 0, sessionLastAt, p?.at ?? 0)');
    expect(store).toContain('lastAt[u.id] = Math.max(lastAt[u.id] ?? 0, u.at)');
    // 'gone' removes the row from users but must not erase the remembered activity
    expect(store).toContain('for (const g of m.gone ?? []) delete users[g];');
    expect(store).not.toContain('delete lastAt[g]');
  });
  it('an online friend keeps a presence line with the online dot (now the activity label)', () => {
    expect(social).toContain('{pv.online && <i className="soc-online" title="Online" />}{r.name}<small>{pv.label}</small>');
  });
  it('no stamp → the plain existing Offline label; no "Unknown"-style placeholder anywhere', () => {
    expect(presence).toContain(": 'Offline'");
    expect(social + presence).not.toContain('Unknown');
  });
});
