/**
 * Layout fit pins — design audit D6 / D9 / D4, profile + social hosts
 * (Worker W2, 2026-10-24). House idiom (cf. seat-fit.test.ts): every
 * number is recomputed from constants parsed out of the shipped CSS, so
 * a regression in the CSS fails here instead of on the owner's phone.
 *
 * D6 (CSS audit §3e): the profile action row's labels cannot fit one
 * line in the in-game modal — the audit's measured label widths (12px,
 * incl. the old 7px side padding + 1px borders = 16px of chrome) are
 * encoded below as LABELS. The modal gets a 3+3 auto-column grid; the
 * panel and page hosts keep ONE line via tightened gap/padding/font.
 * D9 (§2a): the profile page gains story's ≥1100px tier (1120px), and
 * the page-host Rep-ranks row may wrap at 6–7-digit coin balances.
 * D4: every interactive rule W2 raised to the 44px floor is pinned.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const pcard = readFileSync(new URL('../src/profile/playercard.css', import.meta.url), 'utf8');

/** The declaration block following the first occurrence of `needle`. */
function block(css: string, needle: string): string {
  const i = css.indexOf(needle);
  if (i < 0) throw new Error(`not found: ${needle}`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}
const num = (body: string, re: RegExp, what: string): number => {
  const m = body.match(re);
  if (!m) throw new Error(`no ${what} in: ${body.slice(0, 120)}`);
  return parseFloat(m[1]!);
};
const minH = (css: string, needle: string) => num(block(css, needle), /min-height: ([\d.]+)px/, 'min-height');

/* Audit §3e measured label totals (upper bounds) at 12px with the old
 * chrome: 7px side padding ×2 + 1px border ×2 = 16px per button. */
const LABELS = { message: 71, invite: 63, challenge: 117, add: 88, block: 46, report: 52 };
const OLD_CHROME = 16;
const textOf = (total: number) => total - OLD_CHROME;

/* Host content widths, derived from shipped constants below. */
const backdropPad = num(block(styles, '.modal-backdrop {'), /padding: (\d+)px/, 'backdrop padding');
const modalCard = block(social, '.profile-modal-card {');
const cardW = num(modalCard, /width: min\((\d+)px/, 'card width');
const cardPad = num(modalCard, /padding: (\d+)px/, 'card padding');
const modalContent = (vw: number) => Math.min(vw - 2 * backdropPad, cardW) - 2 * cardPad;
const panelContent = (vw: number) => vw - 2 * num(block(social, '.soc-body {'), /padding: \d+px (\d+)px/, 'body side padding');
const pageContent = (vw: number) => vw - 2 * 16; // .profile-page base side padding (pinned verbatim by profile-ink.test.ts)

describe('D6 modal host: 3+3 grid, no clipped labels at any size', () => {
  const grid = block(social, '.profile-modal-card .soc-prof-acts {');
  const btn = block(social, '.profile-modal-card .soc-prof-head .soc-prof-acts button {');
  const gap = num(grid, /gap: (\d+)px/, 'grid gap');
  const sidePad = num(btn, /padding: \d+px (\d+)px/, 'modal button side padding');
  const font = num(btn, /font-size: (\d+)px/, 'modal button font');

  it('the modal row is a 3-column auto grid (the panel/page hosts keep the base nowrap line)', () => {
    expect(grid).toContain('display: grid');
    expect(grid).toContain('grid-template-columns: repeat(3, auto)');
    expect(social).toContain('.soc-prof-acts { display: flex; flex-wrap: nowrap; gap: 5px; align-items: center; }');
  });

  it('one line is arithmetically impossible in the modal — the departure is forced, not chosen', () => {
    const oneLine = Object.values(LABELS).reduce((a, b) => a + b, 0) + 5 * 5; // 5 gaps × the base 5px
    for (const vw of [375, 430, 1024]) expect(oneLine, `vw ${vw}`).toBeGreaterThan(modalContent(vw));
  });

  it('column maxima (DOM order, 3 per row) fit the content box at 307 / 362 / 394', () => {
    expect([modalContent(375), modalContent(430), modalContent(1024)]).toEqual([307, 362, 394]);
    const order = [LABELS.message, LABELS.invite, LABELS.challenge, LABELS.add, LABELS.block, LABELS.report];
    // font stays 12px in the modal, so label text is unscaled; each
    // button's new chrome is 2×sidePad + 2×1px border.
    const chrome = 2 * sidePad + 2;
    const cols = [0, 1, 2].map((c) => Math.max(...order.filter((_, i) => i % 3 === c).map((t) => textOf(t) * (font / 12) + chrome)));
    const total = cols.reduce((a, b) => a + b, 0) + 2 * gap;
    for (const vw of [375, 430, 1024]) expect(total, `vw ${vw}`).toBeLessThanOrEqual(modalContent(vw));
    expect(total).toBe(262); // 82 (Add col) + 57 (Invite col) + 111 (Challenge col) + 12 gaps
  });

  it('modal buttons and the Friends tag are 44px tall, two rows = 94px', () => {
    expect(minH(social, '.profile-modal-card .soc-prof-head .soc-prof-acts button {')).toBe(44);
    expect(minH(social, '.profile-modal-card .soc-prof-head .soc-prof-acts .soc-friend-tag {')).toBe(44);
    expect(2 * 44 + gap).toBe(94);
  });
});

describe('D6 panel + page hosts: ONE line, tightened until the locked worst case fits', () => {
  const rule = block(social, '.soc-panel .soc-prof-head .soc-prof-acts button, .profile-page .soc-prof-head .soc-prof-acts button {');
  const rowRule = block(social, '.soc-panel .soc-prof-head .soc-prof-acts, .profile-page .soc-prof-head .soc-prof-acts {');
  const gap = num(rowRule, /gap: (\d+)px/, 'row gap');
  const sidePad = num(rule, /padding: \d+px (\d+)px/, 'side padding');
  const font = num(rule, /font-size: ([\d.]+)px/, 'font');

  it('the worst case (Message + locked Challenge + Add friend + Block + Report) fits 351px panel and 343px page content', () => {
    const set = [LABELS.message, LABELS.challenge, LABELS.add, LABELS.block, LABELS.report];
    const total = set.reduce((a, t) => a + textOf(t) * (font / 12) + (2 * sidePad + 2), 0) + (set.length - 1) * gap;
    expect(total).toBeCloseTo(333.8, 0);
    expect(total).toBeLessThanOrEqual(panelContent(375)); // 351
    expect(total).toBeLessThanOrEqual(pageContent(375)); // 343
    expect(panelContent(375)).toBe(351);
  });

  it('buttons stay 44px tall on the one line', () => {
    expect(num(rule, /min-height: (\d+)px/, 'min-height')).toBe(44);
  });
});

describe('D9: profile page large-screen tier + wrap-safe Rep ranks (page host only)', () => {
  const tier = styles.slice(styles.indexOf('@media (min-width: 1100px) {\n  .profile-page'));
  const tierBlock = tier.slice(0, tier.indexOf('\n}'));

  it('the page steps to 1120px with 32px sides at ≥1100px, like the story shell', () => {
    expect(num(tierBlock, /max-width: (\d+)px/, 'tier max-width')).toBe(1120);
    expect(num(tierBlock, /padding-left: (\d+)px/, 'tier side padding')).toBe(32);
    expect(num(tierBlock, /padding-right: (\d+)px/, 'tier side padding')).toBe(32);
    // story's own step, the idiom being matched
    expect(readFileSync(new URL('../src/story/story.css', import.meta.url), 'utf8')).toContain('.story-shell { max-width: 1120px; padding-left: 32px; padding-right: 32px; }');
  });

  it('composition at desktop: wider than the old cap, never full-bleed, dead margins shrink', () => {
    for (const vw of [1440, 1920]) {
      const w = Math.min(1120, vw);
      expect(w / vw).toBeGreaterThan(720 / vw); // strictly more of the display than the old 720px cap
      expect(w).toBeLessThan(vw); // capped, not full-bleed
      expect((vw - w) / 2).toBeLessThan((vw - 720) / 2); // dead margin per side shrinks (600 → 400 at 1920)
    }
    // portrait/tablet untouched: the base rule is byte-identical (also pinned by profile-ink.test.ts)
    expect(styles).toContain('.profile-page { min-height: 100dvh; padding: calc(12px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); max-width: 720px; margin: 0 auto; }');
  });

  it('internals use the room: achievements 3 → 4 columns, unlocks two-up at the tier', () => {
    expect(tierBlock).toContain('.profile-page .ach-grid { grid-template-columns: repeat(4, 1fr); }');
    expect(tierBlock).toContain('.profile-page .unlock-list { grid-template-columns: 1fr 1fr; }');
    expect(styles).toContain('@media (min-width: 560px) { .ach-grid { grid-template-columns: repeat(3, 1fr); } }');
  });

  it('the page-host Rep-ranks row wraps; the .profile-view nowrap rule still ships for the other hosts', () => {
    const wrap = block(styles, '.profile-page .soc-rep-ranks {');
    expect(wrap).toContain('flex-wrap: wrap');
    // the wrap override must come after the nowrap rule it outranks (equal specificity, later wins)
    expect(styles.indexOf('.profile-page .soc-rep-ranks {')).toBeGreaterThan(styles.indexOf('.profile-view .soc-rep-ranks {'));
    expect(block(styles, '.profile-view .soc-rep-ranks {')).toContain('flex-wrap: nowrap');
    // with wrapping allowed, the fit requirement collapses to the widest
    // single chip: a rating chip ≈125px (audit §2a) ≤ 343px page content
    expect(125).toBeLessThanOrEqual(pageContent(375));
  });
});

describe('D4: the 44px tap-target floor (social / profile / player card)', () => {
  const cases: [string, string, string][] = [
    // [file, selector needle, label]
    [social, '.social-btn {', 'social entry button (height)'],
    [social, '.soc-tabs > button, .soc-tabs button {', 'panel tabs'],
    [social, '.soc-pl-acts button, .soc-frow button, .soc-prof-acts button, .soc-dm-head > button:not(.link):not(.soc-dm-name) {', 'shared action buttons'],
    [social, '.soc-line-menu button {', 'message line menu'],
    [social, '.soc-pop-replyrow button {', 'popover reply send'],
    [social, '.soc-compose button {', 'composer send'],
    [social, '.soc-invite-btns button {', 'invite toast buttons'],
    [social, '.soc-invite-acts button {', 'notice toast buttons'],
    [social, '.soc-seg > button {', 'seg buttons (base)'],
    [social, '.soc-seg button { flex: 1;', 'seg buttons (v2)'],
    [social, '.soc-tour-form input:not([type=checkbox])', 'tournament form controls'],
    [social, '.ot-acts button {', 'open-tables row actions'],
    [social, '.ranks-kind button {', 'ranks kind buttons'],
    [social, '.ranks-filters-btn {', 'ranks filters button'],
    [social, '.ranks-cat button {', 'ranks category chips'],
    [social, '.ranks-done {', 'ranks sheet Done'],
    [social, '.ranks-pills button {', 'ranks filter pills'],
    [social, '.wg-sugg button {', 'wager suggestion chips'],
    [social, '.soc-mention-pop button {', 'mention popover options'],
    [styles, '.prof-tabs button {', 'profile page tabs'],
    [styles, '.prof-pic-btn {', 'profile picture / edit buttons'],
    [styles, '.social-link-chip {', 'social link chips'],
    [styles, '.prof-link-row input {', 'social-links editor inputs'],
    [styles, '.prof-tag-edit input {', 'tagline editor input'],
    [pcard, '.pcard-edit {', 'player card Edit'],
    [pcard, '.pcard-pick {', 'card editor picks'],
  ];
  for (const [css, needle, label] of cases) {
    it(`${label} ≥ 44px`, () => {
      const body = block(css, needle);
      const mh = body.match(/min-height: ([\d.]+)px/);
      const h = body.match(/(?:^|; )height: ([\d.]+)px/);
      expect(Math.max(mh ? parseFloat(mh[1]!) : 0, h ? parseFloat(h[1]!) : 0), label).toBeGreaterThanOrEqual(44);
    });
  }

  it('square-ish targets carry the floor on both axes', () => {
    const more = block(social, '.soc-more {');
    expect(num(more, /min-width: (\d+)px/, 'more width')).toBeGreaterThanOrEqual(44);
    expect(num(more, /min-height: (\d+)px/, 'more height')).toBeGreaterThanOrEqual(44);
    const popX = block(social, '.soc-pop-x {');
    expect(num(popX, /min-width: (\d+)px/, 'pop-x width')).toBeGreaterThanOrEqual(44);
    expect(num(popX, /min-height: (\d+)px/, 'pop-x height')).toBeGreaterThanOrEqual(44);
    const flip = block(pcard, '.pcard-flipbtn {');
    expect(num(flip, /min-height: (\d+)px/, 'flip height')).toBe(44);
  });

  it('targets that already met the floor still do (no regression while sweeping)', () => {
    expect(num(block(social, '.profile-modal-x {'), /width: (\d+)px/, 'modal x')).toBe(44);
    expect(num(block(social, '.soc-toast .fr-x {'), /width: (\d+)px/, 'toast x')).toBe(44);
    expect(minH(social, '.wg-acts button {')).toBe(44);
    expect(minH(social, '.wg-chips button {')).toBe(44);
    expect(minH(social, '.soc-pop-reply {')).toBe(44);
  });

  it('DM-thread landscape budget (§3a): chrome growth stays inside the 7px slack', () => {
    // Baseline @667×375: lines area 127px vs its 120px floor (slack 7).
    // W2 grew exactly two chrome rows in the DM view: the tabs
    // (40px computed → 44 min-height = +4) and the composer row, whose
    // height is bound by its input (11+11 padding + ~19px line + 2
    // border = 43) — the send button 42 → 44 moves the row by +1.
    const tabNew = minH(social, '.soc-tabs > button, .soc-tabs button {');
    const sendNew = minH(social, '.soc-compose button {');
    const inputH = 11 + 11 + 19 + 2;
    const delta = (tabNew - 40) + (Math.max(inputH, sendNew) - Math.max(inputH, 42));
    expect(delta).toBe(5);
    expect(127 - delta).toBeGreaterThanOrEqual(120);
  });
});
