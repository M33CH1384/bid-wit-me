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
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Trick } from '@spades/rules';
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

  it('the recap receives the browser from the table, over the hand just played', () => {
    expect(table).toContain("import { RecapTrickReview } from './TrickBrowser';");
    expect(table).toContain('trickReview={<RecapTrickReview key={st.handNo} tricks={piles} face={face} />}');
    // the slot renders in the recap's scroll, after the Run It review, and the
    // Run It pill itself is untouched (its label is pinned by review-label.e2e.ts)
    expect(intermission).toContain('{runReview}');
    expect(intermission).toContain('{trickReview}');
    expect(intermission.indexOf('{runReview}')).toBeLessThan(intermission.indexOf('{trickReview}'));
    expect(table).toContain('>Review last trick</button>');
  });

  it('the recap styling mirrors the Run It review idiom and takes the desktop grid row', () => {
    expect(css).toContain('.tt-tricks { margin: 2px 0 4px; align-self: center; width: min(520px, 100%); }');
    expect(css).toContain('.tt-tricks-show { align-self: center;');
    expect(css).toContain('.tt-tricks { grid-area: tricks; width: 100%; }');
    expect(css).toContain('.tt-tricks-show { grid-area: tricks; justify-self: center; }');
    expect(css).toContain('"run run" "tricks tricks"');
  });
});
