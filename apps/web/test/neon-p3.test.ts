/**
 * @vitest-environment happy-dom
 *
 * Neon Royale P3 — the fidelity pass: glass v2, the rollout (tinted
 * game-select cards, gliding Social tab indicator, holographic Ranks
 * shimmer), reactive borders, and the shipped hero art. (The P3 art hero
 * itself was retired by the parity pass: the home is ONE composition for
 * both themes and the art survives as CSS-only decoration — see
 * theme-parity.test.ts.)
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { glowEnabled, glowPoint, glowSurfaceFor, GLOW_SELECTOR } from '../src/neon/pointerGlow';
import { themeStore } from '../src/theme';
import { social } from '../src/social/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const p3 = (css: string) => css.slice(css.indexOf('Neon Royale P3'));

describe('reactive-border gate + geometry', () => {
  it('runs only for Neon with every motion gate green', () => {
    expect(glowEnabled({ theme: 'neon', reducedMotion: false, reduceEffects: false })).toBe(true);
    expect(glowEnabled({ theme: 'classic', reducedMotion: false, reduceEffects: false })).toBe(false);
    expect(glowEnabled({ theme: 'neon', reducedMotion: true, reduceEffects: false })).toBe(false);
    expect(glowEnabled({ theme: 'neon', reducedMotion: false, reduceEffects: true })).toBe(false);
  });

  it('glowPoint is element-local and clamped to the box', () => {
    const r = { left: 100, top: 50, width: 200, height: 80 };
    expect(glowPoint(r, 150, 90)).toEqual({ x: 50, y: 40 });
    expect(glowPoint(r, -10, 999)).toEqual({ x: 0, y: 80 });
    expect(glowPoint(r, 999, -10)).toEqual({ x: 200, y: 0 });
  });

  it('glowSurfaceFor resolves the nearest surface and never one at the table', () => {
    const panel = { closest: (sel: string) => (sel === GLOW_SELECTOR ? panel : null) };
    expect(glowSurfaceFor({ closest: (sel: string) => (sel === GLOW_SELECTOR ? panel : null) })).toBe(panel);
    const atTable = { closest: (sel: string) => (sel === '.table-screen' ? atTable : null) };
    const tablePanel = { closest: (sel: string) => (sel === GLOW_SELECTOR ? tablePanel : sel === '.table-screen' ? atTable : null) };
    expect(glowSurfaceFor({ closest: (sel: string) => (sel === GLOW_SELECTOR ? tablePanel : null) })).toBeNull();
    expect(glowSurfaceFor(null)).toBeNull();
    expect(glowSurfaceFor({})).toBeNull();
  });
});

describe('reactive-border wiring', () => {
  it('main.tsx mounts the layer once, next to the ink layer', () => {
    const main = read('../src/main.tsx');
    expect(main).toContain("import ReactiveGlow from './neon/ReactiveGlow'");
    expect(main).toContain('<ReactiveGlow />');
    expect(main.indexOf('<InkLayer />')).toBeLessThan(main.indexOf('<ReactiveGlow />'));
  });

  it('one delegated passive listener set; never prevents default, never writes outside rAF', () => {
    const src = read('../src/neon/ReactiveGlow.tsx');
    expect(src).toContain("addEventListener('pointermove'");
    expect(src).toContain("addEventListener('pointerdown'");
    expect(src).toContain('{ passive: true }');
    expect(src).toContain('requestAnimationFrame');
    expect(src).not.toContain('preventDefault');
    // touch lights on press only — move events from touch are scrolls
    expect(src).toContain("e.pointerType !== 'touch'");
  });
});

describe('glass v2 (styles.css P3 section)', () => {
  const sec = p3(read('../src/styles.css'));

  it('the shared panels get the layered recipe: sheen + face gradient + edge light + backdrop filter', () => {
    expect(sec).toContain('html[data-theme="neon"] .glass');
    expect(sec).toContain('linear-gradient(168deg, rgba(255,255,255,.13)');
    expect(sec).toContain('inset 0 1px 0 rgba(255,255,255,.24)');
    expect(sec).toContain('backdrop-filter: blur(18px) saturate(165%) brightness(1.06)');
    expect(sec).toContain('0 0 24px rgba(var(--purple-rgb), .16)');
  });

  it('has a solid fallback where backdrop-filter is unavailable', () => {
    expect(sec).toContain('@supports not ((backdrop-filter: blur(1px))');
    expect(sec).toContain('linear-gradient(180deg, #171c42, #0a0d24)');
  });

  it('the table screen is counter-overridden back to its P2-state chrome', () => {
    expect(sec).toContain('html[data-theme="neon"] .table-screen .glass');
    expect(sec).toContain('backdrop-filter: blur(14px) saturate(140%)');
    expect(sec).toContain('html[data-theme="neon"] .table-screen .modal');
    // and the reactive ring never draws there
    expect(sec).toContain('.table-screen :is(.panel, .modal, .sheet');
    expect(sec).toContain('content: none');
  });

  it('the reactive ring is a masked border lit by --mx/--my/--glow-a', () => {
    expect(sec).toContain('radial-gradient(190px circle at var(--mx, 50%) var(--my, 50%)');
    expect(sec).toContain('mask-composite: exclude');
    expect(sec).toContain('opacity: var(--glow-a, 0)');
    expect(sec).toContain('pointer-events: none');
  });

  it('game-select cards are tinted per family (violet partners/Joker, blue cutthroat/Ace Down)', () => {
    expect(sec).toContain('.decision-card[data-testid="door-team"]');
    expect(sec).toContain('.decision-card[data-testid="mode-joker"]');
    expect(sec).toContain('.decision-card[data-testid="door-cutthroat"]');
    expect(sec).toContain('.decision-card[data-testid="mode-aceDown"]');
    expect(sec).toContain('rgba(var(--blue-rgb), .34)');
  });

  it('PLAY keeps real glow; press feedback is brief and transform/filter-only', () => {
    expect(sec).toContain('.hero-btn.gold');
    expect(sec).toContain('0 0 46px rgba(var(--gold-rgb), .38)');
    expect(sec).toContain(':is(.hero-btn, .decision-card, .mode):active { filter: brightness(1.13); }');
  });
});

describe('home art dressing CSS (parity pass: decoration is CSS-only)', () => {
  const sec = p3(read('../src/styles.css'));

  it('the emblem + card are painted by .wiz-home pseudo-elements under Neon — never DOM', () => {
    expect(sec).toContain('html[data-theme="neon"] .wiz-home::before');
    expect(sec).toContain("url('/assets/neon/spade-emblem.webp')");
    expect(sec).toContain('html[data-theme="neon"] .wiz-home::after');
    expect(sec).toContain("url('/assets/neon/ace-card.webp')");
    // the art still melts into the page via the same radial masks, and the
    // card's idle float is still killed by reduced motion
    expect(sec).toContain('mask-image: radial-gradient(ellipse 96% 64% at 50% 24%, #000 54%, transparent 88%)');
    expect(sec).toContain('@keyframes wiz-art-float');
    expect(sec).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-theme="neon"\] \.wiz-home::after \{ animation: none; \}/);
  });

  it('no .nh-* selectors survive — the Neon-only hero DOM is gone', () => {
    expect(sec).not.toMatch(/\.nh-[a-z]/);
  });

  it('the gradient-text wordmark is GONE — the home carries the Classic logo (owner directive)', () => {
    expect(sec).not.toContain('.nh-wordmark');
    expect(sec).not.toContain('background-clip: text');
    expect(sec).not.toContain('linear-gradient(94deg, #ffffff 0%');
  });
});

describe('Social + account rollout CSS', () => {
  const soc = p3(read('../src/social/social.css'));

  it('the panel takes the strong glass variant (chat text keeps its contrast floor)', () => {
    expect(soc).toContain('html[data-theme="neon"] .soc-panel');
    expect(soc).toContain('backdrop-filter: blur(20px) saturate(160%) brightness(1.05)');
    expect(soc).toContain('rgba(var(--glass-rgb), .9) 55%');
  });

  it('the tab glide is hidden in Classic, gradient + animated under Neon, fed by measured vars', () => {
    expect(soc).toContain('.soc-tab-glide { display: none; }');
    expect(soc).toContain('width: var(--tab-w, 0px)');
    expect(soc).toContain('transform: translateX(var(--tab-x, 0px))');
    expect(soc).toContain('transition: transform .3s cubic-bezier(.2,.8,.2,1), width .3s cubic-bezier(.2,.8,.2,1)');
    // the gold underline retires under Neon in favour of the glide
    expect(soc).toContain('.soc-tabs button.on');
    expect(soc).toContain('border-bottom-color: transparent');
  });

  it('the profile modal card joins glass v2; Ranks shimmers, off under reduced motion', () => {
    expect(soc).toContain('html[data-theme="neon"] .profile-modal-card');
    expect(soc).toContain('@keyframes ranks-sheen');
    expect(soc).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-theme="neon"\] \.ranks-you::before \{ animation: none; \}/);
  });

  it('SocialPanel measures the active tab into the glide vars', () => {
    const src = read('../src/social/Social.tsx');
    expect(src).toContain('className="soc-tab-glide"');
    expect(src).toContain("nav.style.setProperty('--tab-x'");
    expect(src).toContain("nav.style.setProperty('--tab-w'");
  });

  it('account cards join the glass family', () => {
    const acct = p3(read('../src/account/account.css'));
    expect(acct).toContain('html[data-theme="neon"] .acct-dropdown');
    expect(acct).toContain('html[data-theme="neon"] .acct-list li');
  });
});

describe('hero art assets', () => {
  // String paths derived from import.meta.url: under happy-dom the global
  // URL class is hijacked (resolves against http://localhost), which breaks
  // node:fs URL handling — plain path strings always reach the disk.
  const here = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
  const assets = ['spade-emblem.webp', 'ace-card.webp'].map((f) => {
    const p = `${here}/../public/assets/neon/${f}`;
    return { f, exists: existsSync(p), size: existsSync(p) ? statSync(p).size : 0 };
  });

  it('both pieces shipped optimized under assets/neon (NOT the size-pinned venues folder)', () => {
    for (const a of assets) {
      expect(a.exists, a.f).toBe(true);
      expect(a.size, `${a.f} is ${a.size} bytes`).toBeLessThanOrEqual(180 * 1024);
      expect(a.size, `${a.f} should be real art, not a stub`).toBeGreaterThan(10 * 1024);
    }
  });
});

describe('Setup home composition', () => {
  const src = read('../src/Setup.tsx');

  it('ONE home composition for both themes — no theme branch, no Neon-only destinations', () => {
    expect(src).not.toContain('useTheme');
    expect(src).not.toContain("theme === 'neon'");
    expect(src).not.toContain('nh-');
    expect(src).not.toContain("social.open('leaders')");
    expect(src).not.toContain("navigate('/profile')");
    // beta rule: nothing fabricated — no store, no gems
    expect(src.toLowerCase()).not.toContain('gem');
  });

  it('Classic splash markup and the shared actions keep their exact testids', () => {
    expect(src).toContain('<img className="logo splash-logo" src="/assets/bwm-wordmark-white.svg" alt="" />');
    expect(src.match(/data-testid="play"/g)).toHaveLength(2);
    expect(src.match(/data-testid="resume"/g)).toHaveLength(1);
    expect(src.match(/data-testid="resume-online"/g)).toHaveLength(1);
    expect(src.match(/data-testid="beta-tag"/g)).toHaveLength(1); // ONE shared splash — parity pass
  });
});

describe('Setup home renders', () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    el?.remove();
    el = null;
    act(() => { themeStore.set('classic'); social.close(); });
    localStorage.clear();
  });

  async function renderHome(theme: 'classic' | 'neon') {
    const { default: Setup } = await import('../src/Setup');
    const { DEFAULT_SETTINGS } = await import('../src/settings');
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      themeStore.set(theme);
      root!.render(createElement(Setup, { settings: DEFAULT_SETTINGS, onChange: () => {}, tips: { on: false, asked: true }, onTips: () => {}, onStart: () => {} }));
    });
    return el;
  }

  it('Classic: the splash renders, no tiles', async () => {
    const c = await renderHome('classic');
    expect(c.querySelector('.splash-logo')).not.toBeNull();
    expect(c.querySelector('[data-testid="nh-ranked"]')).toBeNull();
    expect(c.querySelector('[data-testid="play"]')).not.toBeNull();
  });

  it('Neon: the IDENTICAL interactive inventory as Classic — same buttons, labels, destinations', async () => {
    const inv = (c: HTMLElement) => [...c.querySelectorAll('button, a[href], input, select, textarea')]
      .map((n) => {
        const el = n as HTMLElement;
        return `${el.tagName}|${el.getAttribute('data-testid') ?? ''}|${(el.textContent ?? '').trim().replace(/\s+/g, ' ')}|${el.getAttribute('href') ?? ''}`;
      })
      .sort();
    const classic = await renderHome('classic');
    const classicInv = inv(classic);
    expect(classicInv.length).toBeGreaterThan(0);
    expect(classicInv.some((x) => x.includes('data-testid="play"') || x.includes('|play|'))).toBe(true);
    const classicTagline = classic.querySelector('.tagline')?.textContent;
    if (root) act(() => root!.unmount());
    root = null;
    el?.remove();
    el = null;
    const neon = await renderHome('neon');
    expect(inv(neon)).toEqual(classicInv);
    // the visible story matches too: same logo asset, same tagline
    expect(neon.querySelector('.splash-logo')?.getAttribute('src')).toBe('/assets/bwm-wordmark-white.svg');
    expect(neon.querySelector('.tagline')?.textContent).toBe(classicTagline);
    expect(neon.querySelector('[data-testid="beta-tag"]')).not.toBeNull();
  });
});
