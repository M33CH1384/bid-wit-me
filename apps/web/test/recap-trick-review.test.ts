/**
 * @vitest-environment happy-dom
 *
 * Score-card trick review (owner 2026-10-24: the recap's review control
 * "should allow u to use forward and back buttons to see previous tricks").
 * Inventory that led here: the table's LAST TRICK readout has stepped since
 * cc6a5d84, but the hand recap — the score card — had no trick stepping at
 * all: its only Review control was the Run It pill ("Review last trick",
 * pinned by review-label.e2e.ts), which opens the cleared-hands sheet and
 * exists only after a Run It. These tests pin the recap door: a pill that
 * opens the SAME browser (lastTrickBrowse.ts helpers, lt-* classes) over
 * the hand just played — opens on the newest trick, steps back to trick 1,
 * forward to the newest, clamps at both ends, and an absolute selection
 * never slides when the hand's array grows under it.
 *
 * Consolidation (owner, 2026-10-26, with his annotated Hand 5 landscape
 * shot: "Remove the review last trick button and move the review the
 * tricks to the top of the ui so there's no need to scroll in
 * landscape"): the pill now renders in the recap's HEADER — the top of
 * the sheet — instead of the foot of the flow / the landscape rail's
 * last row, where his shot showed it clipped at the rail's edge. And
 * the recap's OTHER review entry — the Run It pill ("Review last
 * trick", the cleared-hands sheet) — is REMOVED: the recap keeps
 * exactly one review door, this one, which opens on the last trick
 * anyway. The tornado's cleared hands stay reachable from the table's
 * RUN IT! chip once play resumes; the recap itself has no door to
 * them anymore, and the negative pins below keep it that way.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, makeRules, newGame, pendingTurn, viewFor, type GameState, type Trick } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';
import { RecapTrickReview, TrickBrowserPanel } from '../src/TrickBrowser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom rewrites import.meta.url, so source pins read cwd-relative from
// the repo root (the escape-close.test.ts pattern)
const src = (p: string) => readFileSync(`apps/web/src/${p}`, 'utf8');

const NAMES = ['You', 'Omar', 'Dee', 'Sven'];
const face = (seat: number) => NAMES[seat]!;

/** Four tricks, each with a unique leader/winner pair so the meta line identifies the stop. */
const TRICKS: Trick[] = [
  { leader: 0, winner: 3, plays: [{ seat: 0, card: '2C' }, { seat: 1, card: '5C' }, { seat: 2, card: '9C' }, { seat: 3, card: 'KC' }] },
  { leader: 3, winner: 2, plays: [{ seat: 3, card: '4D' }, { seat: 0, card: 'QD' }, { seat: 1, card: '7D' }, { seat: 2, card: 'AD' }] },
  { leader: 2, winner: 1, plays: [{ seat: 2, card: '3H' }, { seat: 3, card: 'JH' }, { seat: 0, card: '6H' }, { seat: 1, card: 'AH' }] },
  { leader: 1, winner: 0, plays: [{ seat: 1, card: '8S' }, { seat: 2, card: '10S' }, { seat: 3, card: 'QS' }, { seat: 0, card: 'AS' }] },
] as Trick[];

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => { root.render(node); });
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  return { host, root };
}

function click(host: HTMLElement, testid: string) {
  const el = host.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement | null;
  expect(el, `expected ${testid} to exist`).not.toBeNull();
  act(() => { el!.click(); });
  return el!;
}

const label = (host: HTMLElement) => host.querySelector('.trick-browser .lt-label')?.textContent;
const meta = (host: HTMLElement) => host.querySelector('[data-testid="trick-meta"]')?.textContent;

describe('the recap door', () => {
  it('is a pill until opened, and nothing at all when the hand completed no tricks', () => {
    const { host } = mount(createElement(RecapTrickReview, { tricks: TRICKS, face }));
    expect(host.querySelector('[data-testid="recap-tricks-show"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="trick-browser"]')).toBeNull();

    const empty = mount(createElement(RecapTrickReview, { tricks: [], face }));
    expect(empty.host.querySelector('[data-testid="recap-tricks-show"]')).toBeNull();
    expect(empty.host.textContent).toBe('');
  });

  it('opens on the newest trick and closes back to the pill', () => {
    const { host } = mount(createElement(RecapTrickReview, { tricks: TRICKS, face }));
    click(host, 'recap-tricks-show');
    expect(host.querySelector('[data-testid="trick-browser"]')).not.toBeNull();
    expect(label(host)).toBe('LAST TRICK');
    expect(meta(host)).toBe('Omar led · You took it');
    click(host, 'trick-browser-close');
    expect(host.querySelector('[data-testid="trick-browser"]')).toBeNull();
    expect(host.querySelector('[data-testid="recap-tricks-show"]')).not.toBeNull();
  });
});

describe('stepping the hand just played', () => {
  it('walks back to trick 1 and forward to the newest, clamped at both ends', () => {
    const { host } = mount(createElement(TrickBrowserPanel, { tricks: TRICKS, face }));
    // opens on the newest: forward is already at the edge
    expect(label(host)).toBe('LAST TRICK');
    expect((host.querySelector('[data-testid="trick-next"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[data-testid="trick-prev"]') as HTMLButtonElement).disabled).toBe(false);

    click(host, 'trick-prev');
    expect(label(host)).toBe('TRICK 3 OF 4');
    expect(meta(host)).toBe('Dee led · Omar took it');
    click(host, 'trick-prev');
    expect(label(host)).toBe('TRICK 2 OF 4');
    expect(meta(host)).toBe('Sven led · Dee took it');
    click(host, 'trick-prev');
    expect(label(host)).toBe('TRICK 1 OF 4');
    expect(meta(host)).toBe('You led · Sven took it');
    // clamped at trick 1: prev disables and stays
    const prev = host.querySelector('[data-testid="trick-prev"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    act(() => { prev.click(); });
    expect(label(host)).toBe('TRICK 1 OF 4');

    click(host, 'trick-next');
    click(host, 'trick-next');
    click(host, 'trick-next');
    expect(label(host)).toBe('LAST TRICK');
    expect(meta(host)).toBe('Omar led · You took it');
    const next = host.querySelector('[data-testid="trick-next"]') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('shows the trick’s cards in play order with the winner lit and red suits red', () => {
    const { host } = mount(createElement(TrickBrowserPanel, { tricks: TRICKS, face }));
    const cards = [...host.querySelectorAll('.lt-card')];
    expect(cards.length).toBe(4);
    // newest trick: 8S Omar, 10S Dee, QS Sven, AS You — You (seat 0) took it
    expect(cards.map((c) => c.querySelector('small')?.textContent)).toEqual(['Oma', 'Dee', 'Sve', 'You']);
    expect(cards[3]!.className).toContain('win');
    expect(cards[0]!.className).not.toContain('win');
    // step back to trick 3 (hearts): every card is a red suit
    click(host, 'trick-prev');
    const hearts = [...host.querySelectorAll('.lt-card')];
    expect(hearts.every((c) => c.className.includes('red'))).toBe(true);
    expect(hearts[3]!.className).toContain('win'); // AH — Omar took it
  });

  it('a trick landing mid-browse never moves the one on show; the forward edge extends', () => {
    const three = TRICKS.slice(0, 3);
    const { host, root } = mount(createElement(TrickBrowserPanel, { tricks: three, face }));
    click(host, 'trick-prev');
    click(host, 'trick-prev');
    expect(label(host)).toBe('TRICK 1 OF 3');
    // the hand's array grows (a later snapshot carries one more trick)
    act(() => { root.render(createElement(TrickBrowserPanel, { tricks: TRICKS, face })); });
    expect(label(host)).toBe('TRICK 1 OF 4');
    expect(meta(host)).toBe('You led · Sven took it');
    // and forward can now step all the way onto the trick that landed
    click(host, 'trick-next');
    click(host, 'trick-next');
    click(host, 'trick-next');
    expect(label(host)).toBe('LAST TRICK');
    expect(meta(host)).toBe('Omar led · You took it');
  });
});

describe('the rendered recap (a real hand played to handOver)', () => {
  function toHandOver(seed: string): GameState {
    let st = newGame(makeRules('joker'), seed);
    for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
      const t = pendingTurn(st);
      if (!t) break;
      st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
    }
    return st;
  }

  it('carries exactly one review entry, inside the header — and no Run It pill anywhere', () => {
    const st = toHandOver('recap-trick-top');
    expect(st.phase).toBe('handOver');
    expect(st.tricks.length).toBeGreaterThan(0);
    // the node Table passes, over the hand just played (piles at handOver)
    const html = renderToStaticMarkup(createElement(Intermission, {
      st, names: NAMES, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
      onReady: () => {}, onScorePad: () => {}, onChat: () => {}, onLeave: () => {},
      trickReview: createElement(RecapTrickReview, { tricks: st.tricks, face }),
    }));
    const head = html.slice(html.indexOf('tt-head'), html.indexOf('tt-body'));
    expect(head).toContain('data-testid="recap-tricks-show"');
    expect(head).toContain('Review the tricks');
    // exactly one review entry on the whole sheet
    expect(html.split('recap-tricks-show').length - 1).toBe(1);
    expect(html).not.toContain('Review last trick');
    expect(html).not.toContain('talk-run');
  });
});

describe('wiring — one browser, both doors', () => {
  const panel = src('TrickBrowser.tsx');
  const table = src('Table.tsx');
  const intermission = src('Intermission.tsx');
  const css = src('styles.css');

  it('the panel steps through the shared lastTrickBrowse implementation, never a second one', () => {
    expect(panel).toContain("from './lastTrickBrowse'");
    expect(panel).toContain('browsedTrick(tricks, sel)');
    expect(panel).toContain('stepTrickIndex(index, -1, tricks.length)');
    expect(panel).toContain('stepTrickIndex(index, 1, tricks.length)');
    expect(panel).toContain('trickPositionLabel(index, tricks.length)');
    // the clamps match the table readout's: disabled at trick 1 and at the newest
    expect(panel).toContain('disabled={index <= 0}');
    expect(panel).toContain('disabled={index >= tricks.length - 1}');
    // nav buttons are the shared 44px lt-nav targets
    expect(panel).toContain('className="lt-nav" data-testid="trick-prev"');
    expect(panel).toContain('className="lt-nav" data-testid="trick-next"');
  });

  it('the recap receives the browser from the table, over the hand just played — exactly one mount', () => {
    expect(table).toContain("import { RecapTrickReview } from './TrickBrowser';");
    expect(table).toContain('trickReview={<RecapTrickReview key={st.handNo} tricks={piles} face={face} />}');
    // one door only: the import plus the single mount, never a second entry
    expect(table.split('RecapTrickReview').length - 1).toBe(2);
  });

  it('the entry renders in the recap HEADER — the top of the sheet, ahead of the body', () => {
    expect(intermission).toContain('{trickReview}');
    expect(intermission.indexOf('{trickReview}')).toBeGreaterThan(intermission.indexOf('tt-head'));
    expect(intermission.indexOf('{trickReview}')).toBeLessThan(intermission.indexOf('tt-body'));
    // and never in the body's flow again (the bottom siting is what clipped)
    expect(intermission.slice(intermission.indexOf('tt-body'))).not.toContain('{trickReview}');
  });

  it('the removed Run It recap pill cannot creep back (owner 2026-10-26)', () => {
    expect(intermission).not.toContain('runReview');
    expect(table).not.toContain('Review last trick');
    expect(table).not.toContain('talk-run');
    expect(table).not.toContain('clearedOpen');
    expect(css).not.toMatch(/\.tt-run(-show)?\s*\{/);
  });

  it('the header siting is styled: the header wraps, the pill keeps the tap floor, the browser keeps its measure', () => {
    expect(css).toContain('.tt-head { flex-wrap: wrap; }');
    expect(css).toContain('.tt-head > .tt-tricks-show { flex: none; }');
    expect(css).toContain('.tt-head > .tt-tricks { flex: 1 1 100%;');
    expect(css).toContain('.tt-head > .tt-tricks > .trick-browser { flex: none; width: min(520px, 100%); }');
    // phone widths: the pill takes its own full-width line under the title row,
    // and flex order keeps the chat button on the title row beside the title
    expect(css).toContain('.tt-head > .tt-tricks-show { flex: 1 1 100%; margin-top: 2px; order: 2; }');
    expect(css).toContain('.tt-head .tt-chat-btn { order: 1; }');
    expect(css).toContain('justify-content: center; order: 2; }');
    // the pill's own rules are byte-identical to its in-flow siting (44px floor)
    expect(css).toContain('.tt-tricks { margin: 2px 0 4px; align-self: center; width: min(520px, 100%); }');
    expect(css).toContain('.tt-tricks-show { align-self: center;');
    expect(css).toContain('.tt-tricks-show { align-self: center; margin: 0; padding: 6px 14px; min-height: 44px;');
    // neither body grid carries a tricks/run area anymore — the rail reflows clean
    expect(css).not.toContain('grid-area: tricks');
    expect(css).not.toContain('grid-area: run');
    expect(css).not.toContain('"run run"');
  });
});
