/**
 * /story header regression pins (owner screenshot, 2026-10-21: the map's
 * back arrow, title and subtitle rendered blurred/washed as if under
 * frosted glass, with the speaker dock in a stray purple outline box).
 *
 * Root cause: .story-shell padded a flat 16px at the top — no
 * env(safe-area-inset-top) — so on a notched iPhone in standalone mode
 * the header rendered inside iOS's frosted status-bar zone (everything
 * below the zone was sharp, matching the screenshot exactly), and /story
 * offered the SoundDock no .dock-slot, so it fell back to a fixed corner
 * float over the header. Structural tests can't see blur; these pins
 * guard the two mechanisms so neither can come back silently.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/story/story.css', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/story/StoryHome.tsx', import.meta.url), 'utf8');
const scene = readFileSync(new URL('../src/story/ScriptPlayer.tsx', import.meta.url), 'utf8');

describe('/story header: sharp, safe-area clear, dock slotted', () => {
  it('the shell pads the top safe area, so the header never sits in the frosted status-bar zone', () => {
    const shell = css.match(/\.story-shell \{[^}]*\}/)![0];
    expect(shell).toContain('env(safe-area-inset-top)');
  });

  it('no backdrop-filter / blur filters anywhere in story CSS (the rewards-blur pattern)', () => {
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toMatch(/filter:\s*blur/);
  });

  it('deck-unlock integration: a posted result invalidates the picker cache and a first clear names its deck', () => {
    expect(home).toContain("from '../storyDecks'");
    // the postStoryResult handler drops the cached story progress so the
    // Setup deck picker sees the fresh clear without a reload
    const handler = home.match(/postStoryResult\([\s\S]*?\.then\(\(r\) => \{[\s\S]*?\}\)/)![0];
    expect(handler).toContain('invalidateStoryProgress()');
    // the outro renders the deck notice beside the first-clear reward line
    expect(home).toContain('data-testid="story-deck-notice"');
    expect(home).toContain('deckUnlockNotice(r.stopId)');
    expect(css).toContain('.story-deck-line');
  });

  it('every story topbar offers the sound dock a real in-flow slot (no corner float, no stray box)', () => {
    expect((home.match(/className="dock-slot"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const topbar = css.match(/\.story-topbar \{[^}]*\}/)![0];
    expect(topbar).not.toContain('padding-right: 56px'); // the old dodge for the floating dock
    expect(css).toContain('.story-topbar .dock-slot');
  });
});

/**
 * Story design language (owner screenshot, 2026-10-21: the Porch card's
 * action row circled — the Restart ghost button clipped by the card's
 * right edge, two plain-HTML-look ghost buttons beside a big chamfered
 * ESPN-gold RESUME block, and a broadcast-gold MATCH IN PROGRESS chip).
 *
 * Root causes, all structural: the story buttons had no family of their
 * own — `.btn`/`.ghost` are unstyled globally, so the secondaries fell
 * back to UA buttons while `.primary` pulled the global broadcast look
 * (clip-path chamfer, condensed all-caps) — and the row sized buttons by
 * content at the right edge, so three of them overflowed the card.
 * These pins guard the fix: one warm rounded family inside .story-shell,
 * hierarchy by fill only, and an action row laid out on flex fractions
 * of the card (with one designed wrap), so overflow is not possible.
 * happy-dom paints nothing, so these pin the structure, not pixels.
 */
describe('story design language: one warm button family, no broadcast chrome', () => {
  const design = css.slice(css.indexOf('story design language'));

  it('the ESPN chamfer never enters story CSS', () => {
    expect(css).not.toContain('clip-path: polygon');
  });

  it('story buttons are one rounded family in the reading font, sentence case, 44px targets', () => {
    const base = design.match(/\.story-shell \.btn \{[^}]*\}/)![0];
    expect(base).toContain('clip-path: none');
    expect(base).toContain('min-height: 44px');
    expect(base).toContain('border-radius: 12px');
    expect(base).toContain('text-transform: none');
    expect(base).toContain('font-family: inherit');
  });

  it('primary and secondary are the same shape — hierarchy by fill, not by form', () => {
    const primary = design.match(/\.story-shell \.btn\.primary \{[^}]*\}/)![0];
    const ghost = design.match(/\.story-shell \.btn\.ghost \{[^}]*\}/)![0];
    expect(primary).toContain('#241a05'); // dark ink on warm amber
    expect(primary).not.toContain('clip-path');
    expect(ghost).toContain('border-color: rgba(238, 201, 106'); // amber hairline, not a UA outline
    expect(ghost).not.toContain('clip-path');
  });

  it('the stop action row distributes by flex fractions, so no button can overflow the card', () => {
    const btns = design.match(/\.story-stop-actions \.btn \{[^}]*\}/)![0];
    expect(btns).toContain('flex: 1 1 0');
    expect(btns).toContain('min-width: 0');
    // the three-action (in-progress) row wraps BY DESIGN at phone widths:
    // the primary takes its own line, the secondaries split the next
    expect(design).toContain('.story-stop-actions:has(.story-restart) .btn.primary');
    expect(design).toContain('flex: 1 1 100%');
    // no story action button carries a fixed pixel width
    expect(design).not.toMatch(/\.story-(meet|play|restart) \{[^}]*width:/);
  });

  it('state chips are quiet captions over the art, not solid broadcast blocks', () => {
    const chip = design.match(/\.story-card-state \{[^}]*\}/)![0];
    expect(chip).toContain('border: 1px solid rgba(');
    expect(chip).toContain('background: rgba('); // translucent shade, not a solid block
    const here = design.match(/\.story-card-state\.here \{[^}]*\}/)![0];
    expect(here).not.toContain('background: #c9a227'); // the old solid ESPN gold
    expect(here).toContain('rgba(238, 201, 106'); // warm amber hairline instead
  });
});

/**
 * Tale of the Tape rework (owner screenshot, 2026-10-21: "that intro page
 * really needs to be reworked — it's odd and the typography is off, there's
 * weird spacing in it as well"). The old detail rows were one flowing
 * paragraph each — an inline-block label with a min-width but NO gap — so
 * "KNOWN FOR" (wider than the min) ran straight into its value while
 * "WHO" left a hanging gap, wrapped lines ran back under the label, and
 * the backdrop photo's diagonal edges cut across the translucent card.
 * Content is frozen; these pins guard the new structure: a two-column
 * grid with one constant gap, an even scrim, the history line as a
 * hairline caption, and a designed medallion for the player. happy-dom
 * paints nothing — the owner's iPhone remains the visual verdict.
 */
describe('tale of the tape: grid rows, even scrim, one type system', () => {
  const tapeCss = css.slice(css.indexOf('Tale of the Tape'), css.indexOf('story badges'));
  const tapeSrc = readFileSync(new URL('../src/story/StoryTape.tsx', import.meta.url), 'utf8');

  it('detail rows are a two-column grid — fixed label column, one constant gap', () => {
    const root = tapeCss.match(/\.story-tape \{[^}]*\}/)![0];
    expect(root).toContain('--tape-label-w:');
    const row = tapeCss.match(/\.story-tape-row \{[^}]*\}/)![0];
    expect(row).toContain('display: grid');
    expect(row).toContain('grid-template-columns: var(--tape-label-w)');
    expect(row).toContain('column-gap: 12px');
    // the old inline-label mechanism is gone for good
    expect(tapeCss).not.toContain('.story-tape-row span');
    expect(tapeCss).not.toContain('min-width: 74px');
  });

  it('no justified text anywhere in story CSS; tape values are left-aligned', () => {
    expect(css).not.toMatch(/text-align:\s*justify/);
    const value = tapeCss.match(/\.story-tape-value \{[^}]*\}/)![0];
    expect(value).toContain('text-align: left');
    const label = tapeCss.match(/\.story-tape-label \{[^}]*\}/)![0];
    expect(label).toContain('text-transform: uppercase');
  });

  it('rows are built from label + value spans, and the threat is a labeled row', () => {
    expect(tapeSrc).toContain('story-tape-label');
    expect(tapeSrc).toContain('story-tape-value');
    expect(tapeSrc).toContain('label="The threat"');
    for (const l of ['Who', 'Known for', 'The tell', 'The bond']) expect(tapeSrc).toContain(`label="${l}"`);
  });

  it('the card sits on an even scrim — its own backdrop layer, no gradient, near-opaque entries', () => {
    const scrim = tapeCss.match(/\.story-tape-bg::after \{[^}]*\}/)![0];
    expect(scrim).toContain('background: rgba(');
    expect(scrim).not.toContain('gradient');
    const entry = tapeCss.match(/\.story-tape-entry \{[^}]*\}/)![0];
    expect(entry).toContain('rgba(9, 9, 18, 0.9)');
    // the tape never borrows the scene player's background layer
    expect(tapeSrc).toContain('story-tape-bg');
    expect(tapeSrc).not.toContain('story-scene-bg');
  });

  it('the history line is a hairline caption in the story family, not the heavy gold box', () => {
    const hist = tapeCss.match(/\.story-tape-history \{[^}]*\}/)![0];
    expect(hist).toContain('rgba(238, 201, 106'); // warm amber hairline, like the map chips
    expect(hist).not.toContain('border: 1px solid #c9a227');
  });

  it('You wears a designed monogram medallion in the cast family', () => {
    expect(tapeSrc).toContain('story-you-face');
    const face = tapeCss.match(/\.story-you-face \{[^}]*\}/)![0];
    expect(face).toContain('radial-gradient');
    expect(face).toContain('box-shadow'); // the medallion ring
  });

  it('one spacing scale: the shell gap carries the rhythm, entries carry no margins', () => {
    const inner = tapeCss.match(/\.story-tape-inner \{[^}]*\}/)![0];
    expect(inner).toContain('padding: 16px');
    expect(inner).toContain('gap: 14px');
    const side = tapeCss.match(/\.story-tape-side \{[^}]*\}/)![0];
    expect(side).toContain('display: flex');
    expect(side).toContain('gap: 8px');
    const entry = tapeCss.match(/\.story-tape-entry \{[^}]*\}/)![0];
    expect(entry).not.toContain('margin-bottom');
  });
});

/**
 * Scene player layout reservation (owner screenshot, 2026-10-21: "As
 * text is added the divs on this screen just keep jumping in size
 * rather than growing smoothly"). The old dialogue card sized to the
 * REVEALED prefix, so every newly wrapped line grew the box a step
 * and shoved the Skip/Next row; the cast cards sized to their own
 * wrapping text, so the strip's height depended on the stop's cast.
 * The fix reserves space: the dialogue body is pinned to the height
 * of the FULL beat (measured on a hidden sizer rendering the whole
 * line), height changes only ever happen between beats and glide on
 * a transition, and every cast card shares one spec height with the
 * name/role clamped to it. happy-dom paints nothing — these pins
 * guard the mechanisms; the render-level pins live in
 * story-scene.test.ts and the owner's iPhone is the pixel verdict.
 */
describe('scene player: reserved layout — only the words move', () => {
  it('the dialogue body glides between reserved heights (~200ms) and anchors the sizer', () => {
    const body = css.match(/\.story-script-body \{[^}]*\}/)![0];
    expect(body).toContain('transition: height 0.2s ease');
    expect(body).toContain('position: relative'); // the sizer anchors to the body
    // reduced motion: the reservation still applies, the glide does not
    const reduced = css.match(/\.story-scene\.reduce \.story-script-body \{[^}]*\}/)![0];
    expect(reduced).toContain('transition: none');
  });

  it('a hidden sizer renders the full beat to measure the reservation', () => {
    const sizer = css.match(/\.story-script-sizer \{[^}]*\}/)![0];
    expect(sizer).toContain('position: absolute');
    expect(sizer).toContain('visibility: hidden');
    expect(sizer).toContain('pointer-events: none');
    // the component renders the sizer inside the body and measures it
    expect(scene).toContain('data-testid="story-script-sizer"');
    expect(scene).toContain('reservedBodyHeight');
    expect(scene).toContain('useLayoutEffect');
  });

  it('cast cards share ONE spec height; name and role clamp to the spec', () => {
    const card = css.match(/\.story-cast-one \{[^}]*\}/)![0];
    expect(card).toContain('box-sizing: border-box');
    expect(card).toContain('height: 136px');
    expect(card).toContain('overflow: hidden');
    const name = css.match(/\.story-cast-name \{[^}]*\}/)![0];
    expect(name).toContain('-webkit-line-clamp: 2');
    const role = css.match(/\.story-cast-role \{[^}]*\}/)![0];
    expect(role).toContain('-webkit-line-clamp: 3');
  });

  it('the active-speaker treatment changes no geometry — border, glow, opacity only', () => {
    const active = css.match(/\.story-cast-one\.active \{[^}]*\}/)![0];
    for (const prop of ['height:', 'padding:', 'margin:', 'font-size:', 'line-height:', 'width:']) {
      expect(active).not.toContain(prop);
    }
    expect(active).toContain('border-color');
    expect(active).toContain('box-shadow');
    const dim = css.match(/\.story-cast-one\.dim \{[^}]*\}/)![0];
    expect(dim).toContain('opacity');
    expect(dim).not.toContain('height:');
  });

  it('the hint lives inside the reservation: always mounted, one reserved line', () => {
    const hint = css.match(/\.story-script-hint \{[^}]*\}/)![0];
    expect(hint).toContain('min-height: 1em');
    // the sizer carries the hint slot too, so it is part of the measured height
    expect(scene).toContain('story-script-sizer');
  });
});
