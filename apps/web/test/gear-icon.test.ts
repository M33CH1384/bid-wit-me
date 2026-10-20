import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setup = readFileSync(new URL('../src/Setup.tsx', import.meta.url), 'utf8');
const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const socialCss = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');

/** Source window around a marker, for asserting what a given control renders. */
const around = (src: string, marker: string, span = 300) => {
  const i = src.indexOf(marker);
  expect(i, `marker ${marker} present`).toBeGreaterThan(-1);
  return src.slice(Math.max(0, i - 40), i + span);
};

describe('settings gear icon (flat SVG, never the ⚙ emoji)', () => {
  it('the home top-bar settings button renders the inline SVG gear', () => {
    expect(around(setup, 'data-testid="more"')).toContain('<GearIcon');
    expect(setup).not.toContain('⚙');
  });

  it('the social panel settings gear renders the inline SVG gear', () => {
    expect(around(social, 'data-testid="social-gear"')).toContain('<GearIcon');
    expect(around(social, 'data-testid="soc-tab-settings"')).toContain('<GearIcon');
    expect(social).not.toContain('⚙');
  });

  it('GearIcon is a single-colour inline SVG (currentColor, so theme + .on gold follow)', () => {
    const icon = readFileSync(new URL('../src/GearIcon.tsx', import.meta.url), 'utf8');
    expect(icon).toContain('<svg');
    expect(icon).toContain('fill="currentColor"');
  });
});

describe('social sheet stacking (the sheet covers the home chrome)', () => {
  const zOf = (css: string, re: RegExp) => {
    const m = css.match(re);
    expect(m, `${re} carries a z-index`).toBeTruthy();
    return Number(m![1]);
  };

  it('the social backdrop stacks above the wizard top bar', () => {
    const soc = zOf(socialCss, /\.modal-backdrop\.soc-backdrop \{[^}]*z-index:\s*(\d+)/);
    const bar = zOf(styles, /\.wiz-bar \{[^}]*z-index:\s*(\d+)/);
    expect(soc).toBeGreaterThan(bar);
  });

  it('the social backdrop stacks above the fixed sound dock', () => {
    const soc = zOf(socialCss, /\.modal-backdrop\.soc-backdrop \{[^}]*z-index:\s*(\d+)/);
    const docks = [...styles.matchAll(/\.sound-dock \{[^}]*z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(docks.length).toBeGreaterThan(0);
    for (const d of docks) expect(soc).toBeGreaterThan(d);
  });
});
