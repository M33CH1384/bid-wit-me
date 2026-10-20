/** Social profile picture wiring (regression, Demetrius 2026-10-20): the Social profile
 *  header rendered cred?.user.avatar, and cred was fetched with the SOCIAL pid
 *  ('u:<uid>') — /api/profile/:id wants the RAW account id, so every profile open except
 *  the global-chat name tap (which strips the prefix) 404'd the cred fetch and the header
 *  fell back to the initial letter, Rep and achievements vanishing with it. The CSS-only
 *  avatar tests could not see this. These source assertions pin the repaired wiring:
 *  normalize the pid before the fetch, and resolve the header picture through useAvatar
 *  (the same path chat faces use), seeded by the payloads. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');

describe('Social profile avatar wiring', () => {
  it('normalizes the social pid to a raw account uid for the cred fetch', () => {
    expect(social).toContain('accountUidOf(pid)');
    expect(social).toContain('fetch(`/api/profile/${encodeURIComponent(uid)}`');
    expect(social).not.toContain('fetch(`/api/profile/${encodeURIComponent(pid)}`');
  });
  it('the header picture comes from useAvatar, not from the cred payload alone', () => {
    expect(social).toContain('const pic = useAvatar(uid,');
    expect(social).toContain('<AvatarCircle pic={pic} name={p.username} className="soc-av big" />');
    expect(social).not.toContain('pic={cred?.user.avatar}');
  });
});
