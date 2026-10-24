import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Camera-on plate coverage (owner 2026-10-24, live Cutthroat screenshot): redrachel
 * (upper-left seat) turned her camera on and her video bubble swallowed her plate —
 * only "…CHEL" and "TOOK 0" peeked out, her BID chip was gone entirely, and the
 * bubble clipped off the left edge of the screen. Every camera-off seat rendered
 * correctly, and the owner's own bottom plate — camera on — was compact and
 * legible. His assumption: "this will happen with the others as well."
 *
 * The mechanism is a cascade break, not a sizing bug in the bubble. The bubble is
 * 84px at left:-18px BY DESIGN (online.css), and the design clears the plate body
 * for it: `.plate:has(> .vbubble) .plate-body { margin-left: 26px }`. But the
 * portrait compact composition (styles.css, 341–480px) restyles badge-layer plate
 * bodies with an UNGUARDED rule — `.table-screen:not(.short) .badge-layer
 * .plate-body { margin-left: -12px; … }` — whose specificity (0,4,0) beats the
 * clearance rule's (0,3,0). The compact pass guarded the bubble itself and its
 * ring vars with :not(:has(> .vbubble)) but not the body margin, so in exactly
 * the owner's context (portrait phone, badge layer) a cam-on plate body slid
 * back under the bubble: measured in Chromium with the shipped CSS, the bubble
 * covered the first 30px of the name and ~30px of the BID chip at the left, top
 * AND right seats, in both themes (the geometry is theme-shared), and the same
 * for the mic-only state (the audio-only bubble is the same 84px circle carrying
 * the player's picture). Your own plate is not in the badge layer, never lost
 * the 26px/16px clearance, and rendered fine — the reference rendering.
 *
 * The fix, pinned here: inside the compact block, bubble plates get the design's
 * own clearance back (margin-left 26px; padding-left 32px when the countdown
 * ring is up), and a left-seat bubble plate steps right by the bubble's 18px
 * overhang so the whole circle stays on screen (the me-plate's margin trick).
 * Same audit, one stale sibling: in landscape (.short) the ring vars still
 * described the 84px portrait bubble while the short bubble is 52px, so the
 * countdown ring drew off-centre and oversized around it — the vars now match
 * the circle they wrap, per the pair's own stated rule ("video bubble is the
 * visible circle: the ring wraps that").
 *
 * happy-dom paints nothing: these are cascade + geometry pins computed from the
 * shipped CSS (the seat-fit / plate-fit idiom). The Chromium harness numbers
 * behind them are in the header; the owner's iPhone is the pixel proof.
 */
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const online = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');

/** one shipped rule: selector + its declarations, found by a distinctive selector fragment */
function rule(src: string, fragment: string): { sel: string; decl: Map<string, string> } {
  const i = src.indexOf(fragment);
  expect(i, `rule containing ${fragment}`).toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  const sel = src.slice(src.lastIndexOf('}', i - 1) + 1, open).trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const decl = new Map<string, string>();
  for (const part of src.slice(open + 1, close).split(';')) {
    const [k, ...v] = part.split(':');
    if (k && v.length) decl.set(k.trim(), v.join(':').trim());
  }
  return { sel, decl };
}

/**
 * Specificity for this stylesheet's selector family, as a [classLevel,
 * elementLevel] pair compared lexicographically. :has/:not/:is contribute
 * their most specific argument (per spec); :where contributes nothing. No ids
 * appear in any selector scored here.
 */
function specBC(sel: string): [number, number] {
  let b = 0;
  let c = 0;
  const rest = sel.replace(/:(has|not|is|where)\(([^()]*)\)/g, (_m, fn: string, arg: string) => {
    if (fn !== 'where') {
      const best = arg.split(',').map((a) => specBC(a)).sort((x, y) => x[0] - y[0] || x[1] - y[1]).at(-1)!;
      b += best[0];
      c += best[1];
    }
    return ' ';
  });
  b += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const stripped = rest.replace(/\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ');
  c += stripped.split(/[\s>+~]+/).filter((t) => /^[a-z]/i.test(t)).length;
  return [b, c];
}
const specificity = (sel: string) => {
  const [b, c] = specBC(sel);
  return b * 1000 + c;
};

const px = (v: string | undefined) => {
  const m = /^(-?[\d.]+)px$/.exec(v ?? '');
  expect(m, `px value ${v}`).not.toBeNull();
  return Number(m![1]);
};

/** the portrait compact block (same slice plate-fit.test.ts pins) */
const compactStart = css.indexOf('@media (min-width: 341px) and (max-width: 480px)');
const compact = css.slice(compactStart, css.indexOf('\n}\n', compactStart) + 3);

describe('cam-on plates: the compact portrait cascade break (owner 2026-10-24)', () => {
  it('the design clearance exists in online.css and the compact body rule out-specifies it (the bug, in numbers)', () => {
    const clearance = rule(online, '.plate:has(> .vbubble) .plate-body');
    expect(clearance.decl.get('margin-left')).toBe('26px');
    const compactBody = rule(compact, '.badge-layer .plate-body {');
    expect(compactBody.decl.get('margin-left')).toBe('-12px');
    // (0,4,0) over (0,3,0): without a guarded override the compact margin wins
    // and the body slides under the bubble — this is the whole defect.
    expect(specificity(compactBody.sel)).toBeGreaterThan(specificity(clearance.sel));
  });

  it('the fix: bubble plates inside the compact block get the clearance back, and it out-specifies both rivals', () => {
    const fixed = rule(compact, '.badge-layer .plate:has(> .vbubble) .plate-body');
    expect(fixed.decl.get('margin-left')).toBe('26px');
    expect(fixed.sel).toContain('.badge-layer'); // scoped to the context that broke
    expect(specificity(fixed.sel)).toBeGreaterThan(specificity(rule(compact, '.badge-layer .plate-body {').sel));
    expect(specificity(fixed.sel)).toBeGreaterThan(specificity(rule(online, '.plate:has(> .vbubble) .plate-body').sel));
  });

  it('geometry, recomputed from the shipped constants: name and BID start clear of the bubble at every badge seat', () => {
    const avatar = rule(compact, '.badge-layer .plate-avatar {');
    const body = rule(compact, '.badge-layer .plate-body {');
    const bubble = rule(online, '\n.vbubble {');
    const fixed = rule(compact, '.badge-layer .plate:has(> .vbubble) .plate-body');
    const padLeft = body.decl.get('padding')!.trim().split(/\s+/)[3]!; // shorthand: top right bottom LEFT
    const textStart = px(avatar.decl.get('width')) + px(fixed.decl.get('margin-left')) + px(padLeft);
    const bubbleRight = px(bubble.decl.get('left')) + px(bubble.decl.get('width'));
    expect(bubbleRight).toBe(66); // -18 + 84: the designed circle
    expect(textStart - bubbleRight).toBeGreaterThanOrEqual(8); // measured 8px in Chromium, both themes
    // cam-off plates keep the compact body (the fix must not move them)
    expect(body.decl.get('margin-left')).toBe('-12px');
  });

  it('with the countdown ring up, bubble plates keep the ring name padding (32px) and the ring stays concentric', () => {
    const ringed = rule(compact, '.badge-layer .plate:has(> .vbubble):has(.turn-ring) .plate-body');
    expect(ringed.decl.get('padding-left')).toBe('32px');
    expect(specificity(ringed.sel)).toBeGreaterThan(specificity(rule(compact, '.badge-layer .plate-body {').sel));
    const vars = rule(css, '.plate:has(> .vbubble) { --ring-d');
    const d = px(vars.decl.get('--ring-d'));
    const x = px(vars.decl.get('--ring-x'));
    const pad = px(vars.decl.get('--ring-pad'));
    const bubble = rule(online, '\n.vbubble {');
    // ring centre == bubble centre (the ring wraps the visible circle)
    expect(x + (d + 2 * pad) / 2 - pad).toBe(px(bubble.decl.get('left')) + px(bubble.decl.get('width')) / 2);
    // arc hard edge (r = 16.2/36 of the box, arc stroke 2.55 units) clears the name
    const arcRight = x + d / 2 + (d + 2 * pad) * (16.2 / 36) + ((2.55 / 36) * (d + 2 * pad)) / 2;
    const textStart = 30 + 26 + 32; // compact avatar + restored margin + ring padding
    expect(textStart - arcRight).toBeGreaterThanOrEqual(8); // measured 9.6px in Chromium
  });

  it('the left seat: a bubble plate steps right by the bubble overhang, so the circle cannot clip off-screen', () => {
    const step = rule(compact, '.seat-anchor.side-left > .plate:has(> .vbubble)');
    const bubble = rule(online, '\n.vbubble {');
    expect(px(step.decl.get('margin-left'))).toBeGreaterThanOrEqual(-px(bubble.decl.get('left'))); // 18 >= 18
    expect(step.sel).toContain('.badge-layer');
  });

  it("your own plate is untouched: it never lived in the badge layer and its rules are byte-identical", () => {
    expect(compact).not.toContain('me-plate');
    expect(rule(online, '.plate.me-plate:has(> .vbubble.self) .plate-body').decl.get('margin-left')).toBe('16px');
    const self = rule(online, '.vbubble.self {');
    expect(self.decl.get('width')).toBe('66px');
    expect(self.decl.get('left')).toBe('-10px');
    expect(rule(css, '.plate.me-plate:has(> .vbubble.self) { --ring-d').decl.get('--ring-d')).toBe('66px');
  });
});

describe('landscape (.short): the ring wraps the landscape bubble, not the portrait one', () => {
  const pairs = [
    { bubbleSel: '\n.table-screen.short .vbubble {', varsSel: '.table-screen.short .plate:has(> .vbubble) { --ring-d' },
    { bubbleSel: '.table-screen.short .vbubble.self {', varsSel: '.table-screen.short .plate.me-plate:has(> .vbubble.self) { --ring-d' },
  ];
  for (const { bubbleSel, varsSel } of pairs) {
    it(`${varsSel} matches its bubble's size and offset`, () => {
      const b = rule(css, bubbleSel);
      const v = rule(css, varsSel);
      expect(v.decl.get('--ring-d')).toBe(b.decl.get('width'));
      expect(v.decl.get('--ring-x')).toBe(b.decl.get('left'));
    });
  }

  it('portrait pairs still match too (84/-18 remote, 66/-10 self, 44/-6 tiny phones)', () => {
    const tiny = rule(css, '.plate:has(> .vbubble), .plate.me-plate:has(> .vbubble.self),');
    expect(tiny.decl.get('--ring-d')).toBe('44px');
    expect(tiny.decl.get('--ring-x')).toBe('-6px');
    expect(rule(online, '\n.vbubble {').decl.get('width')).toBe('84px'); // portrait bubble itself unchanged
  });

  it('landscape text clearance was already honest: the short body margin is a positive clearance, not the compact tuck', () => {
    const shortBody = rule(css, '.table-screen.short .plate:has(> .vbubble) .plate-body');
    expect(px(shortBody.decl.get('margin-left'))).toBeGreaterThanOrEqual(10);
  });
});
