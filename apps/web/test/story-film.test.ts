/**
 * @vitest-environment happy-dom
 *
 * Story film, Chapter 1 (the Porch): manifest integrity, the seen
 * store, manifest-driven scene selection (win vs loss branch, replay
 * no-double-advance, resume-era guards), the placeholder player's
 * chrome, and the StoryHome wiring pins. Footage does not exist yet —
 * every scene is 'to-generate' and the player presents labeled
 * posters; these tests pin that honesty as well.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILM_SCENES, STORY_FILM_CHAPTER, filmSceneById, FILM_SPEAKER_NAMES } from '../src/story/storyFilmManifest';
import {
  pickTeaser, pickPregame, pickPostScene, pickPreview, filmPlayback,
  markFilmSceneFailed, filmSceneFailed, resetFilmSceneFailures,
} from '../src/story/storyFilm';
import {
  FILM_SEEN_KEY, emptyFilmSeen, parseFilmSeen, loadFilmSeen, storeFilmSeen,
  isFilmKeySeen, markFilmKeySeen, offeredGameId, markFilmOffered, type FilmSeenState,
} from '../src/story/storyFilmSeen';
import StoryFilmScene from '../src/story/StoryFilmScene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const freshSeen = (): FilmSeenState => emptyFilmSeen('user-1');

/* ------------------------------------------------------------------ */
/* Manifest integrity                                                  */
/* ------------------------------------------------------------------ */

describe('chapter 1 film manifest', () => {
  it('is the Porch chapter with the Barbershop next, five scenes in flow order', () => {
    expect(STORY_FILM_CHAPTER.chapterId).toBe('ch1-porch');
    expect(STORY_FILM_CHAPTER.stopId).toBe('porch');
    expect(STORY_FILM_CHAPTER.nextStopId).toBe('barbershop');
    expect(FILM_SCENES.map((s) => s.id)).toEqual(['ch1-teaser', 'ch1-pregame', 'ch1-postwin', 'ch1-postloss', 'ch1-preview']);
    expect(FILM_SCENES.map((s) => s.type)).toEqual(['teaser', 'pregame', 'post-win', 'post-loss', 'next-match-preview']);
  });

  it('every scene is honestly to-generate (footage awaits the owner spend approval)', () => {
    for (const s of FILM_SCENES) {
      expect(s.assets.status).toBe('to-generate');
      expect(s.assets.video).toBe(`/story/film/ch1/${s.id}.mp4`);
      expect(s.assets.poster).toBe(`/story/film/ch1/${s.id}-poster.webp`);
      expect(s.assets.subtitles).toBe(`/story/film/ch1/${s.id}.vtt`);
    }
  });

  it('fallback modes match the manifest: teaser/preview none, the rest the shipped beats', () => {
    expect(filmSceneById('ch1-teaser')!.fallback).toEqual({ mode: 'none' });
    expect(filmSceneById('ch1-preview')!.fallback).toEqual({ mode: 'none' });
    expect(filmSceneById('ch1-pregame')!.fallback).toEqual({ mode: 'scriptPlayer', beatsKind: 'intro' });
    expect(filmSceneById('ch1-postwin')!.fallback).toEqual({ mode: 'scriptPlayer', beatsKind: 'outroWin' });
    expect(filmSceneById('ch1-postloss')!.fallback).toEqual({ mode: 'scriptPlayer', beatsKind: 'outroLose' });
  });

  it('cues are ordered, inside the scene duration, and every speaker is a named cast member', () => {
    for (const s of FILM_SCENES) {
      expect(s.lines.length).toBeGreaterThan(0);
      let prev = 0;
      for (const c of s.lines) {
        expect(c.cueStart).toBeGreaterThanOrEqual(prev);
        expect(c.cueEnd).toBeGreaterThan(c.cueStart);
        expect(c.cueEnd).toBeLessThanOrEqual(s.durationTargetSeconds);
        expect(FILM_SPEAKER_NAMES[c.speaker]).toBeTruthy();
        prev = c.cueStart;
      }
    }
  });

  it('the WebVTT sidecars on disk carry exactly the manifest lines, speaker-prefixed', () => {
    for (const s of FILM_SCENES) {
      const vtt = readFileSync(`apps/web/public/story/film/ch1/${s.id}.vtt`, 'utf8');
      expect(vtt.startsWith('WEBVTT')).toBe(true);
      const spoken = [...vtt.matchAll(/<v ([^>]+)>([^<]+)<\/v>/g)].map((m) => `${m[1]}: ${norm(m[2]!)}`);
      expect(spoken).toEqual(s.lines.map((c) => `${FILM_SPEAKER_NAMES[c.speaker]}: ${norm(c.text)}`));
    }
  });
});

/* ------------------------------------------------------------------ */
/* Seen store                                                          */
/* ------------------------------------------------------------------ */

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    raw: () => m.get(FILM_SEEN_KEY) ?? null,
  };
}

describe('film seen store (bwm.storyFilm.v1)', () => {
  it('round-trips seen keys and offered gameIds', () => {
    const st = fakeStorage();
    const s = emptyFilmSeen('user-1');
    markFilmKeySeen(s, 'film.ch1.teaser', 1234);
    markFilmOffered(s, 'ch1-postloss', 'story-abc');
    storeFilmSeen(s, st);
    const back = loadFilmSeen('user-1', st);
    expect(isFilmKeySeen(back, 'film.ch1.teaser')).toBe(true);
    expect(isFilmKeySeen(back, 'film.ch1.pregame')).toBe(false);
    expect(offeredGameId(back, 'ch1-postloss')).toBe('story-abc');
    expect(offeredGameId(back, 'ch1-postwin')).toBeNull();
  });

  it('is bound to the recording account: another account starts clean', () => {
    const st = fakeStorage();
    const s = emptyFilmSeen('user-1');
    markFilmKeySeen(s, 'film.ch1.teaser', 1);
    storeFilmSeen(s, st);
    const other = loadFilmSeen('user-2', st);
    expect(isFilmKeySeen(other, 'film.ch1.teaser')).toBe(false);
    expect(other.userId).toBe('user-2');
  });

  it('corrupt or foreign payloads read as empty, never throw', () => {
    expect(parseFilmSeen('{not json', 'user-1').seen).toEqual({});
    expect(parseFilmSeen('{"v":99}', 'user-1').seen).toEqual({});
    expect(parseFilmSeen(null, 'user-1').seen).toEqual({});
    expect(parseFilmSeen('{"v":1,"userId":"user-1","seen":{"film.ch1.teaser":"soon"},"offered":[]}', 'user-1').seen).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

describe('scene selection reads real game state only', () => {
  beforeEach(() => resetFilmSceneFailures());

  it('teaser: a fresh solo track at first map entry, once per track', () => {
    const seen = freshSeen();
    expect(pickTeaser({ track: 'solo', stopsCleared: 0, attemptsAtStop: 0 }, seen)?.id).toBe('ch1-teaser');
    expect(pickTeaser({ track: 'solo', stopsCleared: 1, attemptsAtStop: 0 }, seen)).toBeNull();
    expect(pickTeaser({ track: 'solo', stopsCleared: 0, attemptsAtStop: 1 }, seen)).toBeNull();
    expect(pickTeaser({ track: 'coop:x', stopsCleared: 0, attemptsAtStop: 0 }, seen)).toBeNull();
    markFilmKeySeen(seen, 'film.ch1.teaser', 1);
    expect(pickTeaser({ track: 'solo', stopsCleared: 0, attemptsAtStop: 0 }, seen)).toBeNull();
  });

  it('pregame: the first visit only — return visits (attempts >= 1) never select it', () => {
    const seen = freshSeen();
    expect(pickPregame({ track: 'solo', stopId: 'porch', attemptsAtStop: 0 }, seen)?.id).toBe('ch1-pregame');
    expect(pickPregame({ track: 'solo', stopId: 'porch', attemptsAtStop: 1 }, seen)).toBeNull();
    expect(pickPregame({ track: 'solo', stopId: 'barbershop', attemptsAtStop: 0 }, seen)).toBeNull();
    markFilmKeySeen(seen, 'film.ch1.pregame', 1);
    expect(pickPregame({ track: 'solo', stopId: 'porch', attemptsAtStop: 0 }, seen)).toBeNull();
  });

  it('post-win: a first-clear win, keyed to the posted gameId — a replay win never selects it', () => {
    const seen = freshSeen();
    const base = { track: 'solo', stopId: 'porch' };
    expect(pickPostScene({ ...base, won: true, firstClear: true, gameId: 'story-g1' }, seen)?.id).toBe('ch1-postwin');
    // replay win: new gameId, stop already cleared -> the shipped coda's job
    expect(pickPostScene({ ...base, won: true, firstClear: false, gameId: 'story-g2' }, seen)).toBeNull();
    // re-entering the same outro (same gameId) never re-offers
    markFilmOffered(seen, 'ch1-postwin', 'story-g1');
    expect(pickPostScene({ ...base, won: true, firstClear: true, gameId: 'story-g1' }, seen)).toBeNull();
    // no posted result yet -> no scene
    expect(pickPostScene({ ...base, won: true, firstClear: true, gameId: null }, freshSeen())).toBeNull();
  });

  it('post-loss: every completed loss is a real event, but never twice for one gameId', () => {
    const seen = freshSeen();
    const base = { track: 'solo', stopId: 'porch', firstClear: false };
    expect(pickPostScene({ ...base, won: false, gameId: 'story-g1' }, seen)?.id).toBe('ch1-postloss');
    markFilmOffered(seen, 'ch1-postloss', 'story-g1');
    expect(pickPostScene({ ...base, won: false, gameId: 'story-g1' }, seen)).toBeNull();
    expect(pickPostScene({ ...base, won: false, gameId: 'story-g2' }, seen)?.id).toBe('ch1-postloss');
    expect(pickPostScene({ ...base, won: true, firstClear: true, gameId: 'story-g3' }, seen)?.id).toBe('ch1-postwin');
  });

  it('preview: the first-clear exit path only — never after a loss, a replay, or twice', () => {
    const seen = freshSeen();
    const base = { track: 'solo', stopId: 'porch', clearsAtStop: 1 };
    expect(pickPreview({ ...base, won: true, firstClear: true }, seen)?.id).toBe('ch1-preview');
    expect(pickPreview({ ...base, won: false, firstClear: false }, seen)).toBeNull();
    expect(pickPreview({ ...base, won: true, firstClear: false }, seen)).toBeNull();
    expect(pickPreview({ ...base, won: true, firstClear: true, clearsAtStop: 0 }, seen)).toBeNull();
    markFilmKeySeen(seen, 'film.ch1.preview', 1);
    expect(pickPreview({ ...base, won: true, firstClear: true }, seen)).toBeNull();
  });

  it('a scene that failed this session is not retried; its siblings are unaffected', () => {
    const seen = freshSeen();
    markFilmSceneFailed('ch1-pregame');
    expect(filmSceneFailed('ch1-pregame')).toBe(true);
    expect(pickPregame({ track: 'solo', stopId: 'porch', attemptsAtStop: 0 }, seen)).toBeNull();
    expect(pickTeaser({ track: 'solo', stopsCleared: 0, attemptsAtStop: 0 }, seen)?.id).toBe('ch1-teaser');
  });

  it('playback plan: voices off mutes; reduced effects never autoplays', () => {
    expect(filmPlayback({ autoplayPath: true, reduced: false, voicesOff: false })).toEqual({ muted: false, autoplay: true });
    expect(filmPlayback({ autoplayPath: true, reduced: true, voicesOff: false })).toEqual({ muted: false, autoplay: false });
    expect(filmPlayback({ autoplayPath: false, reduced: false, voicesOff: true })).toEqual({ muted: true, autoplay: false });
  });
});

/* ------------------------------------------------------------------ */
/* Placeholder player chrome                                           */
/* ------------------------------------------------------------------ */

describe('StoryFilmScene placeholder presentation (no footage exists yet)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shows the poster, a PLACEHOLDER badge, captions, and a working skip', () => {
    const scene = filmSceneById('ch1-teaser')!;
    const done = vi.fn();
    act(() => {
      root.render(createElement(StoryFilmScene, { scene, voicesOff: false, reduced: false, mode: 'hook', onDone: done }));
    });
    const el = container.querySelector('[data-testid="story-film-ch1-teaser"]');
    expect(el).toBeTruthy();
    expect(el!.getAttribute('data-placeholder')).toBe('yes');
    expect(container.textContent).toContain('PLACEHOLDER');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(scene.assets.poster);
    const skip = container.querySelector('[data-testid="story-film-skip"]') as HTMLButtonElement;
    expect(skip).toBeTruthy();
    act(() => skip.click());
    expect(done).toHaveBeenCalledWith('skipped');
  });

  it('reduced effects: no autoplay — a Play button stands over the poster', () => {
    const scene = filmSceneById('ch1-pregame')!;
    act(() => {
      root.render(createElement(StoryFilmScene, { scene, voicesOff: false, reduced: true, mode: 'hook', onDone: () => {} }));
    });
    const el = container.querySelector('[data-testid="story-film-ch1-pregame"]')!;
    expect(el.getAttribute('data-autoplay')).toBe('no');
    expect(container.querySelector('[data-testid="story-film-play"]')).toBeTruthy();
  });

  it('plays its cues on a timer and lands on an end card with Replay', () => {
    const scene = filmSceneById('ch1-postloss')!;
    const done = vi.fn();
    act(() => {
      root.render(createElement(StoryFilmScene, { scene, voicesOff: true, reduced: false, mode: 'hook', onDone: done }));
    });
    // first cue (L-D01 at 3.5s): advance past it while playing
    act(() => { vi.advanceTimersByTime(4200); });
    expect(container.textContent).toContain("Don't make it gentle.");
    // run the scene out -> end card, not an auto-advance
    act(() => { vi.advanceTimersByTime(scene.durationTargetSeconds * 1000); });
    expect(done).not.toHaveBeenCalled();
    const replay = container.querySelector('[data-testid="story-film-replay"]') as HTMLButtonElement;
    expect(replay).toBeTruthy();
    const cont = container.querySelector('[data-testid="story-film-continue"]') as HTMLButtonElement;
    act(() => cont.click());
    expect(done).toHaveBeenCalledWith('ended');
  });
});

/* ------------------------------------------------------------------ */
/* Wiring pins                                                         */
/* ------------------------------------------------------------------ */

describe('StoryHome wiring follows the shipped video discipline', () => {
  const home = readFileSync('apps/web/src/story/StoryHome.tsx', 'utf8');
  const player = readFileSync('apps/web/src/story/StoryFilmScene.tsx', 'utf8');

  it('StoryHome selects from the manifest module and mounts the film player at all four hooks', () => {
    expect(home).toContain("from './storyFilm'");
    expect(home).toContain('pickTeaser');
    expect(home).toContain('pickPregame');
    expect(home).toContain('pickPostScene');
    expect(home).toContain('pickPreview');
    expect(home).toContain('StoryFilmScene');
  });

  it('the player is poster-first, preload none, holds game audio, and session-fails on error', () => {
    expect(player).toContain('preload="none"');
    expect(player).toContain('poster=');
    expect(player).toContain('holdForVideo');
    expect(player).toContain('markFilmSceneFailed');
    expect(player).toContain('playsInline');
  });
});
