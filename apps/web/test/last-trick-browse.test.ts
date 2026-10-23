import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASSIC_JOKER, makeRules, type GameState, type Trick } from '@spades/rules';
import { simulateGame } from '@spades/bots';
import { browsedTrick, resolveTrickIndex, stepTrickIndex, trickPositionLabel } from '../src/lastTrickBrowse';

/**
 * Last-trick browser (owner 2026-10-23: "Last trick should have a fwd / back
 * option to cycle thru tricks quickly"). The readout cycles the CURRENT
 * HAND's completed tricks — the same `st.tricks` the table already holds in
 * every mode (offline/story keep the full GameState; online's PlayerView
 * carries the full tricks array too). These tests pin the browsing math
 * against real simulated hands, the live-edge rule (a trick landing
 * mid-browse never yanks the view), the hand boundary, and the Table wiring.
 */

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/** Every hand's completed-trick array from full bot-vs-bot games, captured as the hands grew. */
function simulatedHands(): { handNo: number; tricks: Trick[] }[] {
  const byHand = new Map<string, { handNo: number; tricks: Trick[] }>();
  const runs: [ReturnType<typeof makeRules>, string][] = [
    [makeRules('joker', { targetScore: 120 }), 'lt-prop-a'],
    [makeRules('joker', { ...CLASSIC_JOKER, targetScore: 120 }), 'lt-prop-b'],
    [makeRules('cutthroat', { targetScore: 120 }), 'lt-prop-c'],
  ];
  for (const [rules, seed] of runs) {
    simulateGame(rules, seed, {
      onAction: (st: GameState) => {
        if (st.tricks.length === 0) return;
        const key = `${seed}:${st.handNo}`;
        const prev = byHand.get(key);
        if (!prev || st.tricks.length > prev.tricks.length) byHand.set(key, { handNo: st.handNo, tricks: [...st.tricks] });
      },
    });
  }
  return [...byHand.values()];
}

describe('browsing math', () => {
  it('resolves unpinned to the newest trick and clamps any selection into range', () => {
    expect(resolveTrickIndex(null, 5)).toBe(4);
    expect(resolveTrickIndex(0, 5)).toBe(0);
    expect(resolveTrickIndex(2, 5)).toBe(2);
    expect(resolveTrickIndex(99, 5)).toBe(4);
    expect(resolveTrickIndex(-3, 5)).toBe(0);
    expect(resolveTrickIndex(null, 1)).toBe(0);
    expect(resolveTrickIndex(null, 0)).toBe(-1);
    expect(resolveTrickIndex(3, 0)).toBe(-1);
  });

  it('steps one at a time and clamps at both ends — no wrap', () => {
    expect(stepTrickIndex(4, -1, 5)).toBe(3);
    expect(stepTrickIndex(0, -1, 5)).toBe(0);
    expect(stepTrickIndex(3, 1, 5)).toBe(4);
    expect(stepTrickIndex(4, 1, 5)).toBe(4);
    expect(stepTrickIndex(0, 1, 1)).toBe(0);
    expect(stepTrickIndex(0, -1, 0)).toBe(-1);
    // rapid repeated taps: a run of steps lands exactly that many tricks away
    let i = resolveTrickIndex(null, 9);
    for (let k = 0; k < 5; k++) i = stepTrickIndex(i, -1, 9);
    expect(i).toBe(3);
    for (let k = 0; k < 20; k++) i = stepTrickIndex(i, 1, 9);
    expect(i).toBe(8);
  });

  it('labels the newest as LAST TRICK and older tricks by position', () => {
    expect(trickPositionLabel(6, 7)).toBe('LAST TRICK');
    expect(trickPositionLabel(2, 7)).toBe('TRICK 3 OF 7');
    expect(trickPositionLabel(0, 1)).toBe('LAST TRICK');
    expect(trickPositionLabel(0, 4)).toBe('TRICK 1 OF 4');
  });
});

describe('against simulated hands', () => {
  const hands = simulatedHands();

  it('collected full hands of real tricks', () => {
    expect(hands.length).toBeGreaterThanOrEqual(3);
    for (const h of hands) expect(h.tricks.length).toBeGreaterThanOrEqual(10);
  });

  it('every stop shows that trick — its cards in play order, its leader, its winner', () => {
    for (const { tricks } of hands) {
      for (let i = 0; i < tricks.length; i++) {
        const b = browsedTrick(tricks, i)!;
        expect(b.index).toBe(i);
        expect(b.trick).toBe(tricks[i]);
        // the leader is the first card down; the winner is one of the seats that played
        expect(b.trick.leader).toBe(b.trick.plays[0]!.seat);
        expect(b.trick.winner).not.toBeNull();
        expect(b.trick.plays.map((p) => p.seat)).toContain(b.trick.winner);
        // cards are unique within the trick and stay in the order they were played
        expect(new Set(b.trick.plays.map((p) => p.card)).size).toBe(b.trick.plays.length);
      }
      // unpinned = the last trick, and walking back then forward returns to it
      expect(browsedTrick(tricks, null)!.trick).toBe(tricks[tricks.length - 1]);
      let i = resolveTrickIndex(null, tricks.length);
      while (i > 0) i = stepTrickIndex(i, -1, tricks.length);
      expect(browsedTrick(tricks, i)!.trick).toBe(tricks[0]);
      while (i < tricks.length - 1) i = stepTrickIndex(i, 1, tricks.length);
      expect(browsedTrick(tricks, i)!.trick).toBe(tricks[tricks.length - 1]);
    }
  });

  it('a trick landing mid-browse never yanks the view; forward can step into the new one', () => {
    for (const { tricks } of hands) {
      if (tricks.length < 4) continue;
      const grown = tricks.slice(0, 3);
      const shown = browsedTrick(grown, 1)!.trick;
      // a new trick completes while the player sits on trick 2
      const landed: Trick = { leader: tricks[3]!.leader, plays: tricks[3]!.plays, winner: tricks[3]!.winner };
      const now = [...grown, landed];
      expect(browsedTrick(now, 1)!.trick).toBe(shown);
      expect(trickPositionLabel(1, now.length)).toBe('TRICK 2 OF 4');
      // and forward steps onto the trick that just landed
      expect(browsedTrick(now, stepTrickIndex(1, 1, now.length))!.trick).toBe(tricks[2]);
      expect(browsedTrick(now, stepTrickIndex(2, 1, now.length))!.trick).toBe(landed);
      // a selection parked on the OLD newest also stays put (it is no longer the newest)
      expect(browsedTrick(now, grown.length - 1)!.trick).toBe(grown[grown.length - 1]);
    }
  });

  it('a new hand never leaks the old one: selection resets to the new hand’s newest, stale indexes clamp', () => {
    const [first, second] = hands;
    // the component clears the selection on hand change (null) → new hand's last trick
    expect(browsedTrick(second!.tricks, null)!.trick).toBe(second!.tricks[second!.tricks.length - 1]);
    // even a stale deep index from a long previous hand clamps inside the new hand
    const stale = browsedTrick(second!.tricks, first!.tricks.length - 1)!;
    expect(stale.index).toBeLessThan(second!.tricks.length);
    expect(second!.tricks).toContain(stale.trick);
    // no tricks yet → nothing to show
    expect(browsedTrick([], null)).toBeNull();
    expect(browsedTrick([], 0)).toBeNull();
  });
});

describe('Table wiring', () => {
  const table = src('Table.tsx');
  const css = src('styles.css');

  it('the open readout renders back/forward buttons that do not close it', () => {
    expect(table).toContain('data-testid="lt-prev"');
    expect(table).toContain('data-testid="lt-next"');
    expect(table).toContain('aria-label="Previous trick"');
    expect(table).toContain('aria-label="Next trick"');
    // nav taps are carved out of the readout's tap-to-close, clicks and keys alike
    expect(table).toContain("onClick={(e) => { e.stopPropagation(); setLtIdx(stepTrickIndex(ltIndex, -1, piles.length)); }}");
    expect(table).toContain("onClick={(e) => { e.stopPropagation(); setLtIdx(stepTrickIndex(ltIndex, 1, piles.length)); }}");
    expect(table).toContain("if (e.target !== e.currentTarget) return;");
  });

  it('the ends clamp in the UI: the buttons disable at trick 1 and at the newest', () => {
    expect(table).toContain('disabled={ltIndex <= 0}');
    expect(table).toContain('disabled={ltIndex >= piles.length - 1}');
  });

  it('the pill opens on the newest trick and a new hand clears the selection', () => {
    expect(table).toContain('const toggleLt = useCallback(() => { setLtOpen((v) => !v); setLtIdx(null); }, []);');
    expect(table).toContain('useEffect(() => { setLtIdx(null); }, [st.handNo]);');
    expect(table).toContain('browsedTrick(piles, ltOpen ? ltIdx : null)');
  });

  it('each stop names who led and who took it, with the position in the label', () => {
    expect(table).toContain('data-testid="lt-meta"');
    expect(table).toContain('{face(t.leader)} led');
    expect(table).toContain('{face(t.winner)} took it');
    expect(table).toContain('trickPositionLabel(ltIndex, piles.length)');
  });

  it('placement refinement (owner 2026-10-23): CSS-only — the open browser re-anchors, the chip and markup stay', () => {
    // the open portrait browser lifts clear of the player's plate and steps
    // left of the controls rail (geometry pinned in plate-fit.test.ts); the
    // Run It review is excluded from the re-anchor by name
    expect(css).toContain('.table-screen:not(.short) .last-trick.open:not(.run-open), .table-screen:not(.short) .last-trick.open.glass.slant:not(.run-open) { right: calc(66px + env(safe-area-inset-right)); bottom: calc(112px + env(safe-area-inset-bottom)) !important; padding: 5px 14px; }');
    // trick cards ~30% larger for an at-a-glance read
    expect(css).toContain('min-width: 34px; padding: 4px 5px; border-radius: 5px;');
    expect(css).toContain('.table-screen.short .lt-card { min-width: 31px; font-size: 17px; padding: 3px 4px; }');
  });

  it('the nav buttons are 44px targets and cycling has no transition to wait on', () => {
    const nav = css.slice(css.indexOf('.lt-nav {'), css.indexOf('.lt-nav:disabled'));
    expect(nav).toContain('min-width: 44px');
    expect(nav).toContain('min-height: 44px');
    const row = css.slice(css.indexOf('.lt-navrow'), css.indexOf('.lt-meta'));
    expect(row).not.toContain('transition');
    expect(nav).not.toContain('transition');
  });
});
