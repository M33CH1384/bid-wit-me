import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Seg } from '../src/MoreOptions';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith('.tsx') ? [p] : [];
  });
}

/** Pull role="radio" tags out of static markup and read aria-label vs the visible text. */
function radios(html: string): { name: string | null; text: string }[] {
  return [...html.matchAll(/<button[^>]*role="radio"[^>]*>.*?<\/button>/g)].map((m) => {
    const tag = m[0];
    const name = /aria-label="([^"]*)"/.exec(tag)?.[1] ?? null;
    const text = tag.replace(/<[^>]+>/g, '').trim();
    return { name, text };
  });
}

describe('radio accessible names', () => {
  it('names every option with its visible label, including the first one inside a row label', () => {
    // The row is a <label>. Without an explicit name, the first radio takes the row text
    // ("Trash talk" + the hint, which says "No Mercy") instead of "Family".
    const html = renderToStaticMarkup(createElement('label', { className: 'row' },
      createElement('span', null, 'Trash talk', createElement('small', null, 'No Mercy: the full roast')),
      createElement(Seg, {
        label: 'Trash talk intensity',
        value: 'nomercy',
        options: [['family', 'Family'], ['cookout', 'Cookout'], ['nomercy', 'No Mercy']],
        onChange: () => {},
      }),
    ));
    const found = radios(html);
    expect(found.map((r) => r.text)).toEqual(['Family', 'Cookout', 'No Mercy']);
    for (const r of found) expect(r.name).toBe(r.text);
  });

  it('names game speed, graphics, and the other segments the same way', () => {
    const cases: [string, string][][] = [
      [['slow', 'Slow'], ['relaxed', 'Chill'], ['normal', 'Normal'], ['fast', 'Fast']],
      [['high', 'High'], ['low', 'Low']],
      [['joker54', 'Jokers'], ['standard52', 'Standard 52']],
      [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
    ];
    for (const options of cases) {
      const html = renderToStaticMarkup(createElement(Seg, { label: 'group', value: options[0]![0], options, onChange: () => {} }));
      const found = radios(html);
      expect(found.map((r) => r.text)).toEqual(options.map(([, text]) => text));
      for (const r of found) expect(r.name).toBe(r.text);
    }
  });

  it('every radio in the app sets aria-label on the control itself', () => {
    const missing: string[] = [];
    for (const file of tsxFiles(join(import.meta.dirname, '../src'))) {
      const src = readFileSync(file, 'utf8');
      for (const tag of src.matchAll(/<button\b[^>]*\brole="radio"[^>]*>/g)) {
        if (!/\baria-label=/.test(tag[0])) missing.push(`${file}: ${tag[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
