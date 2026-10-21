/**
 * @vitest-environment happy-dom
 *
 * SETTINGS OVERHAUL (owner, 2026-10-20): the Settings sheet was "way too
 * jumbled" and its Audio quality buttons "aren't readable". The Audio
 * quality root cause: its bespoke .sf-seg class had NO rule in any
 * stylesheet, so the buttons fell back to the platform's default light
 * pill appearance — pale pills, invisible selected state — and the
 * row's flex-wrap spilled them past the sheet's edge.
 *
 * These pins hold the overhaul's shape: the sheet's sections render as
 * grouped cards with every control in its group (Play / Sound & music /
 * Look & effects / You / Beta feedback & support), Audio quality rides
 * the shared .seg treatment, .toggle and .switch share one switch
 * treatment, chat sounds is one shared row, and the Neon sheet is solid
 * so the home can't bleed through it. Presentation only — no setting,
 * testid, default, or persistence changed (the parity suite next door
 * pins the identical control inventory under both themes).
 *
 * FOLLOW-UPS (owner, same day, from the shipped sheet on his iPhone):
 *  - Audio quality wrapped anyway ('low / balanced' over 'high'): it now
 *    stacks — label on its own line, the seg full-width on ONE line — and
 *    every seg on the settings surfaces is nowrap.
 *  - The Room (soundscape) picker is REMOVED: each venue has its own
 *    signature sounds, set automatically from the venue.
 *  - The Badges row is REMOVED from the You group (badges live on
 *    profiles, not in Settings).
 *  - Under Neon the volume sliders' electric-blue fill (#269cff via
 *    --purple-hot) clashed with the violet sheet: Neon slider fills take
 *    the violet family; Classic is unchanged.
 *  - The gold corner-fold on the sheet's disclosure rows (.gold-tab-row
 *    ::after) covered the House rules Show chip / Credits heading: gone.
 *
 * CONSOLIDATION (owner, 2026-10-20, later the same day): the separate speaker
 * Sound sheet is RETIRED — it duplicated Music, Spatial audio, Audio quality,
 * the per-channel volumes, Bot voices and Chat sounds from this sheet. There
 * is now ONE sheet: the speaker opens this sheet landed on the Sound & music
 * group, and the old sheet's only unique controls — the Mute bots / Mute all
 * quick actions — live at the top of that group. The pins below hold the
 * merged inventory (sound-consolidation.test.ts pins the retired surface).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');

let root: Root | null = null;
let el: HTMLDivElement | null = null;

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}

afterEach(() => {
  unmount();
  localStorage.clear();
  sessionStorage.clear();
});

async function renderSheet() {
  const { default: MoreOptions } = await import('../src/MoreOptions');
  const { DEFAULT_SETTINGS } = await import('../src/settings');
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(createElement(MoreOptions, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onClose: () => {},
    }));
  });
  return el;
}

const groupOf = (c: HTMLElement, testid: string) =>
  c.querySelector(`[data-testid="${testid}"]`)?.closest('.set-group')?.getAttribute('aria-label');

describe('settings sheet — grouped cards', () => {
  it('renders the five groups in order', async () => {
    const c = await renderSheet();
    const labels = [...c.querySelectorAll('.set-group')].map((g) => g.getAttribute('aria-label'));
    expect(labels).toEqual(['Play', 'Sound & music', 'Look & effects', 'You', 'Beta feedback & support']);
  });

  it('every control sits in its group', async () => {
    const c = await renderSheet();
    expect(groupOf(c, 'bot-skill')).toBe('Play');
    expect(groupOf(c, 'quality-seg')).toBe('Sound & music');
    expect(groupOf(c, 'chat-sounds-switch')).toBe('Sound & music');
    expect(groupOf(c, 'bot-trash-talk')).toBe('Sound & music');
    // the retired Sound sheet's quick actions moved into this group (consolidation)
    expect(groupOf(c, 'mute-all')).toBe('Sound & music');
    expect(groupOf(c, 'bot-voice-quick')).toBe('Sound & music');
    expect(groupOf(c, 'theme-seg')).toBe('Look & effects');
    expect(groupOf(c, 'venue-select')).toBe('Look & effects');
    expect(groupOf(c, 'reduce-fx')).toBe('Look & effects');
    expect(groupOf(c, 'nuke-intensity')).toBe('Look & effects');
  });

  it('retired rows are gone: no Badges row in You, no soundscape picker anywhere in the sheet', async () => {
    const c = await renderSheet();
    // owner: "Badges don't belong here" — badges live on profiles now, not in Settings
    expect(c.querySelector('[data-testid="badges-row"]')).toBeNull();
    // owner (2026-10-20): team names are per pairing, set at table setup — the
    // global "Your team name" field leaves Settings once setup naming exists
    expect(c.querySelector('[data-testid="offline-team-name"]')).toBeNull();
    // owner: no soundscape picker — each venue's signature sounds are automatic
    expect(c.querySelector('[data-testid="soundscape-select"]')).toBeNull();
  });
});

describe('audio quality — the shared segmented control', () => {
  it('renders on .seg markup with radio semantics, not the unstyled .sf-seg', async () => {
    const c = await renderSheet();
    const seg = c.querySelector('[data-testid="quality-seg"]')!;
    expect(seg.classList.contains('seg')).toBe(true);
    expect(seg.classList.contains('sf-seg')).toBe(false);
    expect(seg.getAttribute('role')).toBe('radiogroup');
    const btns = [...seg.querySelectorAll('button')];
    expect(btns.map((b) => b.textContent)).toEqual(['low', 'balanced', 'high']);
    expect(btns.every((b) => b.getAttribute('role') === 'radio')).toBe(true);
    expect(btns.filter((b) => b.classList.contains('on')).length).toBe(1);
  });

  it('no .sf-seg remains in the sound controls markup or as a stylesheet rule', () => {
    expect(read('../src/SoundControls.tsx')).not.toContain('className="sf-seg"');
    expect(css).not.toMatch(/\.sf-seg\s*[,{]/);
  });

  it('fits on ONE line: the quality row stacks and its seg is full-width nowrap', async () => {
    const c = await renderSheet();
    const seg = c.querySelector('[data-testid="quality-seg"]')!;
    // label on its own line, seg full-width beneath (the .seg-stack row pattern)
    expect(seg.closest('.sf-row')!.classList.contains('seg-stack')).toBe(true);
    const tail = css.slice(css.indexOf('Settings follow-ups'));
    expect(tail).toContain('.sf-row.seg-stack > .seg { display: flex; flex-wrap: nowrap; width: 100%; }');
    expect(tail).toContain('.sf-row.seg-stack > .seg button { flex: 1 1 0; min-width: 0; }');
    // and no segmented control on the settings surfaces wraps at all
    expect(tail).toContain('.set-group .seg { flex-wrap: nowrap; }');
  });
});

describe('settings follow-ups CSS (owner, 2026-10-20)', () => {
  const tail = css.slice(css.indexOf('Settings follow-ups'));

  it('Neon volume sliders take the violet family — no electric-blue track in the sheets', () => {
    const webkit = tail.slice(tail.indexOf('html[data-theme="neon"] .sheet .vol-slider::-webkit-slider-runnable-track'));
    expect(webkit).toContain('var(--purple)');
    expect(webkit).not.toContain('#269cff');
    expect(webkit).not.toContain('--purple-hot'); // --purple-hot IS #269cff under Neon: the clash
    expect(tail).toContain('html[data-theme="neon"] .sheet .vol-slider::-moz-range-progress');
    // the retired sound popover's copies of these rules are gone with it
    expect(tail).not.toContain('.sound-pop');
    // scoped to the sheets: no global .vol-slider recolor (Classic untouched)
    expect(tail).not.toMatch(/(^|\n)\.vol-slider::-webkit-slider-runnable-track/);
  });

  it('the gold corner-fold no longer rides the disclosure rows', () => {
    expect(css).not.toMatch(/\.gold-tab-row::after\s*\{[^}]*linear-gradient\(135deg/);
  });
});

describe('chat sounds — one shared row', () => {
  it('is exported once and used exactly once — by the Settings sheet', () => {
    const sc = read('../src/SoundControls.tsx');
    expect(sc).toContain('export function ChatSoundsRow()');
    const mo = read('../src/MoreOptions.tsx');
    expect(mo.split('<ChatSoundsRow />').length - 1).toBe(1);
    // the second surface that used to render it (the speaker's Sound sheet) is retired
    expect(sc).not.toContain('export function SoundSheet');
  });

  it('the merged sheet renders each sound control exactly once', async () => {
    const c = await renderSheet();
    for (const tid of ['chat-sounds-switch', 'quality-seg', 'spatial-switch', 'music-switch', 'bot-voices', 'bot-voice-quick', 'mute-all', 'venue-sound-switch']) {
      expect(c.querySelectorAll(`[data-testid="${tid}"]`).length, tid).toBe(1);
    }
  });
});

describe('settings overhaul CSS', () => {
  const tail = css.slice(css.indexOf('Settings overhaul'));

  it('group cards take the shared card treatment', () => {
    expect(tail).toMatch(/\.set-group \{[^}]*border-radius: 14px/);
    // the retired sound sheet's section class went with it (consolidation)
    expect(tail).not.toContain('.sheet-sec');
  });

  it('one switch treatment: the unified .toggle/.switch overrides are present', () => {
    expect(tail).toContain('.switch { height: 28px; border-radius: 14px;');
    expect(tail).toContain('.switch i { width: 22px; height: 22px;');
    expect(tail).toContain('.switch.on i { transform: translateX(18px); }');
    expect(tail).toContain('.toggle.on span { background: var(--gold); }');
  });

  it('the Neon settings sheet is solid — the home cannot bleed through it', () => {
    const rule = tail.slice(tail.indexOf('html[data-theme="neon"] [data-testid="more-options"].sheet'));
    expect(rule).toContain('#171c42');
    expect(rule).toContain('#0a0d24');
    expect(rule).toContain('backdrop-filter: none');
  });
});
