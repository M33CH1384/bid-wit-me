/**
 * Versus intro fit (owner, 2026-10-28, screenshot photo-7): three defects on
 * the pre-match card.
 *
 * (1) The scouting lines read "You13–28 · 32%", "DariusFirst time riding
 * together · Shark · won't Nil" — the name GLUED to its facts. The JSX had
 * shipped the name and the segments as separate spans (2026-10-23), but the
 * .versus-card* styles never landed, so the spans rendered as one run of
 * inline text. The fix is the missing card family: the line is a flex row,
 * the name its own gold label, the facts across a real gap.
 *
 * (2) In landscape the card stayed a 440px portrait column and words hid.
 * The short-landscape band now widens the loading card and composes the
 * shake as a two-pane grid (matchup left, tape + cards right).
 *
 * (3) "I shouldn't have to scroll on this page": the whole intro — header,
 * VS faces, tape, scouting, TAP TO SKIP + progress track — must fit the
 * initial viewport at 932×430, 844×390, 390×844, 430×932 in both themes.
 * The browser-measured gate is probe-versus.mjs (worktree harness, run with
 * ASSERT=1 over the team/pot/guest/story/solo fixtures); these pins hold
 * the CSS structure that measurement depends on, including the story tape's
 * portrait compression and its horizontal-row landscape form (the King
 * card is the max-content case: stakes + three rows + threat + terms +
 * history).
 *
 * 2026-10-29 (owner, Corner screenshot): in landscape the matchup itself
 * turns vertical — team A upper, VS in the middle, team B lower — inside
 * the same two-pane grid. The pins below hold that stack: the team stage
 * becomes a centred column (the cutthroat quad is excluded), the VS badge
 * centres on the stack, the entrances/settle/rest poses converge
 * vertically, and faces shrink just enough (52 → 48px) for the stack to
 * fit the short pane with nothing below the fold. Portrait is untouched.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const landscapeStart = css.indexOf('@media (orientation: landscape) and (max-height: 560px)');
const landscape = css.slice(landscapeStart, css.indexOf('/* Stand-in table', landscapeStart));

describe('versus fit: the scouting name can never touch its facts', () => {
  it('the card family styles exist (they never landed with the 2026-10-23 content)', () => {
    expect(css).toContain('.versus-cards {');
    expect(css).toContain('.versus-card-side {');
    expect(css).toContain('.versus-card-headline {');
    expect(css).toContain('.versus-card-name {');
    expect(css).toContain('.versus-card-segs {');
  });

  it('the line is a flex row with a real gap, the name its own gold label', () => {
    expect(css).toContain('.versus-card-line { display: flex');
    expect(css).toMatch(/\.versus-card-line \{[^}]*gap: 2px 8px/);
    expect(css).toMatch(/\.versus-card-name \{[^}]*color: var\(--gold\)/);
    expect(css).toMatch(/\.versus-card-name \{[^}]*white-space: nowrap/);
    // the facts wrap inside their own span instead of pushing off-canvas
    expect(css).toMatch(/\.versus-card-line \{[^}]*flex-wrap: wrap/);
  });

  it('card beats ride the same arms as every other beat (paint gate, done/reduced, OS reduced motion)', () => {
    expect(css).toContain('.versus:not(.play) .versus-card-line');
    expect(css).toContain('.versus:not(.play) .versus-card-headline');
    expect(css).toContain('.versus.done .versus-card-line, .versus.reduced .versus-card-line');
    expect(css).toContain('.versus.done .versus-card-headline, .versus.reduced .versus-card-headline');
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('.versus-card-headline, .versus-card-line, .versus-skip { animation: none !important; }');
  });

  it('the D5 compact band shrinks the cards with the rest of the stack', () => {
    const compactStart = css.indexOf('@media (max-height: 560px)');
    const compact = css.slice(compactStart, css.indexOf('/* Pre-deal setup window', compactStart));
    expect(compact).toContain('.versus-cards { gap: 6px 12px; }');
    expect(compact).toContain('.versus-card-segs { font-size: 12px;');
  });
});

describe('versus fit: landscape goes wide and nothing scrolls', () => {
  it('the short-landscape band exists and widens the versus loading card', () => {
    expect(landscapeStart).toBeGreaterThan(0);
    expect(landscape).toContain('.bwm-loading-card:has(.versus) { width: min(100%, 920px); }');
    expect(landscape).toContain('.bwm-loading-card:has(.versus) .bwm-loading-mark { width: min(36%, 148px); }');
  });

  it('the shake composes as a two-pane grid: stage left, tape + cards right, skip across the foot', () => {
    expect(landscape).toContain('grid-template-areas: "stage tape" "stage cards" "skip skip"');
    expect(landscape).toContain('.versus-stage { grid-area: stage;');
    expect(landscape).toContain('.versus-tape { grid-area: tape; }');
    expect(landscape).toContain('.versus-cards { grid-area: cards; }');
    expect(landscape).toContain('.versus-skip, .versus-wait { grid-area: skip;');
  });

  it('solo tape rows go single-line across the wide pane', () => {
    expect(landscape).toContain('.versus-row.solo { grid-template-columns: auto repeat(4, 1fr);');
  });
});

describe('versus fit: landscape stacks the matchup vertically (owner, 2026-10-29)', () => {
  it('the team stage becomes a centred column filling the left pane height; the quad is excluded', () => {
    expect(landscape).toContain('.versus-stage:not(.solo) { flex-direction: column; justify-content: center; align-items: center; align-self: stretch; gap: 44px; }');
    expect(landscape).toContain('.versus-stage:not(.solo) .versus-side { width: auto; }');
    // the plain stage rule stays the shipped grid placement — no column leaks onto the solo quad
    expect(landscape).toContain('.versus-stage { grid-area: stage; width: 100%; }');
    expect(landscape).not.toContain('.versus-stage.solo { flex-direction: column');
  });

  it('the VS badge and its flash centre on the stack, between the two teams', () => {
    expect(landscape).toContain('.versus-stage:not(.solo) .versus-vs, .versus-stage:not(.solo) .versus-flash { top: 50%; }');
  });

  it('faces shrink to 48px inside the stack only (still large enough to read)', () => {
    expect(landscape).toContain('.versus-stage:not(.solo) .versus-face { width: 48px !important; height: 48px !important; }');
    expect(landscape).toContain('.versus-stage:not(.solo) .versus-face .avatar-circle, .versus-stage:not(.solo) .versus-face > span { width: 48px !important; height: 48px !important; font-size: 20px !important; }');
  });

  it('entrances converge vertically and the settle/rest poses turn with the stack', () => {
    expect(landscape).toContain('.versus-stage:not(.solo) .versus-side.left { animation: versus-in-top');
    expect(landscape).toContain('.versus-stage:not(.solo) .versus-side.right { animation: versus-in-bottom');
    expect(landscape).toContain('@keyframes versus-in-top { from { transform: translateY(-38vh)');
    expect(landscape).toContain('@keyframes versus-in-bottom { from { transform: translateY(38vh)');
    expect(landscape).toContain('@keyframes versus-settle-t');
    expect(landscape).toContain('@keyframes versus-settle-b');
    expect(landscape).toContain('.versus.done .versus-stage:not(.solo) .versus-side.left, .versus.reduced .versus-stage:not(.solo) .versus-side.left { transform: translateY(5%); }');
    expect(landscape).toContain('.versus.done .versus-stage:not(.solo) .versus-side.right, .versus.reduced .versus-stage:not(.solo) .versus-side.right { transform: translateY(-5%); }');
  });

  it('portrait keeps the shipped horizontal stage, byte for byte', () => {
    expect(css).toContain('.versus-stage { position: relative; width: 100%; min-height: 168px; display: flex; align-items: center; justify-content: space-between; }');
    const beforeLandscape = css.slice(0, landscapeStart);
    expect(beforeLandscape).not.toContain('versus-in-top');
    expect(beforeLandscape).not.toContain('.versus-stage:not(.solo)');
  });
});

describe('versus fit: the story (max-content) card fits portrait and landscape', () => {
  it('portrait phones compress ONLY story-tape cards', () => {
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('.versus:has(.versus-story-row) .versus-stage { min-height: 124px; }');
    expect(css).toContain('.versus:has(.versus-story-row) .versus-tape { padding: 9px 12px 7px; }');
  });

  it('landscape: story rows go horizontal and the terms line gets a real size (it inherited body text)', () => {
    expect(landscape).toContain('.versus-tape.story { padding: 6px 12px 5px; }');
    // the empty cards row of the two-pane grid collapses for story shakes,
    // so its row-gap cannot eat the short viewport's last pixels
    expect(landscape).toContain('.versus-shake:has(> .versus-tape.story) { grid-template-areas: "stage tape" "stage tape" "skip skip"; }');
    expect(landscape).toContain('.versus-story-row { flex-direction: row;');
    expect(landscape).toContain('.versus-story-name { flex: none; }');
    expect(landscape).toMatch(/\.versus-story-line\.terms \{ font-size: [\d.]+px;/);
    expect(landscape).toMatch(/\.versus-story-text \{ font-size: [\d.]+px;/);
  });
});
