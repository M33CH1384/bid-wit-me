/**
 * @vitest-environment happy-dom
 *
 * Living scene SAMPLE (owner, 2026-10-24): the Porch pre-match intro
 * staged alive — backdrop light/air layers + the seated pair LARGE in
 * frame, speaker lit — while every other scene stays the static
 * staging. Pins: the living markup renders only when the `living`
 * prop is passed AND neither Reduce effects nor the OS reduced-motion
 * setting is on; the stage follows the current speaker; the beats /
 * skip machinery is untouched; and the wiring is exactly the two Porch
 * intro call sites (solo StoryHome + co-op StoryRoom) — outros and the
 * King finale never receive the prop.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Source reads resolve from the repo root (the suites' run directory —
 *  the entry-flow.test.ts pattern); import.meta.url is not a file URL
 *  inside a happy-dom test body in this setup. */
const srcFile = (rel: string) => readFileSync(join(process.cwd(), 'apps/web/src/story', rel), 'utf8');
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScriptPlayer from '../src/story/ScriptPlayer';
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

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} }),
  });
}

beforeEach(() => {
  fx.setReduce(false);
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

describe('living scene — scope: Porch intro only, everything else static', () => {
  it('without the prop there is no living markup at all (every other stop)', async () => {
    const c = await renderEl(scene());
    const root = c.querySelector('[data-testid="story-script"]')!;
    expect(root.className).not.toContain('living');
    expect(c.querySelector('[data-testid="story-stage"]')).toBeNull();
    expect(c.querySelector('.story-scene-glow')).toBeNull();
    expect(c.querySelector('.story-scene-haze')).toBeNull();
  });

  it('Reduce effects collapses the living staging to the static scene', async () => {
    fx.setReduce(true);
    const c = await renderEl(scene({ living: true }));
    const root = c.querySelector('[data-testid="story-script"]')!;
    expect(root.className).toContain('reduce');
    expect(root.className).not.toContain('living');
    expect(c.querySelector('[data-testid="story-stage"]')).toBeNull();
    expect(c.querySelector('.story-scene-glow')).toBeNull();
  });

  it('the OS reduced-motion setting collapses it too', async () => {
    stubMatchMedia(true);
    const c = await renderEl(scene({ living: true }));
    const root = c.querySelector('[data-testid="story-script"]')!;
    expect(root.className).not.toContain('living');
    expect(c.querySelector('[data-testid="story-stage"]')).toBeNull();
    expect(c.querySelector('.story-scene-haze')).toBeNull();
  });

  it('wiring: exactly the two Porch intro call sites pass living, gated on the stop id', () => {
    const home = srcFile('StoryHome.tsx');
    const room = srcFile('StoryRoom.tsx');
    const player = srcFile('ScriptPlayer.tsx');
    // one living prop per file: the solo intro (StoryHome) and the
    // co-op scene phase (StoryRoom) — outros / the King finale never
    expect(home.match(/living=\{stop\.id === 'porch'\}/g)).toHaveLength(1);
    expect(room.match(/living=\{stop\.id === 'porch'\}/g)).toHaveLength(1);
    expect(home.match(/living=/g)).toHaveLength(1);
    expect(room.match(/living=/g)).toHaveLength(1);
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
});
