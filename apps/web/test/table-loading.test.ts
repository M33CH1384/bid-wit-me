import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOADING_LINES, LOADING_TIPS, TableLoading } from '../src/TableLoading';

describe('table loading screen', () => {
  it('shows the wordmark, a shuffling line, and a progress bar before the table is drawn', () => {
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.42 }));
    expect(html).toContain('data-testid="table-loading"');
    expect(html).toContain('alt="Bid Wit Me"');
    expect(html).toContain('src="/assets/bwm-wordmark-white.svg"');
    expect(html).toContain(`>${LOADING_LINES[0]}<`);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('width:42%');
    expect(LOADING_LINES[0]).toBe('Shuffling the deck…');
  });

  it('reads strategy tips from the JSON file and shows the first one immediately', () => {
    const file = JSON.parse(readFileSync(new URL('../src/data/loading-tips.json', import.meta.url), 'utf8')) as { id: string; text: string }[];
    expect(file.length).toBeGreaterThanOrEqual(4);
    expect(file.length).toBeLessThanOrEqual(5);
    expect(file.every((t) => typeof t.id === 'string' && t.id.length > 0 && typeof t.text === 'string' && t.text.length > 0)).toBe(true);
    expect(LOADING_TIPS).toEqual(file);
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.1 }));
    expect(html).toContain('data-testid="table-loading-tip"');
    expect(html).toContain(`data-tip="${file[0]!.id}"`);
    expect(html).toContain(file[0]!.text);
  });
});
