/**
 * @vitest-environment happy-dom
 *
 * Persona faces (owner, 2026-10-23: "give them faces"): the 19 regular-table
 * personas ship a portrait per gender (38 files) in the story-cast spec
 * (512×512 WebP, ≤90 KB), and the three seat-identity surfaces — loading
 * hold, versus intro, in-table plates — resolve persona bots to those
 * portraits, with the pre-existing fallbacks (nameplate at the hold,
 * initial medallion at plates/versus) intact when the art fails.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PERSONA_PORTRAITS, personaPortraitFor } from '@spades/bots';
import PersonaFace from '../src/PersonaFace';
import { VersusIntro, type VersusModel } from '../src/VersusIntro';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pub = resolve(__dirname, '../public');
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Width/height out of a WebP container (VP8 / VP8L / VP8X). */
function webpSize(buf: Buffer): { w: number; h: number } {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
}

describe('persona portrait assets', () => {
  it('all 38 persona × gender portraits ship, in the story-cast spec', () => {
    expect(PERSONA_PORTRAITS).toHaveLength(38);
    for (const key of PERSONA_PORTRAITS) {
      const file = resolve(pub, `assets/personas/portraits/${key}.webp`);
      expect(existsSync(file), key).toBe(true);
      expect(statSync(file).size, key).toBeLessThanOrEqual(90 * 1024);
      expect(webpSize(readFileSync(file)), key).toEqual({ w: 512, h: 512 });
    }
  });
});

describe('PersonaFace', () => {
  let roots: Root[] = [];
  afterEach(async () => {
    for (const r of roots) await act(async () => { r.unmount(); });
    roots = [];
    document.body.innerHTML = '';
  });

  async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    roots.push(root);
    await act(async () => { root.render(el); });
    return c;
  }

  it('renders the portrait resolved from the bot name, over the initial medallion', async () => {
    const c = await renderEl(createElement(PersonaFace, { name: 'Big Mike' }));
    const img = c.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/assets/personas/portraits/hothead-m.webp');
    expect(c.querySelector('[data-testid="persona-face-hothead-m"]')).not.toBeNull();
    expect(c.textContent).toContain('B');
  });

  it('a failed portrait drops the img, keeps the initial, and reports the error', async () => {
    let reported = false;
    const c = await renderEl(createElement(PersonaFace, {
      name: 'Sharon',
      onError: () => { reported = true; },
    }));
    const img = c.querySelector('img')!;
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(reported).toBe(true);
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('S');
  });
});

describe('versus intro faces', () => {
  const model: VersusModel = {
    mode: 'team', kind: 'team',
    sides: [
      { label: 'Shot Callers', members: [{ name: 'Meech', uid: 'u1', isBot: false }, { name: 'LovleyT714', uid: 'u2', isBot: false }] },
      { label: 'Table Bots', members: [{ name: 'Tunde', uid: null, isBot: true }, { name: 'Skye', uid: null, isBot: true }] },
    ],
  };

  it('bot members show their persona portraits; human members never do', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model, reduced: false, ready: false, onStoryComplete: () => {} }));
    for (const name of ['Tunde', 'Skye']) {
      expect(html).toContain(`src="${personaPortraitFor(name)}"`);
    }
    expect(html).not.toContain(`src="${personaPortraitFor('Meech')}"`);
    expect(html).not.toContain(`src="${personaPortraitFor('LovleyT714')}"`);
  });
});

describe('in-table plates', () => {
  it('PlateFace routes bot seats to PersonaFace, gated on the seat bot flag', () => {
    const src = read('../src/Table.tsx');
    expect(src).toContain("import PersonaFace from './PersonaFace';");
    expect(src).toContain('if (bot) return <PersonaFace name={name} className="plate-avatar" />;');
    expect(src).toContain('bot={isBotSeat(seat)}');
    // story seats still outrank the persona portrait; humans keep the avatar path
    expect(src.indexOf('if (storyId) return <StoryFace')).toBeLessThan(src.indexOf('if (bot) return <PersonaFace'));
  });
});
