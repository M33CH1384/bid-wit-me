import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOADING_LINES, TableLoading } from '../src/TableLoading';

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
});
