/**
 * @vitest-environment happy-dom
 *
 * The King's double or nothing (web, 2026-10-21): the map shows the
 * pending state in words, the King card carries the doubled payoff, and
 * the Tale of the Tape states the terms before leg 1 — the rule is
 * never a surprise, and a live double reads as one.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS, storyStopById, type StoryBeatFacts } from '@spades/bots';
import StoryHome from '../src/story/StoryHome';
import StoryTape from '../src/story/StoryTape';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  roots.push(root);
  await act(async () => { root.render(el); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return c;
}
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
});

const king = storyStopById('king')!;

function stubProgress(kingRow: Record<string, unknown>) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, unlocks: [] }) };
    if (url.includes('/api/story/progress')) return {
      ok: true, status: 200,
      json: async () => ({
        track: 'solo', currentStop: 11, completed: false, completedAt: null, completionMark: null,
        finds: { eggs: [], feats: [] },
        stops: STORY_STOPS.map((s) => (s.id === 'king'
          ? { stopId: s.id, n: s.n, state: 'current', attempts: 0, clears: 0, firstClearedAt: null, doublePending: false, ...kingRow }
          : { stopId: s.id, n: s.n, state: 'cleared', attempts: 1, clears: 1, firstClearedAt: 1, doublePending: false })),
      }),
    };
    throw new Error(`no network in tests: ${url}`);
  });
}

describe("the King's double or nothing — the map", () => {
  it('a live double reads in words: pending line, DOUBLE OR NOTHING chip, Finish the double', async () => {
    stubProgress({ attempts: 1, doublePending: true });
    const c = await renderEl(createElement(StoryHome));
    const card = c.querySelector('[data-testid="story-stop-king"]')!;
    expect(card).toBeTruthy();
    expect(c.querySelector('[data-testid="story-double-pending"]')!.textContent)
      .toBe('You beat him once — double or nothing: one more win takes the crown.');
    expect(card.querySelector('.story-card-state')!.textContent).toBe('DOUBLE OR NOTHING');
    expect(c.querySelector('[data-testid="story-play-king"]')!.textContent).toBe('Finish the double');
  });

  it('before leg 1: no pending line, plain Play — but the card already carries the doubled payoff and the terms', async () => {
    stubProgress({ attempts: 0, doublePending: false });
    const c = await renderEl(createElement(StoryHome));
    const card = c.querySelector('[data-testid="story-stop-king"]')!;
    expect(c.querySelector('[data-testid="story-double-pending"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-play-king"]')!.textContent).toBe('Play');
    const twist = card.querySelector('.story-stop-twist')!.textContent!;
    expect(twist).toContain('Double or nothing');
    expect(twist).toContain('+550 XP');
    expect(twist).toContain('+440 coins');
  });
});

describe("the King's double or nothing — the tape", () => {
  it('states the terms before leg 1', async () => {
    const facts: StoryBeatFacts = { attempts: 0, cleared: false };
    const c = await renderEl(createElement(StoryTape, { stop: king, facts, cta: 'Go', onDone: () => {} }));
    expect(c.textContent).toContain('The terms');
    expect(c.textContent).toContain('beat the King twice in a row — double or nothing');
  });

  it('while pending, the tape history says the double is live', async () => {
    const facts: StoryBeatFacts & { doublePending?: boolean } = { attempts: 1, cleared: false, doublePending: true };
    const c = await renderEl(createElement(StoryTape, { stop: king, facts, cta: 'Go', onDone: () => {} }));
    expect(c.querySelector('[data-testid="story-tape-history"]')!.textContent).toContain('the double is live');
    expect(c.textContent).toContain('already banked');
  });
});
