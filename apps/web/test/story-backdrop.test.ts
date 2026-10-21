/**
 * @vitest-environment happy-dom
 *
 * Story backdrop art (web, 2026-10-21): every stop carries its OWN
 * photorealistic backdrop, story-scoped like the STORY_STOP_AUDIO override
 * and the house deck — story surfaces (map hero + card heads, scene player,
 * Tale of the Tape, the story table's placeholder backdrop) resolve through
 * storyBackdropUrl, while the shared venue panoramas and every non-story
 * surface stay exactly as they were. The Pj's + the King keep the
 * blockAfterDark panorama, which was purpose-made for them.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { STORY_STOPS, storyStopById } from '@spades/bots';
import { STORY_BACKDROP_STOPS, storyBackdropUrl, storyBackdropUrlForStopId } from '../src/story/storyBackdrop';
import ScriptPlayer from '../src/story/ScriptPlayer';
import StoryTape from '../src/story/StoryTape';
import { placeholderStyle } from '../src/Table';
import { venueAssetUrls } from '../src/venues';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pub = resolve(__dirname, '../public');

let roots: Root[] = [];
async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  roots.push(root);
  await act(async () => { root.render(el); });
  return c;
}
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
});

/** width×height out of a JPEG's SOF marker — the venue panoramas are 1200×600. */
function jpegSize(buf: Buffer): { w: number; h: number } {
  expect(buf[0]).toBe(0xff);
  expect(buf[1]).toBe(0xd8);
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

const BEATS = [{ speaker: 'dee', line: 'One line.' }];

describe('story backdrop resolution', () => {
  it('the nine borrowed-venue stops resolve to their own story art', () => {
    expect([...STORY_BACKDROP_STOPS].sort()).toEqual(
      ['barbershop', 'church-basement', 'cookout', 'corner', 'high-rise', 'legends', 'porch', 'rec-center', 'rooftop'].sort(),
    );
    for (const id of STORY_BACKDROP_STOPS) {
      const stop = storyStopById(id)!;
      expect(stop, id).toBeTruthy();
      expect(storyBackdropUrl(stop), id).toBe(`/assets/story/venues/${id}.jpg`);
    }
  });

  it("the Pj's and the King keep the purpose-made blockAfterDark panorama", () => {
    for (const id of ['the-pjs', 'king']) {
      expect(storyBackdropUrl(storyStopById(id)!), id).toBe('/assets/venues/blockAfterDark/bg.jpg');
    }
    // every stop on the route resolves somewhere real
    for (const s of STORY_STOPS) expect(storyBackdropUrl(s)).toMatch(/\.jpg$/);
  });

  it('stop-id resolution: unknown or missing ids resolve to nothing', () => {
    expect(storyBackdropUrlForStopId(undefined)).toBeNull();
    expect(storyBackdropUrlForStopId('nope')).toBeNull();
    expect(storyBackdropUrlForStopId('porch')).toBe('/assets/story/venues/porch.jpg');
    expect(storyBackdropUrlForStopId('king')).toBe('/assets/venues/blockAfterDark/bg.jpg');
  });

  it('each story backdrop ships at venue-panorama spec: 1200×600 JPEG, ≤ 120 KB', () => {
    for (const id of STORY_BACKDROP_STOPS) {
      const p = `${pub}/assets/story/venues/${id}.jpg`;
      expect(existsSync(p), id).toBe(true);
      expect(statSync(p).size / 1024, id).toBeLessThan(120);
      expect(jpegSize(readFileSync(p)), id).toEqual({ w: 1200, h: 600 });
    }
  });
});

describe('story surfaces paint the stop art, not the borrowed venue', () => {
  it('scene player: the backdrop is the stop art the caller resolved', async () => {
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: BEATS, cta: 'Go', onDone: () => {}, bgUrl: storyBackdropUrl(storyStopById('porch')!),
      cast: ['dee'],
    }));
    const bg = c.querySelector<HTMLElement>('.story-scene-bg')!;
    expect(bg.style.backgroundImage).toContain('/assets/story/venues/porch.jpg');
  });

  it('tale of the tape: porch shows porch art; the King keeps the block panorama', async () => {
    const facts = { attempts: 0, cleared: false };
    const c = await renderEl(createElement(StoryTape, { stop: storyStopById('porch')!, facts, cta: 'x', onDone: () => {} }));
    expect(c.querySelector<HTMLElement>('.story-scene-bg')!.style.backgroundImage).toContain('/assets/story/venues/porch.jpg');
    const c2 = await renderEl(createElement(StoryTape, { stop: storyStopById('king')!, facts, cta: 'x', onDone: () => {} }));
    expect(c2.querySelector<HTMLElement>('.story-scene-bg')!.style.backgroundImage).toContain('/assets/venues/blockAfterDark/bg.jpg');
  });
});

describe('non-story surfaces are untouched', () => {
  it('venue asset urls still point at the shared venue panoramas', () => {
    expect(venueAssetUrls('grandma', 'low').bg).toBe('/assets/venues/grandma/bg.jpg');
    expect(venueAssetUrls('barbershop', 'low').bg).toBe('/assets/venues/barbershop/bg.jpg');
    expect(venueAssetUrls('classic', 'low').bg).toBeNull();
    expect(venueAssetUrls('blockAfterDark', 'low').bg).toBe('/assets/venues/blockAfterDark/bg.jpg');
  });

  it('the table placeholder without a story override is byte-identical to before', () => {
    const grandma = placeholderStyle('grandma') as Record<string, string>;
    expect(grandma['--tp-bg']).toBe('url(/assets/venues/grandma/bg.jpg)');
    const classic = placeholderStyle('classic') as Record<string, string>;
    expect(classic['--tp-bg']).toBe('none');
  });

  it('the table placeholder with a story override wears the stop art — even on the classic venue (Rec Center)', () => {
    const rec = placeholderStyle('classic', storyBackdropUrl(storyStopById('rec-center')!)) as Record<string, string>;
    expect(rec['--tp-bg']).toBe('url(/assets/story/venues/rec-center.jpg)');
    const porch = placeholderStyle('grandma', storyBackdropUrl(storyStopById('porch')!)) as Record<string, string>;
    expect(porch['--tp-bg']).toBe('url(/assets/story/venues/porch.jpg)');
  });
});
