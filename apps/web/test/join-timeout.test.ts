import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TableLoading } from '../src/TableLoading';
import { JOIN_TIMEOUT_MS, joinFaultLog, joinFaultMessage } from '../src/online/joinTimeout';
import { splashAction } from '../src/splashTap';

describe('rejoin loader timeout', () => {
  it('waits long enough for a slow 4G hello and not for a silent minute', () => {
    expect(JOIN_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(JOIN_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });

  it('says what failed: missing table, welcome without a state, a drop, or no socket', () => {
    expect(joinFaultMessage({ kind: 'missing', stage: 'socket', status: 'connecting' })).toMatch(/doesn't exist/);
    expect(joinFaultMessage({ kind: 'server', stage: 'welcome', status: 'open', serverCode: 'INTERNAL', serverMessage: 'Something went wrong' }))
      .toMatch(/game never came through/);
    expect(joinFaultMessage({ kind: 'server', stage: 'socket', status: 'connecting', serverCode: 'TABLE_FULL', serverMessage: 'This table is full' }))
      .toBe('This table is full');
    expect(joinFaultMessage({ kind: 'timeout', stage: 'socket', status: 'reconnecting', closeCode: 1006 })).toMatch(/kept dropping/);
    expect(joinFaultMessage({ kind: 'timeout', stage: 'ticket', status: 'connecting', ticketTimedOut: true })).toMatch(/Couldn't open/);
    const log = joinFaultLog('Y9QK6', { kind: 'timeout', stage: 'welcome', status: 'open', elapsedMs: 18000, serverCode: 'INTERNAL' });
    expect(log).toMatchObject({ code: 'Y9QK6', stage: 'welcome', elapsedMs: 18000, serverCode: 'INTERNAL' });
  });

  it('replaces the spinning loader with Retry and Back', () => {
    const html = renderToStaticMarkup(createElement(TableLoading, {
      fault: 'The table answered, but the game never came through.',
      onRetry: () => {},
      onBack: () => {},
    }));
    expect(html).toContain('data-testid="join-fault"');
    expect(html).toContain('Couldn&#x27;t join this table');
    expect(html).toContain('game never came through');
    expect(html).toContain('data-testid="join-retry"');
    expect(html).toContain('data-testid="join-back"');
    expect(html).not.toContain('data-testid="table-loading-tip"');
    expect(html).not.toContain('Shuffling the deck');
  });
});

describe('first splash tap after the tips prompt', () => {
  it('runs a touch pointerup and ignores the click that follows it', () => {
    expect(splashAction({ type: 'pointerup', pointerType: 'touch' }, 0, 1000)).toBe('run');
    expect(splashAction({ type: 'click' }, 1000, 1100)).toBe('ignore');
    expect(splashAction({ type: 'click' }, 1000, 2000)).toBe('run');
  });

  it('runs the first click on a fresh page, before any touch', () => {
    expect(splashAction({ type: 'click' }, 0, 50)).toBe('run');
    expect(splashAction({ type: 'click' }, 0, 700)).toBe('run');
  });

  it('leaves mouse and keyboard on the click', () => {
    expect(splashAction({ type: 'pointerup', pointerType: 'mouse' }, 0, 1000)).toBe('ignore');
    expect(splashAction({ type: 'click' }, 0, 1000)).toBe('run');
  });
});
