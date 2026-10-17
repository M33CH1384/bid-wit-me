/**
 * @vitest-environment happy-dom
 *
 * Opening the app with an unfinished bot game shows the menu. The save is left
 * unused. Deal me in starts a new series at 0–0.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction, newGame, pendingTurn, viewFor, type GameState, type Series } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import App from '../src/App';
import { loadSeries, saveSeries } from '../src/Series';
import { SAVE_KEY, SAVE_VERSION } from '../src/save';
import { DEFAULT_SETTINGS, settingsToRules } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function step(st: GameState): GameState {
  const t = pendingTurn(st);
  if (!t) return applyAction(st, { type: 'nextHand' });
  return applyAction(st, chooseBotAction(viewFor(st, t.seat))!);
}

function midHand(): GameState {
  let st = newGame(settingsToRules(DEFAULT_SETTINGS), 'home-fresh');
  for (let i = 0; i < 12 && st.phase !== 'playing'; i++) st = step(st);
  return st;
}

const SERIES: Series = {
  v: 1,
  key: 'joker|you+bot:2|bot:1+bot:3',
  mode: 'joker',
  sides: [
    { key: 'you+bot:2', members: ['you', 'bot:2'], name: 'Us' },
    { key: 'bot:1+bot:3', members: ['bot:1', 'bot:3'], name: 'Them' },
  ],
  wins: [0, 2],
  games: [],
};

describe('home starts fresh', () => {
  let root: Root;
  let el: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    el.remove();
    localStorage.clear();
  });

  it('shows the menu after a mid-hand save, and a new game starts at 0–0', async () => {
    const state = midHand();
    expect(state.phase).not.toBe('gameOver');
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION, savedAt: 1, seed: state.seed, settings: DEFAULT_SETTINGS, state, chat: [],
    }));
    saveSeries(SERIES);
    expect(loadSeries()?.wins).toEqual([0, 2]);

    await act(async () => { root.render(createElement(App)); });

    // founder menu rework: Home is Resume/Play only — opponent and mode are later doors
    expect(document.querySelector('[data-testid="play"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="play-bots"]')).toBeNull();
    expect(document.querySelector('[data-testid="play-online"]')).toBeNull();
    expect(document.querySelector('[data-testid="hand"]')).toBeNull();
    expect(document.body.textContent).not.toContain('RESUMING YOUR GAME');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();

    window.confirm = () => true; // Deal me in asks before replacing the save
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="play"]')!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="door-team"]')!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="mode-joker"]')!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="play-bots"]')!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="start-bots"]')!.click(); });

    expect(loadSeries()).toBeNull();
  });
});
