/** Social profile picture wiring (regression, Demetrius 2026-10-20): the Social profile
 *  header rendered cred?.user.avatar, and cred was fetched with the SOCIAL pid
 *  ('u:<uid>') — /api/profile/:id wants the RAW account id, so every profile open except
 *  the global-chat name tap (which strips the prefix) 404'd the cred fetch and the header
 *  fell back to the initial letter, Rep and achievements vanishing with it. The CSS-only
 *  avatar tests could not see this. These source assertions pin the repaired wiring:
 *  normalize the pid before the fetch, and resolve the header picture through useAvatar
 *  (the same path chat faces use), seeded by the payloads.
 *
 *  ONE PROFILE (2026-10-20): the wiring now lives in the unified profile view
 *  (src/profile/ProfileView.tsx) — the one component both the Social panel and
 *  the /profile route render — so the pins read that file. The self-row and
 *  SocFace pins still read Social.tsx, where the player rows live. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/profile/ProfileView.tsx', import.meta.url), 'utf8');

describe('Unified profile avatar wiring', () => {
  it('normalizes the social pid to a raw account uid for the cred fetch', () => {
    expect(view).toContain('accountUidOf(pid)');
    expect(view).toContain('`/api/profile/${encodeURIComponent(uid)}`');
    expect(view).not.toContain('api/profile/${encodeURIComponent(pid)}');
  });
  it('the header picture comes from useAvatar, not from the cred payload alone', () => {
    expect(view).toContain('const pic = useAvatar(uid,');
    expect(view).toContain('<AvatarCircle pic={pic} name={displayName} className="soc-av big" />');
    expect(view).not.toContain('pic={cred?.user.avatar}');
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
    // exactly two useAvatar call sites serve the social/profile family: SocFace
    // for list faces (in Social.tsx) and the unified profile header (ProfileView)
    expect(social.split('useAvatar(').length - 1).toBe(1);
    expect(view).toContain('const pic = useAvatar(uid,');
  });
  it('uploading a photo forgets the cached avatar, exactly like removing one', () => {
    expect(view.split('forgetAvatar(cred.user.id)').length - 1).toBe(2);
    const post = view.indexOf("'/api/profile/me/avatar'");
    const forget = view.indexOf('forgetAvatar(cred.user.id)');
    expect(forget).toBeGreaterThan(post);
  });
});
