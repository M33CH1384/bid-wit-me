/**
 * Story co-op invites ride the existing invite plumbing with kind + stopId
 * (spec §1.2): the parse round-trips them in both directions and ignores
 * any other kind string (a story kind is one exact value, never free text).
 */
import { describe, expect, it } from 'vitest';
import { parseSocialMsg } from '../src/social';

describe('story-coop invite wire', () => {
  it('client→hub: invite keeps kind + stopId', () => {
    expect(parseSocialMsg({ t: 'invite', to: 'u:abc', code: 'ABCDE', kind: 'story-coop', stopId: 'porch' }))
      .toEqual({ t: 'invite', to: 'u:abc', code: 'ABCDE', kind: 'story-coop', stopId: 'porch' });
  });

  // hub→client delivery has no parser (the hub constructs typed SocialServerMsg
  // objects directly) — its kind/stopId pass-through is pinned at the hub in
  // apps/server/test/social.test.ts ("story-coop invites carry kind + stopId").

  it('unknown kinds are dropped, never forwarded', () => {
    const m = parseSocialMsg({ t: 'invite', to: 'u:abc', code: 'ABCDE', kind: 'party', stopId: 'x' }) as { kind?: string } | null;
    expect(m?.kind).toBeUndefined();
  });

  it('regular invites are unchanged', () => {
    expect(parseSocialMsg({ t: 'invite', to: 'u:abc', code: 'ABCDE', mode: 'joker', seat: 2 }))
      .toEqual({ t: 'invite', to: 'u:abc', code: 'ABCDE', mode: 'joker', seat: 2 });
  });
});
