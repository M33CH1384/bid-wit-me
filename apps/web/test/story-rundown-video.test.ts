/**
 * @vitest-environment happy-dom
 *
 * Dee's Rundown FILM (first-visit solo rundowns): the video-vs-fallback
 * decision, heard/skip, muted and reduced-effects behaviour, the game
 * audio hold, and the no-precache guard.
 */
import { readFileSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coopRundownFor, RUNDOWN_FIRST, RUNDOWN_KING_LEG2, RUNDOWN_RETURN_CLEAR, RUNDOWN_RETURN_LOSS } from '@spades/bots';
import DeeRundownPanel from '../src/story/DeeRundown';
import { RUNDOWN_VIDEOS, pickRundownVideo, resetRundownVideoFailures, rundownVideoPlayback, markRundownVideoFailed } from '../src/story/rundownVideo';
import { talkPrefs } from '../src/talkPrefs';
import { sound } from '../src/audio';
import { fx } from '../src/fx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const STOPS = ['porch', 'barbershop', 'rec-center', 'cookout', 'corner', 'church-basement', 'rooftop', 'high-rise', 'the-pjs', 'legends', 'king'];
const first = (stopId: string) => ({ stopId, variant: 'first', text: RUNDOWN_FIRST[stopId]! });

describe('selection: video vs the text + voice fallback', () => {
  beforeEach(() => resetRundownVideoFailures());
  it('the manifest covers exactly the 11 first-visit rundowns, verbatim', () => {
    expect(Object.keys(RUNDOWN_VIDEOS).sort()).toEqual([...STOPS].sort());
    for (const id of STOPS) {
      const e = RUNDOWN_VIDEOS[id]!;
      expect(e.variant).toBe('first');
      expect(e.voice).toBe('lilcuz-f');
      expect(e.text.replace(/\s+/g, ' ').trim()).toBe(RUNDOWN_FIRST[id]!.replace(/\s+/g, ' ').trim());
    }
  });
  it('every first-visit line picks its film when the device plays MP4', () => {
    for (const id of STOPS) expect(pickRundownVideo(first(id), { canPlay: true })?.file).toBe(RUNDOWN_VIDEOS[id]!.file);
  });
  it('return-after-loss / return-after-clear / King leg 2 keep the text panel', () => {
    for (const id of STOPS) {
      expect(pickRundownVideo({ stopId: id, variant: 'returnLoss', text: RUNDOWN_RETURN_LOSS[id]! }, { canPlay: true })).toBeNull();
      expect(pickRundownVideo({ stopId: id, variant: 'returnClear', text: RUNDOWN_RETURN_CLEAR[id]! }, { canPlay: true })).toBeNull();
    }
    expect(pickRundownVideo({ stopId: 'king', variant: 'kingLeg2', text: RUNDOWN_KING_LEG2 }, { canPlay: true })).toBeNull();
  });
  it('co-op pair lines keep the text panel', () => {
    let n = 0;
    for (const id of STOPS) for (const c of ['a', 'b', 'e'] as const) {
      const l = coopRundownFor(id, c as never, { attempts: 1, clears: 0 });
      if (l) { n++; expect(pickRundownVideo(l, { canPlay: true })).toBeNull(); }
    }
    expect(n).toBeGreaterThan(0);
  });
  it('no MP4 support, a missing entry, a changed script or a failed file all fall back', () => {
    expect(pickRundownVideo(first('porch'), { canPlay: false })).toBeNull();
    expect(pickRundownVideo({ stopId: 'nowhere', variant: 'first', text: 'x' }, { canPlay: true })).toBeNull();
    expect(pickRundownVideo({ ...first('porch'), text: 'a rewritten script' }, { canPlay: true })).toBeNull();
    markRundownVideoFailed(RUNDOWN_VIDEOS['porch']!.file);
    expect(pickRundownVideo(first('porch'), { canPlay: true })).toBeNull();
    expect(pickRundownVideo(first('cookout'), { canPlay: true })).not.toBeNull();
  });
  it('playback plan: muted when voices are off, no autoplay when reduced / heard / map path', () => {
    expect(rundownVideoPlayback({ autoplayPath: true, reduced: false, heard: false, voicesOff: false })).toEqual({ muted: false, autoplay: true });
    expect(rundownVideoPlayback({ autoplayPath: true, reduced: false, heard: false, voicesOff: true })).toEqual({ muted: true, autoplay: true });
    expect(rundownVideoPlayback({ autoplayPath: true, reduced: true, heard: false, voicesOff: false }).autoplay).toBe(false);
    expect(rundownVideoPlayback({ autoplayPath: true, reduced: false, heard: true, voicesOff: false }).autoplay).toBe(false);
    expect(rundownVideoPlayback({ autoplayPath: false, reduced: false, heard: false, voicesOff: false }).autoplay).toBe(false);
  });
});

describe('the film panel', () => {
  let root: Root | null = null; let el: HTMLDivElement | null = null;
  let playSpy: ReturnType<typeof vi.fn>;
  const mount = async (autoplay = true) => {
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => { root!.render(createElement(DeeRundownPanel, { rundown: first('porch'), track: 'solo', autoplay })); });
  };
  const q = (id: string) => el!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const video = () => el!.querySelector('video') as HTMLVideoElement;
  beforeEach(() => {
    localStorage.clear(); resetRundownVideoFailures();
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    playSpy = vi.fn(function (this: HTMLVideoElement) { this.dispatchEvent(new Event('play')); return Promise.resolve(); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playSpy as never);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLVideoElement) { this.dispatchEvent(new Event('pause')); });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
  });
  afterEach(() => {
    if (root) act(() => root!.unmount()); root = null; el?.remove(); el = null;
    vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
    talkPrefs.set({ voices: true }); fx.setReduce(false); sound.holdForVideo(false);
  });

  it('first visit renders the film: poster, playsInline, preload none, minimal controls', async () => {
    await mount(false);
    expect(q('dee-rundown')!.getAttribute('data-mode')).toBe('video');
    const v = video();
    expect(v.getAttribute('preload')).toBe('none');
    expect(v.hasAttribute('playsinline')).toBe(true);
    expect(v.getAttribute('poster')).toBe('/story/rundowns/' + RUNDOWN_VIDEOS['porch']!.poster);
    expect(q('dee-rundown-skip')).toBeTruthy();
    expect(playSpy).not.toHaveBeenCalled(); // map path: no autoplay
  });

  it('sit-down path autoplays once and holds the game audio while it plays', async () => {
    await mount(true);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(sound.videoHeld).toBe(true);
    await act(async () => { q('dee-rundown-video-pause')!.click(); });
    expect(sound.videoHeld).toBe(false);
  });

  it('Skip marks the variant heard in the shared seen store and releases audio', async () => {
    await mount(true);
    await act(async () => { q('dee-rundown-skip')!.click(); });
    expect(JSON.parse(localStorage.getItem('bwm.rundownSeen.v1') ?? '[]')).toContain('solo|porch|first');
    expect(sound.videoHeld).toBe(false);
  });

  it('the film ending marks it heard too', async () => {
    await mount(false);
    await act(async () => { video().dispatchEvent(new Event('ended')); });
    expect(JSON.parse(localStorage.getItem('bwm.rundownSeen.v1') ?? '[]')).toContain('solo|porch|first');
  });

  it('voices off: plays muted (burned-in captions) and leaves the game audio alone', async () => {
    talkPrefs.set({ voices: false });
    await mount(true);
    expect(q('dee-rundown-video')!.getAttribute('data-muted')).toBe('yes');
    expect(video().muted).toBe(true);
    expect(sound.videoHeld).toBe(false);
  });

  it('reduced effects: no autoplay, a Play button over the poster', async () => {
    fx.setReduce(true);
    await mount(true);
    expect(playSpy).not.toHaveBeenCalled();
    expect(q('dee-rundown-video-play')).toBeTruthy();
  });

  it('a load error falls back to the existing text + voice panel', async () => {
    await mount(false);
    await act(async () => { video().dispatchEvent(new Event('error')); });
    expect(el!.querySelector('video')).toBeNull();
    expect(el!.querySelector('.dee-rundown-text')).toBeTruthy();
  });
});

describe('shipping guards', () => {
  it('each film stays far under the Pages 25 MB per-file limit', () => {
    for (const id of STOPS) {
      const sz = statSync(`apps/web/public/story/rundowns/${RUNDOWN_VIDEOS[id]!.file}`).size;
      expect(sz).toBeLessThan(25 * 1024 * 1024);
    }
  });
  it('the service worker precaches nothing (push-only), so the MP4s are never pulled offline', () => {
    const sw = readFileSync('apps/web/public/sw.js', 'utf8');
    expect(sw).not.toMatch(/caches\.|precache|addEventListener\('fetch'/);
  });
});
