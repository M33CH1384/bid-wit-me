/**
 * Chrome hit-area repair — owner, 2026-11-03, at a landscape table (Neon,
 * bidding panel open): "I can't hit the menu button at the top left and the
 * audio setting button is hard to hit as well."
 *
 * Measured on the capture rig (932×430 and 844×390, both themes, safe-area
 * insets L/R 47 B 21, 7×7 elementFromPoint grids over the visible chips):
 * the slant clip-path shared by the chrome icon buttons clips the HIT area
 * with the paint — the top-left and bottom-right corner triangles of every
 * clipped control were dead (menu-corner taps fell through the
 * pointer-events:none header to the 3D canvas; speaker-corner taps landed
 * on the handler-less .sound-dock wrapper). The scorebug pair was also
 * undersized: menu chip 36×38 in short landscape, in-bug speaker 40×40 in a
 * 40×38 slot — both below 44×44 before any clip loss. Real centre taps
 * worked; real corner taps on the mandated 44×44 rect did nothing.
 *
 * The repair (appended block at the end of styles.css) moves each control's
 * PAINT — glass background, inset ring, slant clip, backdrop blur — onto a
 * pointer-events:none ::before that keeps the exact chip geometry, while
 * the element itself becomes a transparent, un-clipped hit box of at least
 * 44×44. Negative margins keep every layout footprint identical, so the
 * bar, the glyphs and the neighbouring panels do not move. These pins hold
 * that geometry: the elements must stay un-clipped and transparent, the
 * ::before layers must carry the original paint at the original offsets,
 * the grown boxes must land exactly on 44×44 with margin-boxes equal to
 * the old footprints, and the slot reservations must not change.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const socialCss = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');
const storyCss = readFileSync(new URL('../src/story/story.css', import.meta.url), 'utf8');

/** Leaf rules of a stylesheet in source order: comments stripped, @media
 *  blocks flattened (the asserted selectors are never media-scoped except
 *  the ≤400px menu growth, which no pin reads). Selector matching is EXACT —
 *  a rule counts when its selector, or one member of its selector group,
 *  equals the requested selector, so a longer selector that merely ends
 *  with the requested one (`.table-screen.short .scorebug > …`) never
 *  pollutes the base selector's blocks. */
function leafRules(source: string): { selector: string; body: string }[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      const selector = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const inner = text.slice(open + 1, j - 1);
      if (selector.startsWith('@media') || selector.startsWith('@supports')) walk(inner);
      else if (selector && !selector.startsWith('@')) out.push({ selector, body: inner });
      i = j;
    }
  };
  walk(clean);
  return out;
}
function blocksFor(source: string, selector: string): string[] {
  return leafRules(source)
    .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector))
    .map((r) => r.body);
}
/** The last block for `selector` that declares `prop` — the cascade winner. */
function winningBlock(source: string, selector: string, prop: string): string {
  const blocks = blocksFor(source, selector).filter((b) => b.includes(prop));
  if (!blocks.length) throw new Error(`no rule for ${selector} declaring ${prop}`);
  return blocks[blocks.length - 1]!;
}
/** Body of the first rule whose selector list contains `fragment`. */
function ruleBody(source: string, fragment: string): string {
  const idx = source.indexOf(fragment);
  if (idx < 0) throw new Error(`selector not found: ${fragment}`);
  const open = source.indexOf('{', idx);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

const SLANT8 = 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)';
const SLANT9 = 'polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px)';

describe('scorebug menu button: un-clipped 44px hit box, paint on ::before', () => {
  const SEL = '.scorebug > .menu-wrap > .bug-btn';
  it('the element itself carries no clip and no paint', () => {
    const clip = winningBlock(css, SEL, 'clip-path');
    expect(clip).toContain('clip-path: none');
    expect(clip).toContain('background: transparent');
    expect(clip).toContain('box-shadow: none');
  });
  it('the hit box is 44 wide; negative margins keep the 38px footprint', () => {
    const block = winningBlock(css, SEL, 'width');
    expect(block).toContain('width: 44px');
    expect(block).toContain('margin-left: -3px');
    expect(block).toContain('margin-right: -3px');
    // margin-box = 44 - 3 - 3 = 38 = the old chip width: the bug panel cannot shift
    expect(44 - 3 - 3).toBe(38);
  });
  it('the ::before paints the original chip: glass, ring, 8px slant, blur', () => {
    const before = blocksFor(css, `${SEL}::before`)[0]!;
    expect(before).toContain('pointer-events: none');
    expect(before).toContain('background: var(--glass)');
    expect(before).toContain(`clip-path: ${SLANT8}`);
    expect(before).toContain('backdrop-filter: blur(10px)');
    expect(before).toContain('left: 3px');
    expect(before).toContain('right: 3px');
  });
  it('short landscape: box grows to 44×44 around the 36×38 chip', () => {
    const SHORT = '.table-screen.short .scorebug > .menu-wrap > .bug-btn';
    const block = blocksFor(css, SHORT)[0]!;
    expect(block).toContain('width: 44px');
    expect(block).toContain('height: 44px');
    expect(block).toContain('margin: -3px -4px');
    // footprint: 44 - 2*4 = 36 wide, 44 - 2*3 = 38 tall — the old chip box
    expect(44 - 2 * 4).toBe(36);
    expect(44 - 2 * 3).toBe(38);
    // glyph content box = chip box: padding 3px 4px re-centres the ☰ on the paint
    expect(block).toContain('padding: 3px 4px');
    const before = blocksFor(css, `${SHORT}::before`)[0]!;
    expect(before).toContain('left: 4px');
    expect(before).toContain('top: 3px');
    expect(before).toContain('bottom: 3px');
  });
});

describe('sound dock button: paint on ::before in every context', () => {
  it('the base element is un-clipped; the ::before carries the 9px slant chip', () => {
    expect(winningBlock(css, '.dock-btn', 'clip-path')).toContain('clip-path: none');
    const before = blocksFor(css, '.dock-btn::before')[0]!;
    expect(before).toContain('pointer-events: none');
    expect(before).toContain('background: var(--glass-strong)');
    expect(before).toContain(`clip-path: ${SLANT9}`);
    expect(before).toContain('inset: 0');
  });
  it('state rings (muted / playing / needs-tap) paint on the chip layer', () => {
    expect(blocksFor(css, '.dock-btn.muted::before')[0]).toContain('rgba(255,77,109,.6)');
    expect(blocksFor(css, '.dock-btn.playing::before')[0]).toContain('var(--gold)');
    expect(blocksFor(css, '.dock-btn.needs-tap::before')[0]).toContain('rgba(255,217,105,.28)');
    // …and no longer on the element, where they would re-clip nothing but mislead
    expect(winningBlock(css, '.dock-btn.needs-tap', 'box-shadow')).toContain('box-shadow: none');
  });
  it('in-bug (the table speaker): 44×44 hit box around the unchanged 40×40 chip', () => {
    const SEL = '.sound-dock.slotted.in-bug .dock-btn';
    const block = winningBlock(css, SEL, 'width');
    expect(block).toContain('width: 44px !important');
    expect(block).toContain('height: 44px !important');
    expect(block).toContain('margin: -3px -2px');
    // content box = chip box, so the speaker glyph stays centred on the paint
    expect(block).toContain('padding: 3px 2px 1px');
    const before = blocksFor(css, `${SEL}::before`)[0]!;
    expect(before).toContain('left: 2px');
    expect(before).toContain('top: 3px');
    expect(before).toContain('background: var(--glass)');
    expect(before).toContain(`clip-path: ${SLANT8}`);
    // chip size from the ::before offsets: 44-2-2 wide, 44-3-1 tall = the old 40×40
    expect(44 - 2 - 2).toBe(40);
    expect(44 - 3 - 1).toBe(40);
  });
});

describe('wizard cluster (home / lobby top bar): corners restored, boxes unchanged', () => {
  it('gear and dock are un-clipped with the dark chip on ::before', () => {
    const body = ruleBody(css, '.wiz-right .dock-btn::before, .wiz-right .icon-btn.gear::before');
    expect(body).toContain('background: rgba(20,11,34,.85)');
    expect(body).toContain(`clip-path: ${SLANT8}`);
    expect(body).toContain('pointer-events: none');
    expect(winningBlock(css, '.wiz-right .icon-btn.gear', 'clip-path')).toContain('clip-path: none');
  });
  it('the cluster sizing rule still makes every control 44×44', () => {
    const body = ruleBody(css, '.wiz-right .icon-btn.gear, .wiz-right .social-btn, .wiz-right .dock-btn');
    expect(body).toContain('width: 44px');
    expect(body).toContain('height: 44px');
  });
  it('social button: un-clipped in the wizard, chip on ::before', () => {
    // the de-clip lives in styles.css, AFTER the cluster rule — social.css
    // loads first, so the same rule there would lose the cascade (measured:
    // the wizard Social corners stayed dead until the rule moved here)
    expect(winningBlock(css, '.wiz-right .social-btn', 'clip-path')).toContain('clip-path: none');
    const before = blocksFor(css, '.wiz-right .social-btn::before')[0]!;
    expect(before).toContain('background: rgba(20,11,34,.85)');
    expect(before).toContain(`clip-path: ${SLANT8}`);
    expect(before).toContain('pointer-events: none');
    // non-wizard .social-btn surfaces keep their own clipped paint
    expect(blocksFor(socialCss, '.social-btn')[0]).toContain('clip-path:');
  });
  it('the scorebug slot span must not clip its portaled control', () => {
    // the slot carries .bug-btn (the in-bug seat marker) and with it the
    // slant clip — applied to the span it clipped the grown dock box back
    // to the slot's 40×38 polygon (measured: 43/49, corner taps dead)
    expect(winningBlock(css, '.scorebug .dock-slot', 'clip-path')).toContain('clip-path: none');
  });
});

describe('slot reservations are untouched (the fix grows hit boxes, never layout)', () => {
  it('scorebug slot stays 40px; story topbar slot stays 46px', () => {
    expect(winningBlock(css, '.scorebug .dock-slot', 'width')).toContain('width: 40px');
    expect(winningBlock(storyCss, '.story-topbar .dock-slot', 'width')).toContain('width: 46px');
  });
  it('the slotted dock still fills its slot in flow (D1 portal contract)', () => {
    const block = blocksFor(css, '.sound-dock.slotted')[0]!;
    expect(block).toContain('position: relative');
    expect(block).toContain('width: 100%');
    expect(block).toContain('height: 100%');
  });
});
