/** Profile extras (Demetrius 2026-10-20): "You should also be able to see their rank,
 *  coins, badges, send a friend request." These pins keep all four on the in-game
 *  profile modal's card (rank = Rep divisions/Elo, coins = the public balance off
 *  /api/profile/:id, badges = unlocked achievement chips, friend request with its
 *  states) and keep the Social panel profile view in agreement on coins + states. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(new URL('../src/social/ProfileModal.tsx', import.meta.url), 'utf8');
const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');

describe('profile modal: rank, coins, badges', () => {
  it('rank: Rep section carries level/title and BOTH division · Elo chips', () => {
    expect(modal).toContain('data-testid="profile-modal-rep"');
    expect(modal).toContain('Level {cred.level.level}');
    expect(modal).toContain('divLabel(cred.rank.team.division)} · {cred.rank.team.elo}');
    expect(modal).toContain('divLabel(cred.rank.cutthroat.division)} · {cred.rank.cutthroat.elo}');
  });
  it('coins: renders the public balance from the cred payload, formatted like the profile page', () => {
    expect(modal).toContain('coins?: { balance: number }');
    expect(modal).toContain('data-testid="profile-modal-coins"');
    expect(modal).toContain('{cred.coins && <span className="soc-coin-chip"');
    expect(modal).toContain('🪙 {cred.coins.balance.toLocaleString()}');
  });
  it('badges: unlocked achievements as chips, capped at 10 with a +N more chip', () => {
    expect(modal).toContain('unlocked.slice(0, 10)');
    expect(modal).toContain('+{unlocked.length - 10} more');
    expect(modal).toContain('className="soc-badges"');
  });
});

describe('profile modal: friend request states', () => {
  it('derives every state from the social store friends lists', () => {
    expect(modal).toContain('(s.friends?.friends ?? []).some((f) => f.id === pid)');
    expect(modal).toContain('(s.friends?.outgoing ?? []).some((f) => f.id === pid)');
    expect(modal).toContain('(s.friends?.incoming ?? []).some((f) => f.id === pid)');
    expect(modal).toContain('(s.friends?.blocked ?? []).some((f) => f.id === pid)');
  });
  it('not friends: Add friend sends through the store friend machinery', () => {
    expect(modal).toContain("social.friend('request', pid)");
    expect(modal).toContain('data-testid="profile-modal-add"');
  });
  it('request sent: the button disables into the Requested state', () => {
    expect(modal).toContain("disabled={pending} data-testid=\"profile-modal-add\"");
    expect(modal).toContain("{pending ? 'Requested' : '👋 Add friend'}");
  });
  it('already friends: a Friends indicator instead of a button', () => {
    expect(modal).toContain('data-testid="profile-modal-friends"');
    expect(modal).toContain('★ Friends');
  });
  it('incoming request from them: Accept (and Decline) offered, Add friend hidden', () => {
    expect(modal).toContain('data-testid="profile-modal-accept"');
    expect(modal).toContain("social.friend('accept', pid)");
    expect(modal).toContain('data-testid="profile-modal-decline"');
    expect(modal).toContain("social.friend('decline', pid)");
    expect(modal).toContain('{!friend && !incoming && !blocked && <button type="button" disabled={pending} data-testid="profile-modal-add"');
  });
  it('self and blocked pairs get no friend controls', () => {
    expect(modal).toContain('{!me && (');
    expect(modal).toContain('{incoming && !friend && !blocked &&');
  });
});

describe('social profile view: coins + friend states agree with the modal', () => {
  it('coins: same chip off the same payload', () => {
    expect(social).toContain('data-testid="profile-coins"');
    expect(social).toContain('🪙 {cred.coins.balance.toLocaleString()}');
  });
  it('friend states: Requested / Friends / Accept mirror the modal', () => {
    expect(social).toContain("disabled={pending} onClick={() => social.friend('request', pid)} data-testid=\"profile-add\"");
    expect(social).toContain("{pending ? 'Requested' : '👋 Add friend'}");
    expect(social).toContain('data-testid="profile-friends"');
    expect(social).toContain('data-testid="profile-accept"');
    expect(social).toContain("social.friend('accept', pid)");
  });
});
