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
 * ASSERT=1 over the team/pot/guest/sparse/full/story/solo/corner fixtures —
 * sparse is the owner's 2026-10-29 "ESPN would Neva" screenshot table: no
 * tape, no human line, one partner line, two opponent lines; the probe also
 * asserts the landscape composition: every scouting line inside the panel,
 * the label rhythm at the owner phone widths, the unit centred); these pins
 * hold the CSS structure that measurement depends on, including the story tape's
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
 *
 * 2026-10-30 (owner, portrait screenshot — Backyard Cookout, you + Unc vs
 * Sven & Elena): "this screen still isn't right — things should be lined
 * up in a way to make it easy to read in a glance." The portrait cards
 * were never reworked: two ~165px centred columns, so UNC's and SVEN's
 * names stacked over their facts while ELENA's sat inline, and the facts
 * wrapped mid-phrase ("won't / Nil" split across lines). The fix is ONE
 * alignment system in both orientations: the blocks stack full-width
 * under a hairline divider, and every player is one row of three fixed
 * columns — NAME (gold, 80px) · RELATION+RECORD (152px) · TRAITS (1fr,
 * one nowrap chip per segment, wrapping ONLY at a "·" separator). The
 * member model split into columns with it (botMemberColumns /
 * humanMemberColumns in VersusIntro.tsx). The 2026-10-29 landscape
 * label-rhythm band (82px name flex, side-by-side blocks, left border)
 * is retired: landscape keeps its panel + vertical matchup stack, and
 * the lines inside the panel are the same grid rows as portrait. The
 * probe asserts the geometry: identical name/rel/traits left edges in
 * every row, name and rel cells single-line, no chip ever split.
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
    expect(css).toContain('.versus-card-rel {');
    expect(css).toContain('.versus-card-segs {');
    expect(css).toContain('.versus-card-seg {');
  });

  it('the line is a three-column grid, the name its own gold label', () => {
    // fixed NAME and RELATION tracks + a fluid TRAITS track: the column
    // edges are identical in every row by construction, so a name can
    // never touch its facts and facts never centre or scatter
    expect(css).toContain('.versus-card-line { display: grid; grid-template-columns: 80px 152px minmax(0, 1fr); column-gap: 8px;');
    expect(css).toMatch(/\.versus-card-name \{[^}]*color: var\(--gold\)/);
    expect(css).toMatch(/\.versus-card-name \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.versus-card-rel \{[^}]*white-space: nowrap/);
    // a trait is one nowrap chip; the traits cell wraps ONLY between chips
    // (at a "·" separator), never inside a phrase like "won't Nil"
    expect(css).toMatch(/\.versus-card-segs \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.versus-card-seg \{[^}]*white-space: nowrap/);
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

describe('versus fit: one glanceable grid in every orientation (owner, 2026-10-30)', () => {
  const beforeLandscape = css.slice(0, landscapeStart);

  it('the team blocks stack full-width and mirror each other exactly', () => {
    // one column of blocks — the second block is the first block's system
    // repeated under the tape's own hairline, never a second centred column
    expect(beforeLandscape).toContain('.versus-cards { width: 100%; display: grid; grid-template-columns: 1fr; gap: 10px; }');
    expect(beforeLandscape).toContain('.versus-card-side { display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-width: 0; }');
    expect(beforeLandscape).toContain('.versus-card-side + .versus-card-side { border-top: 1px solid rgba(var(--edge-rgb), .16); padding-top: 9px; }');
    expect(beforeLandscape).not.toContain('.versus-card-line { display: flex');
  });

  it('headlines and rows all start on the name column edge', () => {
    expect(beforeLandscape).toMatch(/\.versus-card-headline \{[^}]*text-align: left/);
    expect(beforeLandscape).not.toMatch(/\.versus-card-segs \{[^}]*text-align: center/);
    expect(beforeLandscape).not.toMatch(/\.versus-card-line \{[^}]*justify-content: center/);
  });

  it('the facts set one step under the name so the columns hold at 390px', () => {
    // measured: "First time riding together" is 161px at 13px, 148px at
    // 12px — the 152px relation track only holds at the 12px facts size
    expect(beforeLandscape).toMatch(/\.versus-card-rel \{[^}]*font-size: 12px/);
    expect(beforeLandscape).toMatch(/\.versus-card-segs \{[^}]*font-size: 12px/);
    expect(beforeLandscape).toMatch(/\.versus-card-name \{[^}]*12\.5px\/1\.2/);
  });
});

describe('versus fit: landscape goes wide and nothing scrolls', () => {
  it('the short-landscape band exists and widens the versus loading card', () => {
    expect(landscapeStart).toBeGreaterThan(0);
    expect(landscape).toContain('.bwm-loading-card:has(.versus) { width: min(100%, 920px); gap: 5px; }');
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

describe('versus fit: landscape composes the scouting lines into a panel (owner, 2026-10-29)', () => {
  it('the cards wear the tape shell under a SCOUTING REPORT header', () => {
    // same gradient + ring + shadow as .versus-tape, so tape and scouting
    // read as one broadcast column beside the stack
    expect(landscape).toMatch(/\.versus-cards \{[^}]*border-radius: 14px;[^}]*background: linear-gradient\(165deg, rgba\(var\(--purple-rgb\), \.22\), rgba\(0,0,0,\.38\)\);/);
    expect(landscape).toMatch(/\.versus-cards \{[^}]*box-shadow: inset 0 0 0 1px rgba\(var\(--edge-rgb\), \.35\), 0 14px 30px rgba\(0,0,0,\.45\);/);
    expect(landscape).toContain(".versus-cards::before { content: 'SCOUTING REPORT'; grid-column: 1 / -1;");
  });

  it('with no tape above it the panel centres against the stack; with nothing right, the stage centres alone', () => {
    expect(landscape).toContain('.versus-shake:not(:has(.versus-tape, .versus-pot.only)) .versus-cards { grid-row: 1 / 3; align-self: center; }');
    expect(landscape).toContain('.versus-shake:not(:has(.versus-tape, .versus-pot.only, .versus-cards)) .versus-stage { grid-column: 1 / -1; }');
    // the story shake always carries its tape, so the centring rules can never fire there
    expect(landscape).toContain('.versus-shake:has(> .versus-tape.story) { grid-template-areas: "stage tape" "stage tape" "skip skip"; }');
  });

  it('the lines keep the unified grid inside the panel (the 82px label-rhythm band is retired)', () => {
    // no landscape band redefines the row: the columns come from the base
    // grid, so portrait and landscape rows share their edges exactly
    expect(landscape).not.toContain('min-width: 82px');
    expect(landscape).not.toContain('.versus-card-side:nth-child(even)');
    expect(landscape).not.toContain('.versus-card-line { justify-content');
    expect(landscape).not.toContain('.versus-card-name { flex:');
    const beforeLandscape = css.slice(0, landscapeStart);
    expect(beforeLandscape).toContain('.versus-card-line { display: grid; grid-template-columns: 80px 152px minmax(0, 1fr); column-gap: 8px;');
  });

  it('the SE/mini band compresses the same composition instead of redesigning it', () => {
    expect(landscape).toContain('@media (orientation: landscape) and (max-height: 560px) and (max-width: 720px)');
    expect(landscape).toContain('.versus-shake { grid-template-columns: minmax(240px, 272px) minmax(0, 1fr); column-gap: 16px; row-gap: 3px; }');
    expect(landscape).toContain('.versus-cards { padding: 4px 10px 5px; gap: 3px 10px; }');
    // the grid squeezes with the pane (72/144 tracks), it does not change shape
    expect(landscape).toContain('.versus-card-line { grid-template-columns: 72px 144px minmax(0, 1fr); }');
    // the story tape keeps its own padding in this band
    expect(landscape).toContain('.versus-tape:not(.story) { padding: 4px 10px 3px; }');
  });

  it('portrait stacks the blocks full-width on the same grid (no SCOUTING REPORT header there)', () => {
    expect(css).toContain('.versus-cards { width: 100%; display: grid; grid-template-columns: 1fr; gap: 10px; }');
    const beforeLandscape = css.slice(0, landscapeStart);
    expect(beforeLandscape).not.toContain('SCOUTING REPORT');
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
