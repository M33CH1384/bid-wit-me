import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// CSP is script-src 'self' (no 'unsafe-inline'): every <script> in the HTML entry points must load from a file.
const root = resolve(__dirname, '..');
describe('no inline scripts (CSP script-src self)', () => {
  for (const f of ['index.html', 'xr.html', ...(existsSync(resolve(root, 'dist/index.html')) ? ['dist/index.html'] : [])]) {
    it(`${f} has only src= scripts`, () => {
      const html = readFileSync(resolve(root, f), 'utf8');
      const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      expect(tags.length).toBeGreaterThan(0);
      for (const [, attrs, body] of tags) { expect(attrs).toMatch(/\bsrc=/); expect(body.trim()).toBe(''); }
    });
  }
  it('theme boot runs before first paint (classic, blocking, in <head>)', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toMatch(/<script src="\/theme-boot\.js"><\/script>/);
    expect(readFileSync(resolve(root, 'public/theme-boot.js'), 'utf8')).toContain("'bwm.theme.v1'");
  });
});
