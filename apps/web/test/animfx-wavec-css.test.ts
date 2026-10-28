/**
 * Wave C pins (Animation Replacement Program §A4 + §A5 row 56): the 22
 * set covers and the 3 THE HARD WAY flash rebuilt as live code.
 *  - every cover carries its §A4 material sub-elements (DOM),
 *  - finale-only elements stay finale-only,
 *  - the longest fresh motion per cover stays within ±10% of shipped
 *    (the CSS duration/delay constants ARE the spec, wave-B pattern),
 *  - the calm contracts (Reduce Effects stills / OS reduce-motion) and
 *    the warm story register in BOTH themes (no Neon re-skin of story
 *    surfaces — parity is identical function, timing, information),
 *  - the flash keeps its 3.1 s life and gains the metal-set rules +
 *    a sub-line naming the side the recap bills (Intermission source).
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetCover } from '../src/animfx/SetCover';
import { SET_ANIMS } from '../src/setAnims';

const css = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');
const intermission = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
const render = (animId: string, tier: 'regular' | 'finale') =>
  renderToStaticMarkup(createElement(SetCover, { animId, tier, mode: 'fresh', reduced: false, side: 0 }));

describe('wave C cover art: the §A4 material sub-elements render', () => {
  it('every stop × tier gains its treatment elements', () => {
    const want: Record<string, string[]> = {
      porch: ['sc-dust', 'sc-books'],
      barbershop: ['sc-neck'],
      'rec-center': ['sc-lamp'],
      cookout: ['sc-ember', 'sc-puff dark'],
      corner: ['sc-rail'],
      'church-basement': [],
      rooftop: ['sc-haze'],
      'high-rise': ['sc-floors'],
      'the-pjs': ['sc-window'],
      legends: ['sc-frame'],
      king: ['sc-cone', 'sc-mote'],
    };
    for (const a of SET_ANIMS) {
      for (const tier of ['regular', 'finale'] as const) {
        const html = render(a.stopId, tier);
        for (const cls of want[a.stopId]!) expect(html, `${a.stopId}/${tier}`).toContain(cls);
      }
    }
  });

  it('the church EXIT sign is finale-only (the finale’s last light)', () => {
    expect(render('church-basement', 'regular')).not.toContain('sc-exit');
    expect(render('church-basement', 'finale')).toContain('sc-exit');
  });

  it('the high-rise floor ticker runs to L only in the finale', () => {
    expect(render('high-rise', 'finale')).toContain('>L</span>');
    expect(render('high-rise', 'regular')).not.toContain('>L</span>');
  });

  it('previews are the real animation: the story detail sheet mounts SetCover itself', () => {
    const sheet = readFileSync(new URL('../src/story/StoryDetailSheet.tsx', import.meta.url), 'utf8');
    expect(sheet).toContain("from '../animfx/SetCover'");
    expect(sheet).toContain('tier="regular"');
    expect(sheet).toContain('tier="finale"');
  });
});

describe('wave C held timings (longest fresh motion, shipped → rebuilt)', () => {
  it('the shipped anchor animations are untouched in duration', () => {
    expect(css).toContain('animation: sc-light-flicker 2.6s'); // porch regular anchor 2.6
    expect(css).toContain('animation: sc-light-cut 3.4s'); // porch finale anchor 3.4
    expect(css).toContain('animation: sc-cape-whisk 2.3s'); // barbershop regular 2.3
    expect(css).toContain('animation: sc-cape-drape 2.6s'); // barbershop finale 2.6
    expect(css).toContain('animation: sc-banner-drop-back 3s'); // rec regular 3.0
    expect(css).toContain('animation: sc-smoke-roll 2.8s'); // cookout regular (last puff ends 3.44)
    expect(css).toContain('animation: sc-gate-down .7s'); // corner .7 (link-by-link inside it)
    expect(css).toContain('animation: sc-chair-fold 2.9s'); // church regular (last chair ends 3.46)
    expect(css).toContain('animation: sc-fly 2.3s'); // rooftop regular (last bird ends 2.87)
    expect(css).toContain('animation: sc-cover-life 3s'); // high-rise regular life 3.0
    expect(css).toContain('animation: sc-stamp-slam .45s'); // legends slam (ends .75 with its delay)
    expect(css).toContain('animation: hw-life 3.1s'); // hardway flash life 3.1
  });

  it('new motions land inside their cover’s shipped envelope', () => {
    expect(css).toContain('animation: sc-pole-wind 2.4s'); // barbershop finale: ends 2.5 ≤ 2.6
    expect(css).toContain('animation: sc-books-out 1.15s'); // porch: .45 + 1.15 = 1.6 ≤ 2.6
    expect(css).toContain('.setcover[data-anim="rec-center"].fresh.tier-finale .sc-lamp { animation-duration: .55s; }'); // rec finale: ends .95 ≈ .9
    expect(css).toContain('animation: sc-cone-life 4.4s'); // king finale: the spot dies at 4.4, as shipped
    expect(css).toContain('animation: sc-mote-drift 1.6s'); // king regular: last mote ends 2.0 ≤ 2.05
    expect(css).toContain('.setcover[data-anim="legends"].fresh.tier-finale .sc-frame rect { animation-duration: 1.6s;'); // legends finale frame ends 1.9 ≤ 2.9
  });
});

describe('wave C calm + parity contracts', () => {
  it('the reduced-motion backstop names the new sub-elements', () => {
    for (const cls of ['.sc-dust', '.sc-books', '.sc-ember', '.sc-exit', '.sc-haze', '.sc-floors', '.sc-window', '.sc-frame', '.sc-cone', '.sc-mote']) {
      expect(css).toContain(cls);
    }
    expect(css).toContain('.hardway-flash .hw-rule, .hardway-flash small { animation: none !important; }');
  });

  it('story covers keep the warm register in both themes — no Neon re-skin of set covers', () => {
    expect(css).not.toContain('html[data-theme="neon"] .setcover');
    expect(css).not.toContain('html[data-theme="neon"] .hardway-flash');
  });

  it('no three.js / layout imports crept into the cover module (entry-graph law)', () => {
    const src = readFileSync(new URL('../src/animfx/SetCover.tsx', import.meta.url), 'utf8');
    expect(src).not.toContain('three');
    expect(src).not.toMatch(/from\s+['"][^'"]*layout/);
  });
});

describe('wave C hardway flash (§A5 row 56)', () => {
  it('the type is set in metal: rules draw, the slam seats, the sub-line typesets behind', () => {
    expect(css).toContain('.hardway-flash .hw-rule');
    expect(css).toContain('animation: hw-rule-draw .65s');
    expect(css).toContain('@keyframes hw-slam { 0% { opacity: 0; transform: scale(2.3); } 55% { opacity: 1; transform: scale(.965); }');
    expect(css).toContain('animation: hw-sub-in .45s ease .38s both');
  });

  it('the sub-line names the knocked-out side as the recap bills it (engine result.shotOut)', () => {
    expect(intermission).toContain('st.result?.shotOut');
    expect(intermission).toContain('sideName(r, s, names)');
    expect(intermission).toContain('third set — game over');
    // the flash block keeps its testid and its still (reduced) variant
    expect(intermission).toContain('data-testid="hardway-flash"');
    expect(intermission).toContain("hardway-flash${reduceFx ? ' still' : ''}");
  });
});
