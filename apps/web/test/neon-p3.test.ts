/**
 * @vitest-environment happy-dom
 *
 * Neon Royale P3 — the fidelity pass: glass v2, the art hero on the home
 * screen (Neon-only composition; Classic's tree untouched), the rollout
 * (tinted game-select cards, gliding Social tab indicator, holographic
 * Ranks shimmer), reactive borders, and the shipped hero art.
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
    expect(sec).toContain(':is(.hero-btn, .decision-card, .nh-tile, .mode):active { filter: brightness(1.13); }');
  });
});

describe('home hero CSS', () => {
  const sec = p3(read('../src/styles.css'));

  it('the art melts into the page via radial masks; the card floats, killed by reduced motion', () => {
    expect(sec).toContain('.nh-emblem');
    expect(sec).toContain('mask-image: radial-gradient(ellipse 74% 74% at 50% 47%, #000 66%, transparent 88%)');
    expect(sec).toContain('@keyframes nh-float');
    expect(sec).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-theme="neon"\] \.nh-card \{ animation: none; \}/);
  });

  it('the wordmark is a violet→blue gradient treatment', () => {
    expect(sec).toContain('linear-gradient(94deg, #ffffff 0%, #d9c8ff 26%, #8054ff 52%, #269cff 78%, #5bdfff 100%)');
    expect(sec).toContain('background-clip: text');
  });

  it('tiles are ≥44px glass targets', () => {
    expect(sec).toContain('.nh-tile {');
    expect(sec).toContain('min-height: 58px');
    expect(sec).toContain('.nh-half { min-height: 52px; }');
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

  it('the hero is theme-conditional and wired to real destinations only', () => {
    expect(src).toContain("import { useTheme } from './theme'");
    expect(src).toContain("theme === 'neon'");
    expect(src).toContain('className="nh-stage"');
    expect(src).toContain('src="/assets/neon/spade-emblem.webp"');
    expect(src).toContain('src="/assets/neon/ace-card.webp"');
    expect(src).toContain('data-testid="nh-ranked"');
    expect(src).toContain("social.open('leaders')");
    expect(src).toContain('data-testid="nh-quick"');
    expect(src).toContain('data-testid="nh-private"');
    expect(src).toContain('data-testid="nh-decks"');
    expect(src).toContain('data-testid="nh-achievements"');
    expect(src).toContain("navigate('/profile')");
    // beta rule: nothing fabricated — no store, no gems
    expect(src.toLowerCase()).not.toContain('gem');
    expect(src).not.toContain('nh-store');
  });

  it('Classic splash markup and the shared actions keep their exact testids', () => {
    expect(src).toContain('<img className="logo splash-logo" src="/assets/bwm-wordmark-white.svg" alt="" />');
    expect(src.match(/data-testid="play"/g)).toHaveLength(2);
    expect(src.match(/data-testid="resume"/g)).toHaveLength(1);
    expect(src.match(/data-testid="resume-online"/g)).toHaveLength(1);
    expect(src.match(/data-testid="beta-tag"/g)).toHaveLength(2); // classic splash + neon brand row
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
      root!.render(createElement(Setup, { settings: DEFAULT_SETTINGS, onChange: () => {}, onStart: () => {} }));
    });
    return el;
  }

  it('Classic: the splash renders, no hero art, no tiles', async () => {
    const c = await renderHome('classic');
    expect(c.querySelector('.splash-logo')).not.toBeNull();
    expect(c.querySelector('.nh-emblem')).toBeNull();
    expect(c.querySelector('[data-testid="nh-ranked"]')).toBeNull();
    expect(c.querySelector('[data-testid="play"]')).not.toBeNull();
  });

  it('Neon: emblem + floating card + gradient wordmark + all five tiles, same PLAY', async () => {
    const c = await renderHome('neon');
    expect(c.querySelector('.splash-logo')).toBeNull();
    expect(c.querySelector('.nh-emblem')?.getAttribute('src')).toBe('/assets/neon/spade-emblem.webp');
    expect(c.querySelector('.nh-card')?.getAttribute('src')).toBe('/assets/neon/ace-card.webp');
    expect(c.querySelector('.nh-wordmark')?.textContent).toBe('BID WIT ME');
    for (const t of ['nh-ranked', 'nh-quick', 'nh-private', 'nh-decks', 'nh-achievements']) {
      expect(c.querySelector(`[data-testid="${t}"]`), t).not.toBeNull();
    }
    expect(c.querySelector('[data-testid="play"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="beta-tag"]')).not.toBeNull();
  });

  it('Neon: the Ranked tile opens Social on the Ranks tab', async () => {
    const c = await renderHome('neon');
    const btn = c.querySelector<HTMLButtonElement>('[data-testid="nh-ranked"]')!;
    await act(async () => { btn.click(); });
    expect(social.get().open).toBe(true);
    expect(social.get().tab).toBe('leaders');
  });
});
