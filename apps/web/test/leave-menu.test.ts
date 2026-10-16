import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leaveChoice, leaveMenuAction, type LeaveGesture } from '../src/leaveMenu';

const idle = (): LeaveGesture => ({ armed: false, actedAt: 0 });

describe('leave menu', () => {
  it('leaves immediately online and after the game, and confirms an offline game in progress', () => {
    expect(leaveChoice(true, 'playing')).toBe('leave');
    expect(leaveChoice(true, 'bidding')).toBe('leave');
    expect(leaveChoice(false, 'gameOver')).toBe('leave');
    expect(leaveChoice(false, 'playing')).toBe('confirm');
    expect(leaveChoice(false, 'bidding')).toBe('confirm');
    expect(leaveChoice(false, 'handOver')).toBe('confirm');
  });

  it('leaves when the click lands on the scrim after the pointer went down on Leave', () => {
    const armed: LeaveGesture = { armed: true, actedAt: 0 };
    expect(leaveMenuAction({ type: 'pointerdown' }, 'leave', idle(), 1000)).toBe('arm');
    expect(leaveMenuAction({ type: 'pointerup', pointerType: 'touch' }, 'scrim', armed, 1100)).toBe('leave');
    expect(leaveMenuAction({ type: 'click' }, 'scrim', { armed: true, actedAt: 1100 }, 1110)).toBe('ignore');
    expect(leaveMenuAction({ type: 'click' }, 'scrim', armed, 1100)).toBe('leave');
  });

  it('closes on a scrim tap that did not start on Leave', () => {
    expect(leaveMenuAction({ type: 'pointerdown' }, 'scrim', idle(), 1000)).toBe('disarm');
    expect(leaveMenuAction({ type: 'click' }, 'scrim', idle(), 1100)).toBe('close');
    expect(leaveMenuAction({ type: 'pointerup', pointerType: 'mouse' }, 'scrim', idle(), 1100)).toBe('ignore');
  });

  it('leaves on pointerup and ignores the click that follows, including a mouse', () => {
    const armed: LeaveGesture = { armed: true, actedAt: 0 };
    expect(leaveMenuAction({ type: 'pointerup', pointerType: 'mouse' }, 'leave', armed, 2000)).toBe('leave');
    expect(leaveMenuAction({ type: 'click' }, 'leave', { armed: false, actedAt: 2000 }, 2050)).toBe('ignore');
    expect(leaveMenuAction({ type: 'click' }, 'leave', idle(), 3000)).toBe('leave');
  });

  it('wires the menu item and the scrim through that gesture', () => {
    const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(src).toContain('data-testid="menu-leave"');
    expect(src).toContain('leaveMenuAction');
    expect(src).toContain('leaveChoice');
    expect(src).not.toContain('onClick={() => setMenuOpen(false)}');
  });

  it('sends an online Leave straight to the home menu', () => {
    const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('const leave = () =>'), src.indexOf('const leaveGesture'));
    expect(fn).toContain('if (!online)');
    expect(fn).toContain('onExit()');
    expect(fn).toContain('(onMainMenu ?? onExit)()');
    expect(fn.indexOf('if (!online)')).toBeLessThan(fn.indexOf('(onMainMenu ?? onExit)()'));
  });
});
