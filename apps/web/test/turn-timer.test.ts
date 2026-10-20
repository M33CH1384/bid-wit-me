/**
 * @vitest-environment happy-dom
 *
 * The collapsed settings row and the expanded Edit row both save the timer.
 * Play is the longer clock for Relaxed, Normal, Fast, and the default table.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { TURN_TIMERS, TurnTimerSelect, rulesWithTimer, timerSettingLabel, type TimerKey } from '../src/turnTimer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function HostTimers() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<TimerKey>('normal');
  return createElement('details', {
    open,
    onToggle: (e: { currentTarget: HTMLDetailsElement }) => setOpen(e.currentTarget.open),
  },
    createElement('summary', { 'data-testid': 'settings-row' },
      createElement(TurnTimerSelect, { value: picked, onChange: setPicked, testId: 'lobby-timer' }),
      createElement('span', { className: 'sr-edit' }, open ? 'Done' : 'Edit'),
    ),
    createElement(TurnTimerSelect, { value: picked, onChange: setPicked, testId: 'lobby-timer-edit' }),
    createElement('output', { 'data-testid': 'saved' }, `${picked}:${TURN_TIMERS[picked].bid}/${TURN_TIMERS[picked].play}`),
  );
}

describe('turn timer presets', () => {
  it('pins bid and play for Relaxed, Normal, Fast, and the default', () => {
    expect(TURN_TIMERS).toEqual({
      relaxed: { bid: 30, play: 45 },
      normal: { bid: 30, play: 30 },
      fast: { bid: 10, play: 15 },
    });
    for (const t of Object.values(TURN_TIMERS)) expect(t.play).toBeGreaterThan(t.bid);
    expect(makeRules('joker').turnTimerSec).toEqual(TURN_TIMERS.normal);
    expect(makeRules('aceDown').turnTimerSec).toEqual(TURN_TIMERS.normal);
    expect(makeRules('cutthroat').turnTimerSec).toEqual(TURN_TIMERS.normal);
    expect(rulesWithTimer(makeRules('joker'), 'relaxed').turnTimerSec).toEqual(TURN_TIMERS.relaxed);
    expect(timerSettingLabel(TURN_TIMERS.relaxed)).toBe('Relaxed · bid 30s / play 45s');
    expect(timerSettingLabel({ bid: 12, play: 40 })).toBe('Custom · bid 12s / play 40s');
  });

  it('the lobby saves the header timer while Edit is collapsed, and the one inside Edit', () => {
    const src = readFileSync(join(process.cwd(), 'apps/web/src/online/Lobby.tsx'), 'utf8');
    const summary = src.slice(src.indexOf('data-testid="settings-row"'), src.indexOf('</summary>'));
    expect(summary).toContain('testId="lobby-timer"');
    expect(summary).toContain('onTimer');
    const edit = src.slice(src.indexOf('lobby-timer-edit') - 200, src.indexOf('lobby-timer-edit') + 40);
    expect(edit).toContain('onTimer');
  });
});

describe('collapsed timer choice', () => {
  let root: Root;
  afterEach(() => { act(() => root?.unmount()); });

  it('saves Relaxed from the closed row, and Fast after Edit is open', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => { root.render(createElement(HostTimers)); });
    const details = el.querySelector('details')!;
    expect(details.open).toBe(false);
    const closed = el.querySelector('[data-testid="lobby-timer"]') as HTMLSelectElement;
    act(() => {
      closed.value = 'relaxed';
      closed.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(el.querySelector('[data-testid="saved"]')!.textContent).toBe('relaxed:30/45');
    expect(details.open).toBe(false);
    act(() => { (el.querySelector('summary') as HTMLElement).click(); });
    expect(details.open).toBe(true);
    const opened = el.querySelector('[data-testid="lobby-timer-edit"]') as HTMLSelectElement;
    act(() => {
      opened.value = 'fast';
      opened.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(el.querySelector('[data-testid="saved"]')!.textContent).toBe('fast:10/15');
  });
});
