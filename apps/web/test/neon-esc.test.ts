/**
 * Neon Royale — escalation pass (owner verdict on P3: "still falling short
 * of the mark by far"). Pins for: glass v3 (gradient rim via border-box
 * layering, refraction line, deeper transparency), the Social sheet
 * floating on the ink with tile-ified rows/bubbles, the Classic logo in
 * the Neon hero, and the table screen staying byte-equivalent.
 * The ink half of the pass (mode-gate fix + engine turn-up) is pinned in
 * ink.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const esc = (css: string) => css.slice(css.indexOf('escalation pass'));

const RIM = 'linear-gradient(135deg, rgba(196,160,255,.9) 0%, rgba(var(--purple-rgb), .55) 30%, rgba(var(--blue-rgb), .5) 68%, rgba(var(--cyan-rgb), .85) 100%) border-box';

describe('glass v3 — shared panels (styles.css escalation section)', () => {
  const sec = esc(read('../src/styles.css'));

  it('the rim is a true gradient painted through a transparent border (border-box layer)', () => {
    expect(sec).toContain('html[data-theme="neon"] .glass');
    expect(sec).toContain('border: 1px solid transparent');
    expect(sec).toContain(RIM);
    // fills clip to padding-box so the rim layer owns the border ring
    expect(sec).toContain('rgba(var(--glass-rgb), .8) 100%) padding-box');
  });

  it('deeper transparency + refraction line + stronger edge light and sheen', () => {
    // v2 fills were .92/.82/.88 — v3 goes .88/.74/.80 so ink reads through
    expect(sec).toContain('rgba(var(--glass-strong-rgb), .88) 0%, rgba(var(--glass-rgb), .74) 52%');
    expect(sec).toContain('backdrop-filter: blur(20px) saturate(175%) brightness(1.08)');
    expect(sec).toContain('inset 0 1px 0 rgba(255,255,255,.32)');
    // the refraction illusion: a bright band offset just inside the top rim
    expect(sec).toContain('inset 0 3px 3px -2px rgba(190,215,255,.4)');
    expect(sec).toContain('inset 0 -2px 3px -2px rgba(var(--cyan-rgb), .3)');
    // inner glow where the glass meets the ink
    expect(sec).toContain('inset 0 0 26px rgba(var(--purple-rgb), .09)');
    expect(sec).toContain('linear-gradient(168deg, rgba(255,255,255,.16) 0%');
  });

  it('the solid fallback survives (no backdrop-filter → opaque navy, no see-through text)', () => {
    const fb = sec.slice(sec.indexOf('@supports not'));
    expect(fb).toContain('linear-gradient(180deg, #171c42, #0a0d24)');
  });

  it('decision cards, modes and quiet rows share the v3 rim language', () => {
    expect(sec).toContain('html[data-theme="neon"] .decision-card');
    expect(sec).toContain('html[data-theme="neon"] .mode');
    expect(sec).toContain('html[data-theme="neon"] .quiet-row');
    // family tints survive on the tinted border-box rims
    expect(sec).toContain('.decision-card[data-testid="door-cutthroat"]');
    expect(sec).toContain('rgba(var(--blue-rgb), .6) 30%');
  });

  it('the table screen resets v3’s new properties — gameplay stays byte-equivalent', () => {
    expect(sec).toContain('html[data-theme="neon"] .table-screen :is(.glass, .panel, .modal, .sheet, .decision-card, .mode, .quiet-row) { border: 0; }');
  });

  it('no escalation rule is left unscoped (Classic cannot see this section’s effects)', () => {
    // A rule for any v3 surface that starts at a line edge WITHOUT the
    // html[data-theme="neon"] prefix would leak into Classic.
    const unscoped = /\n\.(glass|panel|modal|sheet|decision-card|mode|quiet-row|soc-panel|soc-bubble|soc-player|soc-frow|soc-thread|profile-modal-card|ranks-you)\s*[,{]/;
    expect(esc(read('../src/styles.css'))).not.toMatch(unscoped);
    expect(esc(read('../src/social/social.css'))).not.toMatch(unscoped);
  });
});

describe('glass v3 — Social floats on the ink (social.css escalation section)', () => {
  const sec = esc(read('../src/social/social.css'));

  it('the sheet goes translucent: fills .84/.72/.78 at blur 24px', () => {
    expect(sec).toContain('html[data-theme="neon"] .soc-panel');
    expect(sec).toContain('rgba(var(--glass-strong-rgb), .84), rgba(var(--glass-rgb), .72) 55%, rgba(var(--glass-rgb), .78)');
    expect(sec).toContain('backdrop-filter: blur(24px) saturate(175%) brightness(1.07)');
    expect(sec).toContain('@supports not ((backdrop-filter: blur(1px))');
  });

  it('player rows, DM rows and friend rows are distinct glass tiles', () => {
    expect(sec).toContain('html[data-theme="neon"] .soc-player');
    expect(sec).toContain('html[data-theme="neon"] .soc-thread');
    expect(sec).toContain('html[data-theme="neon"] .soc-frow');
    expect(sec).toContain('rgba(var(--glass-strong-rgb), .55)');
    expect(sec).toContain('rgba(var(--glass-strong-rgb), .5)');
  });

  it('chat bubbles are tiles with edge light; sender tints kept (violet theirs, gold mine)', () => {
    expect(sec).toContain('html[data-theme="neon"] .soc-bubble');
    expect(sec).toContain('rgba(var(--purple-rgb), .14), rgba(var(--glass-strong-rgb), .72)');
    expect(sec).toContain('html[data-theme="neon"] .soc-line.mine .soc-bubble');
    expect(sec).toContain('rgba(var(--gold-rgb), .34), rgba(201,150,42,.22)');
  });

  it('the profile modal card and Ranks card take the v3 rim', () => {
    expect(sec).toContain('html[data-theme="neon"] .profile-modal-card');
    expect(sec).toContain('html[data-theme="neon"] .ranks-you');
    expect(sec).toContain('border-box');
  });
});

describe('the Classic logo on the home (Setup.tsx)', () => {
  const src = read('../src/Setup.tsx');

  it('ONE splash renders the shared logo asset — the same markup for both themes', () => {
    const logo = '<img className="logo splash-logo" src="/assets/bwm-wordmark-white.svg" alt="" />';
    expect(src.split(logo)).toHaveLength(2); // the single shared splash (parity pass)
    expect(src).not.toContain('nh-wordmark');
    expect(src).not.toContain('nh-brand-row');
  });
});
