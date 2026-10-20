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
const page = readFileSync(new URL('../src/profile/ProfilePage.tsx', import.meta.url), 'utf8');

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

/** Self-row avatar (owner report 2026-10-20): the "(you)" row in the Players
 *  list showed his initial while his profile showed the photo. The row was
 *  never special — it resolves through the same SocFace → useAvatar →
 *  loadAvatar path as every friend/DM/chat face — but his device had cached
 *  "no picture" for his uid before he uploaded, and the upload never
 *  invalidated that cache. Pins: (1) the row keeps using the shared SocFace
 *  path with no self-only avatar branch, (2) uploading a photo drops the
 *  cached entry exactly like removing one does (the null-expiry behavior
 *  itself is pinned in avatar-cache.test.ts). */
describe('self row avatar resolution', () => {
  const rowStart = social.indexOf('function PlayerRow(');
  const row = social.slice(rowStart, social.indexOf('\nfunction ', rowStart + 10));
  it('the Players row face is the shared SocFace on the presence id — no self branch', () => {
    expect(row).toContain('<SocFace id={u.id} name={u.name}');
    expect(row).not.toContain('useAvatar');
    expect(row).not.toContain('AvatarCircle');
  });
  it('SocFace is the one resolution path for list faces (social id → account uid)', () => {
    const face = social.slice(social.indexOf('function SocFace('), social.indexOf('function PlayerRow('));
    expect(face).toContain('useAvatar(socialUidOf(id))');
    expect(social.split('useAvatar(').length - 1).toBe(2); // SocFace + the seeded profile header only
  });
  it('uploading a photo forgets the cached avatar, exactly like removing one', () => {
    expect(page.split('forgetAvatar(profile.user.id)').length - 1).toBe(2);
    const post = page.indexOf("method: 'POST'");
    const forget = page.indexOf('forgetAvatar(profile.user.id)');
    expect(forget).toBeGreaterThan(post);
  });
});
