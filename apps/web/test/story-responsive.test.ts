/**
 * Story responsive tiers (owner, 2026-10-21, over a Rec Center tape
 * screenshot from his Mac: "we need to look at every screen and make
 * sure its optimized for mobile as well as large screens").
 *
 * The defects were structural, so the pins are structural:
 *  - .story-shell capped EVERY story screen at 560px — on a desktop
 *    the map, tape, scenes and outros sat in a phone column between
 *    wide dead margins;
 *  - the tape's two sides engaged their row at 520px of shell, so at
 *    desktop-in-the-old-cap (and every 520–719px width: landscape
 *    phones, small tablets) each entry's value column was ~113–131px
 *    and the cards grew hundreds of pixels tall on wrapped text;
 *  - the story dock slot measured 40 wide × 46 tall in landscape (the
 *    global .dock-slot width: 40px !important beat the slot's own 46px
 *    rule), so the parked speaker squared itself down to 40px on the
 *    owner's Mac while portrait phones got 46;
 *  - the fixed sound dock re-measured its in-flow slot on mutations,
 *    resize and a 1s interval — but never on scroll, so on the long
 *    story document it lagged, then snapped to wherever the slot had
 *    scrolled to, including off the top edge;
 *  - badge chips (~29px) and the owner reset button (36px) were story
 *    controls under the family's 44px target floor.
 *
 * happy-dom paints nothing: these pins guard the mechanisms and the
 * layout arithmetic; the owner's screens remain the pixel verdict.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/story/story.css', import.meta.url), 'utf8');
const sound = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');

const tiers = css.slice(css.indexOf('responsive tiers'));
const i720 = css.indexOf('@media (min-width: 720px)');
const i1100 = css.indexOf('@media (min-width: 1100px)');
const block720 = css.slice(i720, i1100);
const block1100 = css.slice(i1100);

describe('story shell: the width steps up with the viewport', () => {
  it('base shell stays the phone column (560px)', () => {
    const shell = css.match(/\.story-shell \{[^}]*\}/)![0];
    expect(shell).toContain('max-width: 560px');
  });

  it('tablet step: 760px at ≥720, desktop step: 1120px with wider gutters at ≥1100', () => {
    expect(block720).toContain('.story-shell { max-width: 760px; }');
    expect(block1100).toContain('.story-shell { max-width: 1120px; padding-left: 32px; padding-right: 32px; }');
  });

  it('the tiers are theme-agnostic — no theme-scoped selector in the whole block', () => {
    expect(tiers).not.toContain('data-theme');
  });
});

describe('tale of the tape: a real value column at every width', () => {
  const labelOf = (s: string) => Number(s.match(/--tape-label-w: (\d+)px/)![1]);
  const baseLabel = labelOf(css.match(/\.story-tape \{[^}]*\}/)![0]);

  // The tape's value column, computed from the CSS constants: shell
  // content → tape inner (padding) → side (cols gap 18 when rowed) →
  // entry (padding) → value (label + the row's constant 12px gap).
  const valueAt = (o: { shell: number; shellPad: number; tapePad: number; entryPad: number; label: number; rowed: boolean }) => {
    const inner = o.shell - o.shellPad - o.tapePad;
    const side = o.rowed ? (inner - 18) / 2 : inner;
    return side - o.entryPad - o.label - 12;
  };

  it('label column steps with the tiers (86 → 96 → 104)', () => {
    expect(baseLabel).toBe(86);
    expect(labelOf(block720)).toBe(96);
    expect(labelOf(block1100)).toBe(104);
  });

  it('the pinch band stacks the sides instead of rowing them (520–719.98px)', () => {
    const band = css.indexOf('@media (min-width: 520px) and (max-width: 719.98px)');
    expect(band).toBeGreaterThan(-1);
    // the band override must come AFTER the base 520px row rule it tempers
    expect(band).toBeGreaterThan(css.indexOf('@media (min-width: 520px)'));
    expect(css.slice(band, band + 220)).toContain('.story-tape-cols { flex-direction: column; }');
  });

  it('value columns: phone stacked ~200px, band stacked ~370px, tablet rowed ~200px, desktop rowed ~340px', () => {
    // 390px phone: base shell (cap 560, 16px gutters), sides STACKED
    expect(valueAt({ shell: 390 - 32, shellPad: 0, tapePad: 32, entryPad: 28, label: baseLabel, rowed: false })).toBe(200);
    // 600px landscape phone / small tablet: the band — old math rowed
    // this to 113px; stacked it is the widest phone-family column
    expect(valueAt({ shell: 560 - 32, shellPad: 0, tapePad: 32, entryPad: 28, label: baseLabel, rowed: false })).toBe(370);
    // 800px tablet: 760 shell, rowed sides
    expect(valueAt({ shell: 760 - 32, shellPad: 0, tapePad: 32, entryPad: 28, label: labelOf(block720), rowed: true })).toBe(203);
    // 1440px desktop: 1120 shell, 32px gutters, 24px tape padding, 18px entry padding
    expect(valueAt({ shell: 1120 - 64, shellPad: 0, tapePad: 48, entryPad: 36, label: labelOf(block1100), rowed: true })).toBe(343);
  });

  it('desktop tape dressing steps up with the room (inner padding, stakes, entry padding, row size)', () => {
    expect(block1100).toContain('.story-tape-inner { padding: 22px 24px; }');
    expect(block1100).toContain('.story-tape-entry { padding: 16px 18px; }');
    expect(block1100).toContain('.story-tape-row { font-size: 14.5px; }');
  });
});

describe('story dock slot + targets', () => {
  it('the story slot is a true 46px square in every orientation', () => {
    expect(tiers).toContain('.story-topbar .dock-slot { width: 46px !important; }');
  });

  it('badge chips and the owner reset button meet the 44px target floor', () => {
    expect(tiers).toContain('.story-badge { min-height: 44px; }');
    expect(tiers).toContain('.story-reset .btn { min-height: 44px; }');
  });

  it('the sound dock tracks its slot on scroll (capture + passive), and unlistens on cleanup', () => {
    expect(sound).toContain("addEventListener('scroll', kick, { passive: true, capture: true })");
    expect(sound).toContain("removeEventListener('scroll', kick, true)");
  });
});

describe('wide-screen dressing: scene, map, action rows', () => {
  it('the scene steps up as ONE uniform tier — cast spec height changes, never per-card', () => {
    expect(block1100).toContain('.story-cast-one { height: 152px; }');
    expect(block1100).toContain('.story-cast-one .story-face.cast-face { width: 48px; height: 48px;');
    expect(block1100).toContain('.story-script-line { font-size: 18.5px; }');
    // the base spec is untouched: the tier is a media step, not a rewrite
    const card = css.match(/\.story-cast-one \{[^}]*\}/)![0];
    expect(card).toContain('height: 136px');
  });

  it('map art keeps its proportion as cards widen (92 → 120 → 152)', () => {
    expect(block720).toContain('.story-card-art { height: 120px; }');
    expect(block1100).toContain('.story-card-art { height: 152px; }');
    expect(block1100).toContain('.story-route .story-card-faces .story-face { width: 46px; height: 46px;');
  });

  it('action rows cap their buttons on desktop instead of stretching wall to wall', () => {
    expect(block1100).toContain('.story-stop-actions .btn { flex: 0 1 260px; }');
    expect(block1100).toContain('.story-outro-actions .btn { flex: 0 1 360px; }');
    expect(block1100).toContain('.story-intro-actions .btn { flex: 0 1 420px; }');
  });

  it('the lock card caps and centers when the shell runs wide', () => {
    expect(tiers).toContain('.story-lock-card { max-width: 560px; margin-left: auto; margin-right: auto; }');
  });
});
