/** Neon Royale P1: the theme store, its persistence contract, the pre-paint
 *  snippet, the toggle placements, and Classic/Neon token parity. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'bwm.theme.v1';

function installStorage(seed: Record<string, string> = {}) {
  const ls = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => { ls.set(k, v); },
    removeItem: (k: string) => { ls.delete(k); },
    clear: () => { ls.clear(); },
  });
  return ls;
}

function installDocument() {
  const meta = {
    attrs: new Map<string, string>(),
    setAttribute(k: string, v: string) { this.attrs.set(k, v); },
  };
  const doc = {
    documentElement: { dataset: {} as Record<string, string> },
    querySelector: (s: string) => (s === 'meta[name="theme-color"]' ? meta : null),
  };
  vi.stubGlobal('document', doc);
  return { doc, meta };
}

async function freshTheme() {
  vi.resetModules();
  return import('../src/theme');
}

describe('theme store', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults to Classic with nothing stored', async () => {
    installStorage();
    const t = await freshTheme();
    expect(t.themeStore.get()).toBe('classic');
  });

  it('parseTheme: only the two known values survive; everything else is Classic', async () => {
    installStorage();
    const { parseTheme } = await freshTheme();
    expect(parseTheme(null)).toBe('classic');
    expect(parseTheme('{"theme":"neon"}')).toBe('neon');
    expect(parseTheme('{"theme":"classic"}')).toBe('classic');
    expect(parseTheme('{"theme":"blue"}')).toBe('classic');
    expect(parseTheme('"neon"')).toBe('classic');
    expect(parseTheme('not json')).toBe('classic');
    expect(parseTheme('')).toBe('classic');
  });

  it('set persists and a fresh load hydrates from the stored value', async () => {
    const ls = installStorage();
    const t = await freshTheme();
    t.themeStore.set('neon');
    expect(t.themeStore.get()).toBe('neon');
    expect(ls.get(KEY)).toBe('{"theme":"neon"}');
    const t2 = await freshTheme();
    expect(t2.themeStore.get()).toBe('neon');
    t2.themeStore.set('classic');
    expect(ls.get(KEY)).toBe('{"theme":"classic"}');
  });

  it('a corrupt stored value falls back to Classic instead of throwing', async () => {
    installStorage({ [KEY]: '{oops' });
    const t = await freshTheme();
    expect(t.themeStore.get()).toBe('classic');
  });

  it('subscribers are notified on change and can unsubscribe', async () => {
    installStorage();
    const t = await freshTheme();
    const seen: string[] = [];
    const off = t.themeStore.subscribe(() => seen.push(t.themeStore.get()));
    t.themeStore.set('neon');
    off();
    t.themeStore.set('classic');
    expect(seen).toEqual(['neon']);
  });

  it('applyTheme drives the html attribute and the theme-color meta', async () => {
    installStorage({ [KEY]: '{"theme":"neon"}' });
    const { doc, meta } = installDocument();
    const t = await freshTheme();
    t.initTheme(); // hydrates from the pre-paint value: neon
    expect(doc.documentElement.dataset.theme).toBe('neon');
    expect(meta.attrs.get('content')).toBe('#070914');
    t.themeStore.set('classic');
    expect(doc.documentElement.dataset.theme).toBeUndefined();
    expect(meta.attrs.get('content')).toBe('#0c0712');
  });
});

describe('theme plumbing pins', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('index.html carries the pre-paint snippet keyed to the same storage key', () => {
    const html = read('../index.html');
    expect(html).toContain(`localStorage.getItem('${KEY}')`);
    expect(html).toContain("document.documentElement.dataset.theme = 'neon'");
    expect(html).toContain('#070914');
    // the snippet sits in <head>, before the module script that boots the app
    expect(html.indexOf('dataset.theme')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });

  it('the toggle lives in Account (Appearance) and is mirrored in MoreOptions', () => {
    const acct = read('../src/account/AccountUI.tsx');
    expect(acct).toContain('data-testid="appearance-section"');
    expect(acct).toContain('<ThemeToggle />');
    const more = read('../src/MoreOptions.tsx');
    expect(more).toContain('<ThemeToggle />');
    expect(more).toContain('label="Appearance"');
    const toggle = read('../src/ThemeToggle.tsx');
    expect(toggle).toContain('data-testid="theme-seg"');
    expect(toggle).toContain('data-testid={`theme-${k}`}');
    expect(toggle).toContain("'neon', 'Neon Royale'");
  });

  it('main.tsx initializes the theme store at boot', () => {
    expect(read('../src/main.tsx')).toContain('initTheme()');
  });
});

describe('token parity', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const css = read('../src/styles.css');
  const block = (re: RegExp) => {
    const m = re.exec(css);
    if (!m) throw new Error(`block not found: ${re}`);
    return m[1]!;
  };
  const tokensOf = (body: string) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!);

  it('every Neon override token exists in the Classic :root (same names, both themes)', () => {
    const root = tokensOf(block(/:root \{([\s\S]*?)\n\}/));
    const neon = tokensOf(block(/html\[data-theme="neon"\] \{([\s\S]*?)\n\}/));
    expect(neon.length).toBeGreaterThan(10);
    for (const t of neon) expect(root, `neon overrides ${t} but :root never defines it`).toContain(t);
  });

  it('the anchor values are the spec values', () => {
    const rootBody = block(/:root \{([\s\S]*?)\n\}/);
    const neonBody = block(/html\[data-theme="neon"\] \{([\s\S]*?)\n\}/);
    expect(rootBody).toContain('--bg: #0c0712');
    expect(neonBody).toContain('--bg: #070914');
    expect(neonBody).toContain('--ink: #f5f4ff');
    expect(neonBody).toContain('--purple: #8054ff');
    expect(neonBody).toContain('--purple-hot: #269cff');
  });

  it('Neon keeps gold restrained: it does not retune the gold tokens', () => {
    const neonBody = block(/html\[data-theme="neon"\] \{([\s\S]*?)\n\}/);
    expect(neonBody).not.toContain('--gold:');
    expect(neonBody).not.toContain('--gold-rgb:');
    expect(neonBody).not.toContain('--gold-deep:');
  });

  it('the concentrated literal families were swept to tokens in all four stylesheets', () => {
    for (const p of ['../src/styles.css', '../src/social/social.css', '../src/online/online.css', '../src/account/account.css']) {
      const body = read(p);
      expect(body, p).not.toContain('rgba(185,128,255');
      expect(body, p).not.toContain('rgba(245,197,66');
      expect(body, p).not.toContain('rgba(155,92,255');
      expect(body, p).toContain('var(--edge-rgb)');
    }
  });
});
