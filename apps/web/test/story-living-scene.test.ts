/**
 * @vitest-environment happy-dom
 *
 * Living scene (sample at the Porch 2026-10-24; owner's pick
 * 2026-10-25: living scene at EVERY stop, video later at the big
 * stops): the pre-match intro staged alive — backdrop light/air
 * layers + the seated pair LARGE in frame, speaker lit — driven by
 * ONE engine whose per-stop motion character is data (storyLiving's
 * mood table). Pins: every stop stages its own shipped pair against
 * its own shipped backdrop; speaker focus follows the beats; the
 * Porch renders with the sample's exact values; reduced effects (app
 * toggle OR OS setting) collapse the staging at every stop; the
 * wiring is exactly the two intro call-site classes (solo StoryHome
 * intro + co-op StoryRoom scene phase) — outros and the King finale
 * never receive the props; beats/skip behave as the static scene.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Source reads resolve from the repo root (the suites' run directory —
 *  the entry-flow.test.ts pattern); import.meta.url is not a file URL
 *  inside a happy-dom test body in this setup. */
const srcFile = (rel: string) => readFileSync(join(process.cwd(), 'apps/web/src/story', rel), 'utf8');
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS, storyPortraitFor, type StoryStop } from '@spades/bots';
import ScriptPlayer from '../src/story/ScriptPlayer';
import { storyBackdropUrl } from '../src/story/storyBackdrop';
import { LIVING_MOODS, PORCH_LIVING_MOOD, livingMoodFor, livingMoodVars } from '../src/story/storyLiving';
import { fx } from '../src/fx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  roots.push(root);
  await act(async () => { root.render(el); });
  return c;
}
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

const BEATS = [
  { speaker: 'uncleRay', line: 'First line, short.' },
  { speaker: 'pat', line: 'Second line, also short.' },
];
const CAST = ['uncleRay', 'dee', 'pat'];

function scene(props: Partial<React.ComponentProps<typeof ScriptPlayer>> = {}, onDone = () => {}) {
  return createElement(ScriptPlayer, {
    beats: BEATS,
    cta: 'To the table',
    onDone,
    bgUrl: '/assets/story/venues/porch.jpg',
    cast: CAST,
    ...props,
  });
}

/** A stop's intro exactly as the two call sites mount it. */
function stopScene(stop: StoryStop) {
  const [a, b] = stop.pair;
  return createElement(ScriptPlayer, {
    beats: [
      { speaker: a!, line: 'First line, short.' },
      { speaker: b!, line: 'Second line, also short.' },
    ],
    cta: 'To the table',
    onDone: () => {},
    bgUrl: storyBackdropUrl(stop),
    cast: [a!, 'dee', b!],
    living: true,
    livingMood: livingMoodFor(stop.id),
  });
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} }),
  });
}

beforeEach(() => {
  fx.setReduce(false);
  stubMatchMedia(false);
});
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
  localStorage.clear();
  fx.setReduce(false);
  stubMatchMedia(false);
});

describe('living scene — the staging renders', () => {
  it('Porch intro: backdrop layers alive, pair LARGE in frame, speaker lit', async () => {
    const c = await renderEl(scene({ living: true }));
    const root = c.querySelector('[data-testid="story-script"]')!;
    expect(root.className).toContain('living');

    // the animated environmental layers (light play + drifting air)
    expect(c.querySelector('.story-scene-glow')).not.toBeNull();
    expect(c.querySelector('.story-scene-haze')).not.toBeNull();
    // the shipped backdrop is still the layer underneath
    expect(c.querySelector('.story-scene-bg')).not.toBeNull();

    // the pair stands in frame; Dee (the guide) is NOT staged
    expect(c.querySelector('[data-testid="story-stage"]')).not.toBeNull();
    const ray = c.querySelector('[data-testid="story-stage-uncleRay"]')!;
    const pat = c.querySelector('[data-testid="story-stage-pat"]')!;
    expect(ray).not.toBeNull();
    expect(pat).not.toBeNull();
    expect(c.querySelector('[data-testid="story-stage-dee"]')).toBeNull();

    // their SHIPPED portrait art, not new images
    expect(ray.querySelector('img')?.getAttribute('src')).toBe('/assets/story/portraits/uncleRay.webp');
    expect(pat.querySelector('img')?.getAttribute('src')).toBe('/assets/story/portraits/pat.webp');

    // first beat is Ray's: he is lit, Pat dimmed
    expect(ray.getAttribute('data-active')).toBe('true');
    expect(pat.getAttribute('data-active')).toBe('false');
    expect(ray.className).toContain('active');
    expect(pat.className).toContain('dim');

    // the cast strip and letterbox are untouched by the staging
    expect(c.querySelectorAll('.story-bar')).toHaveLength(2);
    expect(c.querySelector('[data-testid="story-cast-uncleRay"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="story-cast-pat"]')).not.toBeNull();
  });

  it('the Porch with no mood passed renders the shipped sample exactly (mood + values)', async () => {
    const c = await renderEl(scene({ living: true }));
    const root = c.querySelector('[data-testid="story-script"]') as HTMLElement;
    expect(root.getAttribute('data-living-mood')).toBe('porch');
    // the sample's own constants, carried as custom properties
    expect(root.style.getPropertyValue('--lv-breathe')).toBe('36s');
    expect(root.style.getPropertyValue('--lv-swell')).toBe('1.07');
    expect(root.style.getPropertyValue('--lv-glow-dur')).toBe('7s');
    expect(root.style.getPropertyValue('--lv-glow-a')).toBe('rgba(255, 186, 92, 0.34)');
    expect(root.style.getPropertyValue('--lv-haze-dur')).toBe('26s');
    expect(root.style.getPropertyValue('--lv-bob-l')).toBe('9s');
    expect(root.style.getPropertyValue('--lv-bob-r')).toBe('11s');
    expect(root.style.getPropertyValue('--lv-bob-amp')).toBe('-7px');
  });

  it('stage focus follows the speaker as beats advance', async () => {
    const c = await renderEl(scene({ living: true }));
    const next = () => c.querySelector('[data-testid="story-script-next"]')!;
    await click(next()); // completes the typewriter
    await click(next()); // advances to Pat's beat
    expect(c.querySelector('[data-testid="story-stage-pat"]')!.getAttribute('data-active')).toBe('true');
    expect(c.querySelector('[data-testid="story-stage-uncleRay"]')!.getAttribute('data-active')).toBe('false');
  });

  it('beats and skip behave exactly as the static scene', async () => {
    const onDone = vi.fn();
    const c = await renderEl(scene({ living: true }, onDone));
    await click(c.querySelector('[data-testid="story-script-skip"]')!);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('living scene — all 11 stops stage their own pair + backdrop', () => {
  it('the route is 11 stops and the mood table covers exactly them', () => {
    expect(STORY_STOPS).toHaveLength(11);
    expect(LIVING_MOODS.map((m) => m.id).sort()).toEqual(STORY_STOPS.map((s) => s.id).sort());
    for (const stop of STORY_STOPS) expect(livingMoodFor(stop.id).id).toBe(stop.id);
  });

  for (const stop of STORY_STOPS) {
    it(`${stop.name}: its pair stands LARGE against its own backdrop, in its own mood`, async () => {
      const c = await renderEl(stopScene(stop));
      const root = c.querySelector('[data-testid="story-script"]') as HTMLElement;
      expect(root.className).toContain('living');
      expect(root.getAttribute('data-living-mood')).toBe(stop.id);
      // the stop's motion character is actually applied
      const vars = livingMoodVars(livingMoodFor(stop.id)) as unknown as Record<string, string>;
      for (const [k, v] of Object.entries(vars)) {
        expect(root.style.getPropertyValue(k), `${stop.id} ${k}`).toBe(v);
      }
      // the stop's own shipped backdrop underneath
      const bg = c.querySelector('.story-scene-bg') as HTMLElement;
      expect(bg).not.toBeNull();
      expect(bg.style.backgroundImage).toContain(storyBackdropUrl(stop));
      expect(c.querySelector('.story-scene-glow')).not.toBeNull();
      expect(c.querySelector('.story-scene-haze')).not.toBeNull();
      // the stop's pair, in shipped portrait art; Dee never staged
      const [a, b] = stop.pair;
      const oneA = c.querySelector(`[data-testid="story-stage-${a}"]`)!;
      const oneB = c.querySelector(`[data-testid="story-stage-${b}"]`)!;
      expect(oneA).not.toBeNull();
      expect(oneB).not.toBeNull();
      expect(oneA.querySelector('img')?.getAttribute('src')).toBe(storyPortraitFor(a!));
      expect(oneB.querySelector('img')?.getAttribute('src')).toBe(storyPortraitFor(b!));
      expect(c.querySelector('[data-testid="story-stage-dee"]')).toBeNull();
      // the first beat belongs to the pair's first seat: lit, partner dim
      expect(oneA.getAttribute('data-active')).toBe('true');
      expect(oneB.getAttribute('data-active')).toBe('false');
    });
  }

  it('every stop’s pair portraits and backdrop resolve to shipped files', () => {
    const pub = resolve(__dirname, '../public');
    for (const stop of STORY_STOPS) {
      for (const id of stop.pair) {
        expect(existsSync(join(pub, `assets/story/portraits/${id}.webp`)), `${stop.id}:${id}`).toBe(true);
      }
      expect(existsSync(join(pub, storyBackdropUrl(stop))), stop.id).toBe(true);
    }
  });

  it('speaker focus follows beats at a lively stop away from the Porch (the Cookout)', async () => {
    const cookout = STORY_STOPS.find((s) => s.id === 'cookout')!;
    const c = await renderEl(stopScene(cookout));
    const next = () => c.querySelector('[data-testid="story-script-next"]')!;
    await click(next());
    await click(next());
    expect(c.querySelector('[data-testid="story-stage-teisha"]')!.getAttribute('data-active')).toBe('true');
    expect(c.querySelector('[data-testid="story-stage-keisha"]')!.getAttribute('data-active')).toBe('false');
  });
});

describe('living scene — the mood table', () => {
  it('the Porch mood IS the shipped sample’s values, and unknown stops fall back to it', () => {
    expect(PORCH_LIVING_MOOD).toMatchObject({
      breatheSec: 36, swell: 1.07, glowSec: 7, glowLo: 0.55, glowHi: 1,
      glowA: 'rgba(255, 186, 92, 0.34)', glowB: 'rgba(255, 160, 64, 0.12)',
      hazeSec: 26, hazeA: 'rgba(255, 214, 150, 0.10)', hazeB: 'rgba(255, 200, 130, 0.08)',
      bobLeftSec: 9, bobRightSec: 11, bobAmpPx: -7,
    });
    expect(livingMoodFor('no-such-stop')).toBe(PORCH_LIVING_MOOD);
    expect(livingMoodVars(PORCH_LIVING_MOOD)).toMatchObject({
      '--lv-breathe': '36s', '--lv-swell': '1.07', '--lv-glow-dur': '7s', '--lv-bob-amp': '-7px',
    });
  });

  it('registers run the route’s classes: loud/lively quick, tense/cold slow, the King slowest and lowest', () => {
    const m = (id: string) => livingMoodFor(id);
    for (const mood of LIVING_MOODS) {
      expect(mood.breatheSec).toBeGreaterThan(0);
      expect(mood.swell).toBeGreaterThan(1);
      expect(mood.glowSec).toBeGreaterThan(0);
      expect(mood.glowHi).toBeGreaterThan(mood.glowLo);
      expect(mood.hazeSec).toBeGreaterThan(0);
      expect(mood.bobAmpPx).toBeLessThan(0);
      for (const col of [mood.glowA, mood.glowB, mood.hazeA, mood.hazeB]) {
        expect(col).toMatch(/^rgba\(\d+, \d+, \d+, 0?\.\d+\)$/);
      }
    }
    // lively/loud breathe quicker than tense/cold/slow
    expect(m('rec-center').breatheSec).toBeLessThan(m('corner').breatheSec);
    expect(m('cookout').breatheSec).toBeLessThan(m('high-rise').breatheSec);
    expect(m('porch').breatheSec).toBeLessThan(m('church-basement').breatheSec);
    // the King: the slowest breathe on the route, the lowest glow peak
    for (const mood of LIVING_MOODS) {
      expect(m('king').breatheSec).toBeGreaterThanOrEqual(mood.breatheSec);
      expect(m('king').glowHi).toBeLessThanOrEqual(mood.glowHi);
    }
  });

  it('the big stops — where the video phase lands — are exactly the King, the Legends’ Table, the Pj’s', () => {
    expect(LIVING_MOODS.filter((mood) => mood.big).map((mood) => mood.id).sort())
      .toEqual(['king', 'legends', 'the-pjs']);
  });
});

describe('living scene — scope: the two intro call-site classes only', () => {
  it('without the prop there is no living markup at all', async () => {
    const c = await renderEl(scene());
    const root = c.querySelector('[data-testid="story-script"]')!;
    expect(root.className).not.toContain('living');
    expect(root.getAttribute('data-living-mood')).toBeNull();
    expect(c.querySelector('[data-testid="story-stage"]')).toBeNull();
    expect(c.querySelector('.story-scene-glow')).toBeNull();
    expect(c.querySelector('.story-scene-haze')).toBeNull();
  });

  it('Reduce effects collapses the living staging to the static scene — at every stop', async () => {
    fx.setReduce(true);
    for (const stop of STORY_STOPS) {
      const c = await renderEl(stopScene(stop));
      const root = c.querySelector('[data-testid="story-script"]')!;
      expect(root.className, stop.id).toContain('reduce');
      expect(root.className, stop.id).not.toContain('living');
      expect(root.getAttribute('data-living-mood'), stop.id).toBeNull();
      expect(c.querySelector('[data-testid="story-stage"]'), stop.id).toBeNull();
      expect(c.querySelector('.story-scene-glow'), stop.id).toBeNull();
    }
  });

  it('the OS reduced-motion setting collapses it too', async () => {
    stubMatchMedia(true);
    const c = await renderEl(scene({ living: true }));
    const root = c.querySelector('[data-testid="story-script"]')!;
    expect(root.className).not.toContain('living');
    expect(c.querySelector('[data-testid="story-stage"]')).toBeNull();
    expect(c.querySelector('.story-scene-haze')).toBeNull();
  });

  it('wiring: exactly the two intro call sites pass living, for every stop — outros and the King finale never', () => {
    const home = srcFile('StoryHome.tsx');
    const room = srcFile('StoryRoom.tsx');
    const player = srcFile('ScriptPlayer.tsx');
    // one living hand-off per file: the solo intro (StoryHome) and the
    // co-op scene phase (StoryRoom), each keyed to the stop being played
    expect(home.match(/living livingMood=\{livingMoodFor\(stop\.id\)\}/g)).toHaveLength(1);
    expect(room.match(/living livingMood=\{livingMoodFor\(stop\.id\)\}/g)).toHaveLength(1);
    expect(home.match(/livingMood=/g)).toHaveLength(1);
    expect(room.match(/livingMood=/g)).toHaveLength(1);
    // the Porch-only gate is gone from both files
    expect(home).not.toContain("stop.id === 'porch'");
    expect(room).not.toContain("stop.id === 'porch'");
    // each file still mounts exactly two ScriptPlayers — intro/scene
    // (living, above) and outro/finale (never living: no second hand-off)
    expect(home.match(/<ScriptPlayer/g)).toHaveLength(2);
    expect(room.match(/<ScriptPlayer/g)).toHaveLength(2);
    // the collapse gate lives in the player: effects toggle AND OS setting
    expect(player).toContain('living && !reduceFx && !osReduced');
  });
});

describe('living scene — motion discipline', () => {
  it('CSS: every living keyframe animates transform/opacity only, scoped under .living', () => {
    const css = srcFile('story.css');
    const keyframes = [...css.matchAll(/@keyframes (story-living-[a-z]+) \{([\s\S]*?)\} \}/g)];
    expect(keyframes.length).toBeGreaterThanOrEqual(4);
    for (const [, name, body] of keyframes) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
      expect(props.length, name).toBeGreaterThan(0);
      for (const p of props) expect(['transform', 'opacity'], `${name}:${p}`).toContain(p);
    }
    // the backdrop breathes via the scoped rule, never the base scene
    expect(css).toContain('.story-scene.living .story-scene-bg');
    expect(css).toContain('.story-stage-one');
  });

  it('CSS: the mood arrives as --lv-* vars whose fallbacks ARE the Porch values', () => {
    const css = srcFile('story.css');
    expect(css).toContain('var(--lv-breathe, 36s)');
    expect(css).toContain('var(--lv-swell, 1.07)');
    expect(css).toContain('var(--lv-glow-dur, 7s)');
    expect(css).toContain('var(--lv-glow-lo, 0.55)');
    expect(css).toContain('var(--lv-glow-hi, 1)');
    expect(css).toContain('var(--lv-glow-a, rgba(255, 186, 92, 0.34))');
    expect(css).toContain('var(--lv-haze-dur, 26s)');
    expect(css).toContain('var(--lv-bob-l, 9s)');
    expect(css).toContain('var(--lv-bob-r, 11s)');
    expect(css).toContain('var(--lv-bob-amp, -7px)');
  });
});
