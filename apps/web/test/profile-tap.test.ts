/** Tappable profile pictures (Demetrius 2026-10-20): every player's picture in the app
 *  opens their profile — the Social panel view away from a game, a solid modal over the
 *  table during one. These tests pin the pure decision logic (who has a profile, which
 *  presentation), the table-modal store, and the wiring at the key surfaces, so a face
 *  can't silently go back to being a dead picture. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  closeTableProfile, getTableProfileTarget, openTableProfile,
  profileModeFor, profileTargetOf,
} from '../src/profileTap';

describe('profileTargetOf — who has an openable profile', () => {
  it('resolves a social pid to the canonical pid + raw uid', () => {
    expect(profileTargetOf({ id: 'u:abc123', name: 'LovleyT714' })).toEqual({ name: 'LovleyT714', pid: 'u:abc123', uid: 'abc123' });
  });
  it('accepts a raw account id (table seats carry uids, not pids)', () => {
    expect(profileTargetOf({ id: 'abc123', name: 'LovleyT714' })).toEqual({ name: 'LovleyT714', pid: 'u:abc123', uid: 'abc123' });
  });
  it('bots have no profile', () => {
    expect(profileTargetOf({ id: 'u:abc123', name: 'Bot', bot: true })).toBeNull();
    expect(profileTargetOf({ id: undefined, name: 'Bot', bot: true })).toBeNull();
  });
  it('guests have no profile (g: ids, missing ids)', () => {
    expect(profileTargetOf({ id: 'g:xyz', name: 'Guest 4' })).toBeNull();
    expect(profileTargetOf({ id: undefined, name: 'Guest 4' })).toBeNull();
    expect(profileTargetOf({ id: null, name: 'Guest 4' })).toBeNull();
    expect(profileTargetOf({ id: '', name: 'Guest 4' })).toBeNull();
  });
  it('a name is required (the profile record is fetched by name)', () => {
    expect(profileTargetOf({ id: 'u:abc123', name: '' })).toBeNull();
    expect(profileTargetOf({ id: 'u:abc123', name: '   ' })).toBeNull();
  });
});

describe('profileModeFor — panel page vs over-table modal', () => {
  it('an explicit atTable wins over the mounted-table flag', () => {
    expect(profileModeFor(true, false)).toBe('modal');
    expect(profileModeFor(false, true)).toBe('page');
  });
  it('otherwise the mounted table decides', () => {
    expect(profileModeFor(undefined, true)).toBe('modal');
    expect(profileModeFor(undefined, false)).toBe('page');
  });
});

describe('the table-modal store', () => {
  it('opens, reads and closes', () => {
    closeTableProfile();
    expect(getTableProfileTarget()).toBeNull();
    const t = profileTargetOf({ id: 'u:abc123', name: 'LovleyT714' })!;
    openTableProfile(t);
    expect(getTableProfileTarget()).toEqual(t);
    closeTableProfile();
    expect(getTableProfileTarget()).toBeNull();
  });
});

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const avatar = read('../src/avatar.tsx');
const social = read('../src/social/Social.tsx');
const table = read('../src/Table.tsx');
const modal = read('../src/social/ProfileModal.tsx');
const lobby = read('../src/online/Lobby.tsx');
const media = read('../src/online/Media.tsx');
const socialCss = read('../src/social/social.css');
const stylesCss = read('../src/styles.css');

describe('surface wiring (source pins)', () => {
  it('AvatarCircle renders a real button when given onTap', () => {
    expect(avatar).toContain('onTap?: () => void');
    expect(avatar).toContain('className={`avatar-tap ');
    expect(avatar).toContain("aria-label={`View ${name}'s profile`}");
  });
  it('social faces open profiles through the one helper', () => {
    expect(social).toContain('const target = tap ? profileTargetOf({ id, name }) : null;');
    expect(social).toContain('onTap={target ? () => openPlayerProfile({ id, name }) : undefined}');
    // the DM header face sits inside the profile-opening name button: no nested button
    expect(social).toContain('<SocFace id={pid} name={name} className="soc-av dm-head" tap={false} />');
    // DM thread rows are divs now, so the face button inside them is valid;
    // non-friend (legacy) threads render the same row dimmed via the template class
    expect(social).toContain('className={`soc-thread${r.friend ? \'\' : \' legacy\'}`} role="button"');
  });
  it('table plates: human seat faces + the viewer plate are tappable, and the modal is mounted in the screen', () => {
    expect(table).toContain('data-testid={`plate-profile-${seat}`}');
    expect(table).toContain('data-testid="plate-profile-0"');
    expect(table).toContain('<TableProfileModal />');
    expect(table).toContain('setTableProfileHost(true)');
    // the modal counts as a modal for the table's dim/blur state…
    expect(table).toContain('|| !!profileTarget');
    // …and bot seats never resolve a profile tap
    expect(table).toContain('bot: isBotSeat(seat)');
  });
  it('the modal dismisses on backdrop tap and Esc, and its card is solid (no glass/blur)', () => {
    expect(modal).toContain('onPointerDown={(e) => { if (e.target === e.currentTarget) closeTableProfile(); }}');
    expect(modal).toContain('useEscapeClose(closeTableProfile)');
    expect(modal).toContain('className="profile-modal-card"');
    expect(modal).not.toContain('profile-modal-card glass');
    const cardRule = socialCss.slice(socialCss.indexOf('.profile-modal-card {'), socialCss.indexOf('}', socialCss.indexOf('.profile-modal-card {')));
    expect(cardRule).toContain('background: #201334');
    expect(cardRule).not.toContain('backdrop-filter');
    // the table blur rule still exempts modal backdrops (the modal's shell class)
    expect(stylesCss).toContain(':not(.modal-backdrop)');
    expect(modal).toContain('className="modal-backdrop profile-modal-backdrop"');
  });
  it('the modal fetches Rep by the RAW account id, like the fixed profile view', () => {
    expect(modal).toContain('fetch(`/api/profile/${encodeURIComponent(target.uid)}`');
    expect(modal).toContain('const pic = useAvatar(target.uid,');
  });
  it('lobby seat faces and video-bubble menus open profiles too', () => {
    expect(lobby).toContain('onTap={target ? () => openPlayerProfile({ id: info.kind === \'human\' ? info.uid : undefined, name }) : undefined}');
    expect(media).toContain('data-testid={`vb-profile-${id}`}');
    expect(media).toContain('openPlayerProfile({ id: seat.uid, name: seat.name })');
  });
});
