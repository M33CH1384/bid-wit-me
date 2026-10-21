/** Big Bank Take Lil Bank (Phase 2): the pure logic behind the wager UI — list grouping,
 *  create-form validation + body shape, the profile Challenge button's states, and the
 *  unlock-celebration seen/defer rules — plus source pins for the wiring. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  challengeButtonState, createBody, groupChallenges, netText, parseSeen, popupDeferred,
  seenKey, startPresets, timerLabel, unseenUnlocks, validateCreate, withSeen,
  type CreateFormState,
} from '../src/social/wagerLogic';
import type { WagerPlayer, WagerRow } from '../src/social/wagerApi';

const NOW = 1_800_000_000_000;
const pl = (uid: string, over: Partial<WagerPlayer> = {}): WagerPlayer => ({
  uid, name: uid.toUpperCase(), role: 'partner', side: 0, seat: null,
  status: 'accepted', escrowed: true, checkedIn: false, net: null, ...over,
});
const row = (over: Partial<WagerRow> = {}): WagerRow => ({
  id: 'abc123abc123', format: 'partnership', mode: 'joker', wager: 100, pot: 400,
  startAt: NOW + 3600_000, checkinOpensAt: NOW + 3600_000 - 600_000, createdAt: NOW,
  status: 'scheduled', endReason: null, tableCode: null,
  players: [pl('me', { role: 'challenger' }), pl('x', { role: 'opponent', side: 1 })],
  ...over,
});

describe('groupChallenges', () => {
  it('an invite waiting on me lands in Needs you', () => {
    const g = groupChallenges([row({ status: 'pending', players: [pl('me', { status: 'invited', escrowed: false }), pl('x')] })], 'me', NOW);
    expect(g.needsYou).toHaveLength(1);
    expect(g.upcoming).toHaveLength(0);
  });
  it('a pending challenge I already accepted is Upcoming, and check-in moves it when the window opens', () => {
    const r = row();
    expect(groupChallenges([r], 'me', NOW).upcoming).toHaveLength(1);
    const open = groupChallenges([r], 'me', r.checkinOpensAt + 1);
    expect(open.checkin).toHaveLength(1);
    const done = groupChallenges([row({ players: [pl('me', { checkedIn: true }), pl('x')] })], 'me', r.checkinOpensAt + 1);
    expect(done.checkin).toHaveLength(0);
    expect(done.upcoming).toHaveLength(1);
  });
  it('live and terminal buckets, finished newest first', () => {
    const g = groupChallenges([
      row({ id: 'l', status: 'live', tableCode: 'TBL1' }),
      row({ id: 'f1', status: 'settled', startAt: NOW - 1000 }),
      row({ id: 'f2', status: 'void', startAt: NOW - 500 }),
    ], 'me', NOW);
    expect(g.live.map((r) => r.id)).toEqual(['l']);
    expect(g.finished.map((r) => r.id)).toEqual(['f2', 'f1']);
  });
});

describe('netText', () => {
  it('formats wins, losses, refunds, and the unresolved null', () => {
    expect(netText(250)).toBe('+250');
    expect(netText(-100)).toBe('−100');
    expect(netText(250)).not.toContain('🪙');
    expect(netText(0)).toBe('refunded');
    expect(netText(null)).toBeNull();
  });
});

describe('challengeButtonState', () => {
  const base = { signedIn: true, enabled: true as boolean | null, hasUnlock: true, dev: false, isSelf: false, blocked: false, targetIsGuest: false };
  it('ready when unlocked and the feature is on', () => expect(challengeButtonState(base)).toBe('ready'));
  it('dev bypasses the unlock', () => expect(challengeButtonState({ ...base, hasUnlock: false, dev: true })).toBe('ready'));
  it('locked (visible) when the viewer has not earned Big Bank', () => expect(challengeButtonState({ ...base, hasUnlock: false })).toBe('locked'));
  it('hidden while the flag is off or unknown', () => {
    expect(challengeButtonState({ ...base, enabled: false })).toBe('hidden');
    expect(challengeButtonState({ ...base, enabled: null })).toBe('hidden');
  });
  it('hidden for self, blocked pairs, guests, and signed-out viewers', () => {
    expect(challengeButtonState({ ...base, isSelf: true })).toBe('hidden');
    expect(challengeButtonState({ ...base, blocked: true })).toBe('hidden');
    expect(challengeButtonState({ ...base, targetIsGuest: true })).toBe('hidden');
    expect(challengeButtonState({ ...base, signedIn: false })).toBe('hidden');
  });
});

describe('validateCreate + createBody', () => {
  const form: CreateFormState = {
    format: 'partnership', wager: 250, deck: 'joker', target: 500, timers: 'normal',
    startAt: NOW + 3600_000, opponent: 'Rival', partner: 'Buddy', invitees: ['', '', ''],
  };
  const ctx = { myName: 'Me', balance: 1000, now: NOW };
  it('a complete partnership form validates and posts the contract shape', () => {
    expect(validateCreate(form, ctx)).toBeNull();
    expect(createBody(form)).toEqual({ format: 'partnership', wager: 250, timers: 'normal', startAt: NOW + 3600_000, deck: 'joker', target: 500, opponent: 'Rival', partner: 'Buddy' });
  });
  it('catches people problems', () => {
    expect(validateCreate({ ...form, partner: '' }, ctx)).toMatch(/partner/i);
    expect(validateCreate({ ...form, opponent: 'me' }, ctx)).toMatch(/yourself/i);
    expect(validateCreate({ ...form, partner: 'RIVAL' }, ctx)).toMatch(/different/i);
  });
  it('catches wager and time problems', () => {
    expect(validateCreate({ ...form, wager: 150 }, ctx)).toMatch(/wager/i);
    expect(validateCreate({ ...form, wager: 5000 }, ctx)).toMatch(/balance/i);
    expect(validateCreate({ ...form, startAt: NOW + 60_000 }, ctx)).toMatch(/15 minutes/i);
    expect(validateCreate({ ...form, startAt: NOW + 8 * 24 * 3600_000 }, ctx)).toMatch(/7 days/i);
  });
  it('cutthroat needs three distinct other players and posts invitees', () => {
    const cut: CreateFormState = { ...form, format: 'cutthroat', target: 300, invitees: [' A ', 'B', 'C'] };
    expect(validateCreate(cut, ctx)).toBeNull();
    expect(createBody(cut)).toEqual({ format: 'cutthroat', wager: 250, timers: 'normal', startAt: NOW + 3600_000, target: 300, invitees: ['A', 'B', 'C'] });
    expect(validateCreate({ ...cut, invitees: ['A', 'a', 'C'] }, ctx)).toMatch(/different/i);
    expect(validateCreate({ ...cut, invitees: ['A', 'Me', 'C'] }, ctx)).toMatch(/yourself/i);
    expect(validateCreate({ ...cut, invitees: ['A', '', 'C'] }, ctx)).toMatch(/three/i);
  });
});

describe('startPresets / timerLabel', () => {
  it('tonight is today at 8 PM when that is comfortably ahead, else tomorrow', () => {
    const morning = new Date(2026, 9, 20, 10, 0).getTime();
    const tonight = startPresets(morning).find((p) => p.id === 'tonight')!;
    expect(new Date(tonight.at).getHours()).toBe(20);
    expect(new Date(tonight.at).getDate()).toBe(20);
    const late = new Date(2026, 9, 20, 21, 30).getTime();
    const rolled = startPresets(late).find((p) => p.id === 'tonight')!;
    expect(new Date(rolled.at).getDate()).toBe(21);
    expect(startPresets(morning).find((p) => p.id === 'hour')!.at).toBe(morning + 3600_000);
  });
  it('labels presets and falls back to raw numbers', () => {
    expect(timerLabel({ bid: 45, play: 45 })).toBe('Chill 45/45');
    expect(timerLabel({ bid: 30, play: 30 })).toBe('Normal 30/30');
    expect(timerLabel({ bid: 15, play: 25 })).toBe('15/25');
  });
});

describe('unlock popup logic', () => {
  it('unseen = celebrated, not seen, oldest first', () => {
    const got = unseenUnlocks([
      { itemId: 'after-dark', unlockedAt: 200 },
      { itemId: 'big-bank', unlockedAt: 100 },
      { itemId: 'something-else', unlockedAt: 50 },
    ], []);
    expect(got.map((u) => u.itemId)).toEqual(['big-bank', 'after-dark']);
    expect(unseenUnlocks([{ itemId: 'big-bank', unlockedAt: 100 }], ['big-bank'])).toEqual([]);
  });
  it('seen storage: key is per-account; parse tolerates junk; withSeen dedupes', () => {
    expect(seenKey('u1')).toBe('bwm.unlockSeen.u1');
    expect(parseSeen(null)).toEqual([]);
    expect(parseSeen('not json')).toEqual([]);
    expect(parseSeen('["big-bank", 3]')).toEqual(['big-bank']);
    expect(withSeen(['a'], 'a')).toEqual(['a']);
    expect(withSeen(['a'], 'b')).toEqual(['a', 'b']);
  });
  it('deferred over any table, free in menus/lobby/profile', () => {
    expect(popupDeferred('/t/ABCD', false)).toBe(true);
    expect(popupDeferred('/', true)).toBe(true);
    expect(popupDeferred('/online', false)).toBe(false);
    expect(popupDeferred('/', false)).toBe(false);
    expect(popupDeferred('/profile', false)).toBe(false);
  });
});

describe('wiring pins', () => {
  const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/social/ProfileModal.tsx', import.meta.url), 'utf8');
  const wager = readFileSync(new URL('../src/social/Wager.tsx', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/social/store.ts', import.meta.url), 'utf8');
  const mig = readFileSync(new URL('../../server/migrations/0017_wager_open.sql', import.meta.url), 'utf8');
  it('the challenges tab is reachable from the gear menu and renders the tab body', () => {
    expect(social).toContain('data-testid="soc-tab-challenges"');
    expect(social).toContain("s.tab === 'challenges' ? <WagerChallenges signedIn={signedIn} />");
    expect(social).toContain('<UnlockPopups />');
  });
  it('challenge buttons sit in both profile action rows', () => {
    // ONE PROFILE (2026-10-20): the panel/page action row lives in the unified view
    const view = readFileSync(new URL('../src/profile/ProfileView.tsx', import.meta.url), 'utf8');
    expect(view).toContain('<ChallengeButton name={displayName}');
    expect(modal).toContain('testid="profile-modal-challenge"');
    expect(modal).toContain("social.startChallenge(target.name)");
  });
  it('wager notices deep-link to the challenge detail', () => {
    expect(store).toContain('cid: m.cid');
    expect(social).toContain('social.showChallenge(n.cid!)');
  });
  it('the create form posts the API contract and the detail carries every action', () => {
    expect(wager).toContain('createWager(createBody(f))');
    expect(wager).toContain("data-testid=\"wg-accept\"");
    expect(wager).toContain("data-testid=\"wg-checkin\"");
    expect(wager).toContain("data-testid=\"wg-join\"");
  });
  it('migration 0017 flips the flag on', () => {
    expect(mig).toContain("UPDATE cred_flags SET value = '1' WHERE key = 'wager_challenges_enabled'");
    expect(mig).toContain('ADD COLUMN net');
  });
});
