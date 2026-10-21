/** Presence line dedupe (owner screenshot 2026-10-20): the profile header read
 *  "● Online — Online". Both surfaces that render the green-dot presence line —
 *  the Social profile and the in-game profile modal — used to join a hardcoded
 *  "Online" with statusLabel(), which returns "Online" itself for a plain
 *  online status. They now compose through the protocol's presenceLine(),
 *  which dedupes a detail that repeats the base (behavior pinned in
 *  packages/protocol/test/presence-line.test.ts). These source pins keep a
 *  future edit from re-joining the two labels by hand. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
// ONE PROFILE (2026-10-20): the Social profile IS the unified ProfileView now.
const profile = readFileSync(new URL('../src/profile/ProfileView.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/social/ProfileModal.tsx', import.meta.url), 'utf8');

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe('profile presence line: no "Online — Online"', () => {
  it('the unified profile composes its presence line via presenceLine()', () => {
    expect(count(profile, 'presenceLine(')).toBe(1);
    expect(profile).not.toContain('`Online — ${statusLabel');
  });

  it('profile modal composes its presence line via presenceLine()', () => {
    expect(count(modal, 'presenceLine(')).toBe(1);
    expect(modal).not.toContain('`Online — ${statusLabel');
  });

  it('neither surface hand-joins an "Online —" literal anymore', () => {
    expect(social).not.toContain('Online —');
    expect(profile).not.toContain('Online —');
    expect(modal).not.toContain('Online —');
  });
});
