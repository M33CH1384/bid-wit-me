/**
 * @vitest-environment happy-dom
 *
 * Victory stash shape validation (crash hardening, 2026-11-06). The
 * rewards stash exists to survive reloads — including reloads across a
 * DEPLOY, where the stash was written by an older build. loadRewards
 * used to check only that `data` was truthy; a truthy-but-partial data
 * (an older build's shape) then threw inside GameOverRewards' render
 * (data.achievements.length) at boot, on every boot, until storage was
 * cleared — a self-inflicted white-screen loop on the recovery path.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadRewards, stashRewards, type RewardsPayload } from '../src/rewardsStash';

const KEY = 'bwm.rewards.v1';

function validData(): RewardsPayload['data'] {
  return {
    won: true, headline: 'W', sub: 's', signedIn: true, xpGained: 10,
    levelBefore: 1, levelAfter: 1, rankBefore: null, rankAfter: null,
    cardAfter: null, cardUp: false, bigJokerUp: false, xpIntoLevel: 0,
    xpForNext: 100, xpIntoLevelBefore: 0, xpForNextBefore: 100,
    coinsGained: 0, eloBefore: null, eloAfter: null, eloKindLabel: 'Rating',
    achievements: [], challenges: [], playWell: null, postgame: null,
  } as RewardsPayload['data'];
}

function put(data: unknown): void {
  sessionStorage.setItem(KEY, JSON.stringify({ data, online: false, homePath: '/' }));
}

beforeEach(() => { sessionStorage.clear(); });

describe('loadRewards shape validation', () => {
  it('a well-formed stash round-trips', () => {
    const p: RewardsPayload = { data: validData(), online: false, homePath: '/' };
    stashRewards(p);
    expect(loadRewards()?.data.headline).toBe('W');
  });

  it('a partial data payload (older build shape) is rejected AND cleared, not rendered', () => {
    put({ signedIn: true, won: true }); // truthy, but no achievements/challenges arrays
    expect(loadRewards()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull(); // cannot loop on the next boot
  });

  it('a postgame block without its arrays is rejected', () => {
    const d = validData();
    (d as { postgame: unknown }).postgame = { myBooks: 3 };
    put(d);
    expect(loadRewards()).toBeNull();
  });

  it('a playWell block without lines is rejected', () => {
    const d = validData();
    (d as { playWell: unknown }).playWell = { xp: 5, coins: 0 };
    put(d);
    expect(loadRewards()).toBeNull();
  });

  it('a well-formed postgame + playWell pass', () => {
    const d = validData();
    (d as { postgame: unknown }).postgame = { sides: [], moments: [], myBooks: 0, myNilsMade: 0, turning: null };
    (d as { playWell: unknown }).playWell = { xp: 5, coins: 0, lines: [] };
    put(d);
    expect(loadRewards()).not.toBeNull();
  });

  it('corrupt JSON still yields null (pre-existing behaviour)', () => {
    sessionStorage.setItem(KEY, '{nope');
    expect(loadRewards()).toBeNull();
  });
});
