/**
 * Story rematch + story win exits — wiring pins (node environment,
 * source-level like story-house-deck-wiring.test.ts). Behavior is pinned
 * in story-rematch.test.ts; these pins guard the mechanisms the behavior
 * hangs off, so neither can drift silently:
 *
 *  - Table stashes the finished match's story stop into the rewards
 *    payload, and RewardsPage routes Rematch through rematchPathFor.
 *  - Table fires the story result callback exactly once per game; the
 *    single post site in StoryHome keys it by the per-seed gameId.
 *  - A finished story match leaves the game-over modal only through the
 *    host exit (leave → StoryHome outro → map): every story exit routes
 *    there, the generic exits (Back to home / Change mode / the /rewards
 *    detour) render only for non-story games, and a story win's primary
 *    action is the onward "To the map" (no rematch of a cleared stop).
 *  - The generic autostart still builds from the saved settings, so
 *    normal (non-story) rematches are untouched.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const storyHome = readFileSync(new URL('../src/story/StoryHome.tsx', import.meta.url), 'utf8');
const rewardsPage = readFileSync(new URL('../src/RewardsPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');




describe('rematch + story-win wiring', () => {
  it('Table stashes the finished match’s story stop into the rewards payload', () => {
    expect(table).toContain('storyStopId: story?.scene?.stop.id');
  });

  it('RewardsPage sends Rematch through rematchPathFor', () => {
    expect(rewardsPage).toContain('location.href = rematchPathFor(payload)');
  });

  it('the generic autostart still builds from the saved settings (normal games unchanged)', () => {
    expect(app).toContain('settings: loadSettings(), continueSeries: false');
  });

  it('StoryHome’s in-table rematch and outro retry stay story-scoped', () => {
    expect(storyHome).toContain('onRematch={() => startGame(stop)}');
    expect(storyHome).toContain('data-testid="story-retry"');
  });

  it('a story result is posted from exactly one place, once per game', () => {
    // StoryHome: the single post site, keyed by the per-game seed (the
    // server dedupes claims on that gameId).
    expect(storyHome.match(/postStoryResult\(/g)).toHaveLength(1);
    expect(storyHome).toContain('postStoryResult(stop.id, won, `story-${seed}`, facts)');
    // Table: the fire-once guard around the story callback.
    expect(table).toMatch(/storyFired\.current = true;\s*\n\s*story\.onGameOver\(/);
  });

  it('the story outro ends at the map', () => {
    expect(storyHome).toContain('cta="Back to the map"');
  });
});

describe('story game-over modal exits', () => {
  it('storyGame/storyWon derive from the story prop + the result, nothing else', () => {
    expect(table).toContain('const storyGame = !!story;');
    expect(table).toContain('const storyWon = storyGame && !!st.result && st.result.winners.includes(mySide);');
  });

  it('every story exit routes through the host exit (leave), never openRewards', () => {
    // the modal ✕: story games leave via the host, non-story via rewards
    expect(table).toContain("onClick={() => (storyGame ? leave() : openRewards('home'))}");
    // "To the map" (the outro route) is offered on both story outcomes:
    // the win's primary action and the loss's secondary action
    expect(table.match(/data-testid="story-to-map" onClick=\{\(\) => leave\(\)\}>To the map<\/button>/g)).toHaveLength(2);
    expect(table).toMatch(/\{storyGame \? \(\s*\n\s*storyWon \? \(/);
  });

  it('the win demotes Rematch; the loss keeps it; non-story games keep every stock exit', () => {
    expect(table).toContain('Play again — Rematch');
    expect(table).toContain("onClick={() => openRewards('leave')}>Change mode</button>");
    expect(table).toContain('data-testid="main-menu"');
  });

  it('StoryHome’s host exits land a finished game on the outro (the way to the map)', () => {
    expect(storyHome).toContain("finishedRef.current?.seed === screen.seed ? { k: 'outro', stop, won: finishedRef.current.won } : { k: 'map' }");
  });
});
