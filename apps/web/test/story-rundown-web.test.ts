/**
 * @vitest-environment happy-dom
 *
 * Dee's Rundown, SOLO presentation (rundown spec §4):
 *  - variant selection at the tape: the panel carries the script
 *    rundownFor picks from fabricated progress facts (first-meet /
 *    return-after-loss / return-after-clear / King leg-2);
 *  - the sit-down path auto-plays her RECORDED clip once per
 *    (stop, variant) — the text reveals in step, Skip completes it
 *    and marks it heard, a heard panel opens whole with a replay;
 *  - the map's "Meet them" arrival never auto-plays: the panel opens
 *    whole with a tap-to-play button;
 *  - voices off → the static quote: full text, her sign-off, no
 *    controls at all;
 *  - no clip → text-only at the reading pace, and the robot is never
 *    consulted (the fence: Dee's panel reaches audio only through
 *    speakBot/spokenClipDurationMs with her own name — her cast
 *    sprite or silence).
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUNDOWN_FIRST, RUNDOWN_KING_LEG2, RUNDOWN_RETURN_CLEAR, RUNDOWN_RETURN_LOSS,
  STORY_STOPS, rundownFor, storyStopById,
} from '@spades/bots';
import DeeRundownPanel from '../src/story/DeeRundown';
import { fixedRevealMs } from '../src/story/ScriptPlayer';
import StoryTape from '../src/story/StoryTape';
import { talkPrefs } from '../src/talkPrefs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}
function mount(node: React.ReactNode) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  return act(async () => { root!.render(node as never); });
}
const settle = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const click = async (node: Element) => { await act(async () => { (node as HTMLElement).click(); }); await settle(10); };
const byTestid = (id: string) => el!.querySelector(`[data-testid="${id}"]`);
const textEl = () => el!.querySelector('.dee-rundown-text')!;

/** The lilcuz-f sprite manifest, stubbed identically for the whole
 *  file: voices.ts caches a sprite after its first load, so the
 *  manifest must never change mid-file. It carries ONE clip — the
 *  Porch first-meet at a round 60 s; every other rundown line
 *  resolves no clip (the text-only path). The audio file itself
 *  404s — the manifest alone answers the duration lookup, exactly
 *  as clipDurationMs documents. */
function stubFetch() {
  const clips = { [RUNDOWN_FIRST['porch']!]: [0, 60_000] as [number, number] };
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const u = String(input);
    if (u.includes('lilcuz-f.json')) {
      return new Response(JSON.stringify({ clips }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nope', { status: 404 });
  }));
}

beforeEach(() => { localStorage.clear(); stubFetch(); });
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
  talkPrefs.set({ voices: true });
});

const porch = storyStopById('porch')!;
const king = storyStopById('king')!;
const firstRundown = rundownFor(porch, { attempts: 0, cleared: false })!;

async function renderTape(stopId: string, facts: { attempts: number; cleared: boolean; doublePending?: boolean }) {
  const stop = storyStopById(stopId)!;
  await mount(createElement(StoryTape, {
    stop, facts: { ...facts, clears: facts.cleared ? 1 : 0 },
    cta: 'Play the scene', onDone: () => {},
    rundown: rundownFor(stop, facts), rundownTrack: 'solo',
  }));
  await settle(20);
  return byTestid('dee-rundown');
}

describe('variant selection at the solo tape (fabricated progress facts)', () => {
  it('first meet: attempts 0, not cleared → the first-meet script', async () => {
    const panel = await renderTape('porch', { attempts: 0, cleared: false });
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-label')).toBe(RUNDOWN_FIRST['porch']);
    expect(panel!.textContent).toContain('DEE’S RUNDOWN');
  });

  it('return after a loss: attempts ≥ 1, not cleared → the return-loss script', async () => {
    const panel = await renderTape('cookout', { attempts: 2, cleared: false });
    expect(panel!.getAttribute('aria-label')).toBe(RUNDOWN_RETURN_LOSS['cookout']);
  });

  it('return after a clear: cleared → the return-clear script', async () => {
    const panel = await renderTape('legends', { attempts: 3, cleared: true });
    expect(panel!.getAttribute('aria-label')).toBe(RUNDOWN_RETURN_CLEAR['legends']);
  });

  it('King leg 2: doublePending → the leg-2 piece, not a return variant', async () => {
    const panel = await renderTape('king', { attempts: 1, cleared: false, doublePending: true });
    expect(panel!.getAttribute('aria-label')).toBe(RUNDOWN_KING_LEG2);
  });

  it('every stop on the route renders its panel', async () => {
    for (const s of STORY_STOPS) {
      const panel = await renderTape(s.id, { attempts: 0, cleared: false });
      expect(panel, s.id).toBeTruthy();
      expect(panel!.getAttribute('aria-label'), s.id).toBe(RUNDOWN_FIRST[s.id]);
    }
  });
});

describe('the sit-down path: her recorded clip auto-plays once', () => {
  it('reveals in step with the clip; Skip completes it and marks it heard; a heard panel opens whole', async () => {
    await mount(createElement(DeeRundownPanel, { rundown: firstRundown, track: 'solo' }));
    await settle(60); // manifest resolves, playback starts
    expect(byTestid('dee-rundown-skip')).toBeTruthy();
    expect(textEl().textContent!.length).toBeLessThan(firstRundown.text.length); // still revealing with her voice
    await click(byTestid('dee-rundown-skip')!);
    expect(textEl().textContent).toBe(firstRundown.text);
    expect(localStorage.getItem('bwm.rundownSeen.v1')).toContain('solo|porch|first');
    // remount: heard → whole text immediately, replay offered, no auto-play
    await mount(createElement(DeeRundownPanel, { rundown: firstRundown, track: 'solo' }));
    await settle(30);
    expect(textEl().textContent).toBe(firstRundown.text);
    expect(byTestid('dee-rundown-replay')).toBeTruthy();
    expect(byTestid('dee-rundown-skip')).toBeNull();
  });
});

describe('a refused clip: the panel stops miming (2026-10-22 meet-them silence)', () => {
  it('falls back to the reading pace when the engine refuses the clip', async () => {
    // In this harness the Porch clip IS in the manifest (60 s) but its
    // audio 404s, so playClip resolves false — the same shape as the
    // owner's phone, where the clip resolved and the engine's table
    // gate refused it on the stand-alone tape. The panel used to pace
    // the whole reveal by the clip anyway: words moving, no sound.
    // Now the refusal re-paces the reveal to the reading pace.
    vi.useFakeTimers();
    try {
      await mount(createElement(DeeRundownPanel, { rundown: firstRundown, track: 'solo' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(120); }); // resolution + refusal land
      expect(byTestid('dee-rundown-skip')).toBeTruthy();
      const len = firstRundown.text.length;
      const reading = fixedRevealMs(len);
      // Half-way through the reading pace, far more text is up than
      // the 60 s clip pace would have shown by then.
      await act(async () => { await vi.advanceTimersByTimeAsync(Math.floor(reading / 2)); });
      expect(textEl().textContent!.length).toBeGreaterThan(len * 0.4);
      // And it completes at the reading pace — nowhere near 60 s.
      await act(async () => { await vi.advanceTimersByTimeAsync(Math.ceil(reading / 2) + 500); });
      expect(textEl().textContent).toBe(firstRundown.text);
      expect(byTestid('dee-rundown-replay')).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });
});

describe('the map arrival: tap-to-play, never an ambush', () => {
  it('opens whole with a play button; tapping it starts the synced reveal', async () => {
    await mount(createElement(DeeRundownPanel, { rundown: firstRundown, track: 'solo', autoplay: false }));
    await settle(60);
    expect(textEl().textContent).toBe(firstRundown.text); // whole from the start
    expect(byTestid('dee-rundown-skip')).toBeNull();
    const play = byTestid('dee-rundown-play');
    expect(play).toBeTruthy();
    expect(play!.textContent).toContain('Hear Dee read it');
    await click(play!);
    await settle(20);
    expect(byTestid('dee-rundown-skip')).toBeTruthy();
    expect(textEl().textContent!.length).toBeLessThan(firstRundown.text.length); // revealing again, with her
    await click(byTestid('dee-rundown-skip')!);
    expect(localStorage.getItem('bwm.rundownSeen.v1')).toContain('solo|porch|first');
  });
});

describe('voices off: the written words carry it', () => {
  it('static quote — full text, her sign-off, no controls, nothing auto-plays', async () => {
    talkPrefs.set({ voices: false });
    await mount(createElement(DeeRundownPanel, { rundown: firstRundown, track: 'solo' }));
    await settle(60);
    const panel = byTestid('dee-rundown')!;
    expect(panel.className).toContain('static');
    expect(textEl().textContent).toBe(firstRundown.text);
    expect(el!.querySelector('.dee-rundown-sign')?.textContent).toBe('— Dee');
    expect(byTestid('dee-rundown-skip')).toBeNull();
    expect(byTestid('dee-rundown-play')).toBeNull();
    expect(byTestid('dee-rundown-replay')).toBeNull();
  });
});

describe('no clip: text-only at the reading pace, fence intact', () => {
  it('reveals as text and completes; speech synthesis is never touched', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: () => {}, getVoices: () => [] });
    // A line with no take in the sprite (the stubbed manifest carries
    // only the Porch first-meet): the Cookout return-loss script.
    const unrecorded = rundownFor(storyStopById('cookout')!, { attempts: 1, cleared: false })!;
    await mount(createElement(DeeRundownPanel, { rundown: unrecorded, track: 'solo' }));
    await settle(80);
    const panel = byTestid('dee-rundown')!;
    expect(panel.className).not.toContain('static'); // voices are ON — this is the text reveal, not the quote
    expect(byTestid('dee-rundown-skip')).toBeTruthy();
    expect(textEl().textContent!.length).toBeLessThan(unrecorded.text.length);
    await click(byTestid('dee-rundown-skip')!);
    expect(textEl().textContent).toBe(unrecorded.text);
    expect(speak).not.toHaveBeenCalled();
  });

  it('the panel source reaches audio only through Dee’s own cast channel', () => {
    const src = readFileSync('apps/web/src/story/DeeRundown.tsx', 'utf8');
    expect(src).toContain("speakBot('Dee'");
    expect(src).toContain("spokenClipDurationMs('Dee'");
    expect(src).not.toContain('SpeechSynthesisUtterance');
    expect(src).not.toContain('playClip(');
  });
});
