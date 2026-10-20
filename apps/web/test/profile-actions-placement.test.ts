/** Profile action-row placement (Demetrius 2026-10-20): the Chat / Friends /
 *  Block / Report row used to sit far down the profile, between Achievements
 *  and Stats. He circled it in a screenshot and sent it up: "These items need
 *  to be moved under the presence or inline with it." The row now renders
 *  INSIDE the profile header, directly under the presence line, on both the
 *  Social profile view and the in-game profile modal (where the quick-send DM
 *  box + Sent confirmation travel with it). These source pins keep a future
 *  edit from drifting the row back down the page. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/social/ProfileModal.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe('Social profile: action row under the presence line', () => {
  const profile = social.slice(social.indexOf('function Profile('));
  it('exactly one action row — no duplicate left down the page', () => {
    expect(count(profile, 'className="soc-prof-acts"')).toBe(1);
  });
  it('the row renders after the presence line, before the stats grid and the Rep section', () => {
    const presence = profile.indexOf('data-testid="profile-online"');
    const acts = profile.indexOf('className="soc-prof-acts"');
    expect(presence).toBeGreaterThan(-1);
    expect(acts).toBeGreaterThan(presence);
    expect(profile.indexOf('className="soc-stats"')).toBeGreaterThan(acts);
    expect(profile.indexOf('data-testid="profile-rep"')).toBeGreaterThan(acts);
  });
  it('the row is inside the header block (before the social-links chips that follow the header)', () => {
    const acts = profile.indexOf('className="soc-prof-acts"');
    expect(acts).toBeGreaterThan(-1);
    expect(profile.indexOf('<SocialLinksChips')).toBeGreaterThan(acts);
  });
  it('the row keeps every action and handler (Chat, Invite, friend states, Block, Report)', () => {
    expect(profile).toContain('social.openDm(pid)');
    expect(profile).toContain('data-testid="profile-add"');
    expect(profile).toContain('data-testid="profile-accept"');
    expect(profile).toContain('data-testid="profile-block"');
    expect(profile).toContain("social.report('user', { user: pid })");
  });
});

describe('Profile modal: action row under the presence line', () => {
  const card = modal.slice(modal.indexOf('function ProfileCard'));
  it('exactly one action row — no duplicate left under the Rep section', () => {
    expect(count(card, 'className="soc-prof-acts"')).toBe(1);
  });
  it('the row renders after the presence line, before the stats grid and the Rep section', () => {
    const presence = card.indexOf('soc-online-status');
    const acts = card.indexOf('className="soc-prof-acts"');
    expect(presence).toBeGreaterThan(-1);
    expect(acts).toBeGreaterThan(presence);
    expect(card.indexOf('className="soc-stats"')).toBeGreaterThan(acts);
    expect(card.indexOf('data-testid="profile-modal-rep"')).toBeGreaterThan(acts);
  });
  it('the quick-send DM box and its Sent confirmation travel with the row, above the Rep section', () => {
    const acts = card.indexOf('className="soc-prof-acts"');
    const box = card.indexOf('profile-modal-compose');
    const sent = card.indexOf('data-testid="profile-modal-dm-sent"');
    const rep = card.indexOf('data-testid="profile-modal-rep"');
    expect(box).toBeGreaterThan(acts);
    expect(sent).toBeGreaterThan(acts);
    expect(rep).toBeGreaterThan(box);
    expect(rep).toBeGreaterThan(sent);
  });
  it('the blocked note travels with the row too', () => {
    const acts = card.indexOf('className="soc-prof-acts"');
    const note = card.indexOf('Unblock them to message.');
    expect(note).toBeGreaterThan(acts);
    expect(card.indexOf('data-testid="profile-modal-rep"')).toBeGreaterThan(note);
  });
});

describe('header CSS: the row wraps as a full-width line under the header text', () => {
  it('the header wraps and the relocated children span the full width', () => {
    expect(css).toContain('.soc-prof-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;');
    expect(css).toContain('.soc-prof-head > .soc-prof-acts,');
    expect(css).toContain('.soc-prof-head > .profile-modal-compose,');
    expect(css).toContain('flex: 1 1 100%');
  });
});
