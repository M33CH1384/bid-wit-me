/**
 * Results surfaces carry NO "Change mode" control (owner, 2026-11-05:
 * "The change mode button on the results screen should be removed").
 *
 * The button lived only on the offline game-over modal, where it was a
 * second label on the exact same exit as "Back to home" (both called
 * exitFinished → leave() → main menu) — a fossil of the retired /rewards
 * flow. It read no mode state and fed nothing: Rematch has always
 * replayed the finished game's own mode/table via onRematch.
 *
 * These pins (source-level, like the neighbouring wiring suites) hold:
 *  - no results surface renders a Change Mode control (the offline
 *    game-over modal, the online victory screen, the recovery overlay
 *    and the merged report are all in Table.tsx / GameOverRewards.tsx /
 *    VictoryRecovery.tsx);
 *  - the offline modal's action row keeps its real exits (Score pad,
 *    Rematch, Back to home) and loses the divider that existed only to
 *    separate the removed button;
 *  - the landscape tier's game-over action-row rules no longer style a
 *    .leave-red / .exit-divider that the modal never renders;
 *  - Rematch still deals the finished game back (same handler wiring).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const rewards = readFileSync(new URL('../src/GameOverRewards.tsx', import.meta.url), 'utf8');
const recovery = readFileSync(new URL('../src/VictoryRecovery.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** The offline game-over sheet's DOM block in Table.tsx. */
const offlineBlock = (() => {
  const start = table.indexOf('{showResults && st.result && !online?.victory');
  if (start < 0) throw new Error('offline game-over block not found');
  return table.slice(start, table.indexOf('<AnimFxLayer', start));
})();

/** The online victory screen's DOM block in Table.tsx. */
const onlineBlock = (() => {
  const start = table.indexOf('{showResults && online?.victory');
  if (start < 0) throw new Error('online victory block not found');
  return table.slice(start, table.indexOf('{showResults && st.result && !online?.victory', start));
})();

describe('no Change Mode control on any results surface', () => {
  it('the label appears in no results-surface source file', () => {
    expect(table).not.toContain('Change mode');
    expect(rewards).not.toContain('Change mode');
    expect(recovery).not.toContain('Change mode');
  });

  it('the offline game-over action row keeps Rematch + Back to home and drops the divider', () => {
    const actions = offlineBlock.slice(offlineBlock.indexOf('className="confirm-actions"'));
    expect(actions).toContain('Play again — Rematch');
    expect(actions).toContain('onClick={() => onRematch(nextDealer(st))}');
    expect(actions).toContain('data-testid="main-menu"');
    expect(actions).toContain('>Back to home</button>');
    expect(actions).not.toContain('exit-divider');
    expect(actions).not.toContain('leave-red');
  });

  it('the online victory action row is unchanged: Score pad / Rematch / Back to home', () => {
    const actions = onlineBlock.slice(onlineBlock.indexOf('className="confirm-actions"'));
    expect(actions).toContain('data-testid="rematch"');
    expect(actions).toContain('data-testid="main-menu"');
    expect(actions).not.toContain('exit-divider');
  });

  it('the landscape tier no longer styles the removed button or its divider', () => {
    expect(css).not.toContain('.modal.gameover .confirm-actions .leave-red');
    expect(css).not.toContain('.modal.gameover .confirm-actions .exit-divider');
    // the shared classes themselves stay — the pause menu, hand recap and
    // score pad still render Leave buttons with them
    expect(css).toContain('.tt-foot .leave-red');
    expect(css).toContain('.score-pad .leave-red');
  });
});
