/**
 * VICTORY CONSOLIDATION — wiring pins (node environment, source-level
 * like story-rematch-wiring.test.ts). Behavior is pinned in
 * victory-merge.test.ts; these pins guard the mechanisms the behavior
 * hangs off, so the two-screen flow cannot creep back:
 *
 *  - finishing a game presents exactly ONE postgame surface: Table
 *    computes the breakdown when the victory screen presents and renders
 *    VictoryReport inside BOTH victory variants; nothing in the app
 *    navigates to a /rewards postgame anymore, and the old RewardsPage
 *    module is gone;
 *  - the /rewards route itself redirects home (stale tabs/bookmarks),
 *    and the reload-recovery overlay is mounted at the app root — the
 *    only remaining presenter of the standalone composition;
 *  - story games never render the merged report (their outro carries
 *    their rewards) and the generic exits never route through it;
 *  - GameOverRewards holds ONE report-body implementation, shared by
 *    the standalone composition and the in-table report.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const gor = readFileSync(new URL('../src/GameOverRewards.tsx', import.meta.url), 'utf8');

const onlineStart = table.indexOf('{showResults && online?.victory');
const offlineStart = table.indexOf('{showResults && st.result && !online?.victory', onlineStart);
const onlineBlock = table.slice(onlineStart, offlineStart);
const offlineBlock = table.slice(offlineStart, table.indexOf('<AnimFxLayer', offlineStart));

describe('one postgame surface', () => {
  it('both victory variants render the merged report', () => {
    expect(onlineStart).toBeGreaterThan(-1);
    expect(offlineStart).toBeGreaterThan(onlineStart);
    expect(onlineBlock).toContain('<VictoryReport');
    expect(offlineBlock).toContain('<VictoryReport');
    // Table never renders the standalone composition itself
    expect(table).not.toContain('<GameOverRewards');
  });

  it('the report renders only for non-story games on the offline sheet', () => {
    expect(offlineBlock).toContain('!storyGame && mergedRewards');
  });

  it('the breakdown computes at presentation, once per finished match, and is stashed for recovery', () => {
    expect(table).toContain('mergedFor.current === matchSeed');
    expect(table).toContain('computeRewardsSettled(profileBefore.current');
    expect(table).toContain('stashRewards(payload)');
    expect(table).toContain('const storyStopId = story?.scene?.stop.id;');
    expect(table).toContain('storyStopId, gameId: online ? undefined : localGameId(matchSeed)');
  });

  it('no navigation to a second postgame step remains', () => {
    expect(table).not.toContain("'/rewards'");
    expect(table).not.toContain('openRewards');
    expect(table).toContain('const exitFinished = () =>');
    expect(table).not.toContain('location.href = \'/rewards\'');
  });

  it('the old rewards page module is gone', () => {
    expect(existsSync(new URL('../src/RewardsPage.tsx', import.meta.url))).toBe(false);
  });
});

describe('the retired route + the recovery overlay', () => {
  it('/rewards redirects home; the recovery overlay mounts at the root', () => {
    expect(main).toContain("path === '/rewards' ? <RewardsRetired />");
    expect(main).toContain("location.replace('/')");
    expect(main).toContain('<VictoryRecovery />');
    expect(main).not.toContain('RewardsPage');
  });

  it('the SoundDock no longer excludes the retired route', () => {
    expect(main).not.toContain("path !== '/rewards'");
  });
});

describe('one report-body implementation', () => {
  it('ReportBody renders in exactly the two compositions', () => {
    expect(gor).toContain('function ReportBody(');
    expect(gor.match(/<ReportBody /g)).toHaveLength(2);
    expect(gor).toContain('export function VictoryReport(');
    expect(gor).toContain('export default function GameOverRewards(');
  });

  it('the takeover arming lives in the shared body (it moved with the report)', () => {
    const body = gor.slice(gor.indexOf('function ReportBody('), gor.indexOf('/* -------------------------------------------------- standalone composition'));
    expect(body).toContain('cardTakeoverKey(d)');
    expect(body).toContain('markTakeoverDismissed(takeover.key)');
    expect(body).toContain('CARD_TAKEOVER_DELAY_MS');
  });
});
