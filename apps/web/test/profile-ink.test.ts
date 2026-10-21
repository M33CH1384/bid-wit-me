/**
 * Profile ink (owner, 2026-10-20): "I'd like it if the profile still had the
 * ink or some variation of it." Diagnosis pinned here: the ink layer is NOT
 * route-gated — InkLayer mounts once at the app root for every route and its
 * mode decision knows nothing about the location; the canvas is a fixed
 * z-index:-1 layer that only reads through surfaces which drop their solid
 * base under Neon. The home (.setup) and rewards (.rewards-page) surfaces got
 * that treatment; the profile page never did, so it read as one flat dark
 * surface. The fix gives .profile-page the same translucent-wash treatment
 * plus an ink-toned glow behind the header zone (page host only — the Social
 * panel is a solid sheet by design). Classic stays byte-identical: every rule
 * below lives behind html[data-theme="neon"].
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const mode = readFileSync(new URL('../src/ink/mode.ts', import.meta.url), 'utf8');

describe('the ink is not suppressed on the profile route', () => {
  it('InkLayer mounts once at the root, outside the route switch', () => {
    expect(main.split('<InkLayer />').length - 1).toBe(1);
    expect(main.indexOf('<InkLayer />')).toBeGreaterThan(main.indexOf("path === '/profile'"));
  });
  it('the ink mode decision knows nothing about routes', () => {
    expect(mode).not.toContain('location');
    expect(mode).not.toContain('pathname');
    expect(mode).not.toContain('/profile');
  });
});

describe('Neon: the profile page carries an ink variation', () => {
  it('the page field gets the translucent wash so the ink canvas reads through', () => {
    expect(css).toContain('html[data-theme="neon"] .profile-page {');
    expect(css).toContain('background: radial-gradient(90% 60% at 50% 30%, rgba(var(--purple-rgb), .16), rgba(4, 5, 12, .5) 70%);');
  });
  it('the header zone pools an ink-toned glow (page host only — .profile-page scope)', () => {
    expect(css).toContain('html[data-theme="neon"] .profile-page .soc-prof-head {');
    expect(css).toContain('rgba(var(--purple-rgb), .22)');
    expect(css).toContain('rgba(38, 156, 255, .14)');
  });
  it('Classic is untouched: the base .profile-page rule still paints no background', () => {
    expect(css).toContain('.profile-page { min-height: 100dvh; padding: calc(12px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); max-width: 720px; margin: 0 auto; }');
  });
});
