/**
 * @vitest-environment happy-dom
 *
 * SOUND CONSOLIDATION (owner, 2026-10-20): "We have a settings icon AND a
 * sound settings icon and some controls live in both places.. this is a mess."
 * His call: ONE sheet total — the speaker button opens the same Settings
 * sheet as the gear, landed at the Sound & music section.
 *
 * Pins:
 *  - the second surface (SoundSheet / scorebug SoundButton popover) is GONE:
 *    no component, no testid, no CSS;
 *  - the speaker (SoundDock) files a sheet request instead of opening a panel,
 *    and the host renders the one sheet with the sound group anchored;
 *  - the old sheet's unique actions (Mute bots / Mute all) live in the Sound
 *    & music group of the Settings sheet (also pinned in settings-overhaul);
 *  - the floating dock is NOT rendered on the full-screen /profile and
 *    /rewards routes — those pages have no .dock-slot, so the dock fell back
 *    to a fixed corner tile that sat on the profile header (the owner saw it
 *    covering the season label: "Idk what's behind this logo but it seems as
 *    if it doesn't belong").
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sc = read('../src/SoundControls.tsx');
const css = read('../src/styles.css');

let root: Root | null = null;
let el: HTMLDivElement | null = null;

async function mount(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(node);
  });
  return el;
}

afterEach(async () => {
  const { closeSettingsSheet } = await import('../src/settingsSheet');
  act(() => closeSettingsSheet());
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('the second sound surface is retired', () => {
  it('no SoundSheet, SoundButton popover, or their testids remain in src', () => {
    expect(sc).not.toContain('SoundSheet');
    expect(sc).not.toContain('sound-sheet');
    expect(sc).not.toContain('SoundButton');
    expect(sc).not.toContain('sound-pop');
    expect(sc).not.toContain('NowPlayingLine');
    for (const f of ['../src/Setup.tsx', '../src/Table.tsx', '../src/MoreOptions.tsx', '../src/main.tsx']) {
      expect(read(f), f).not.toContain('sound-sheet');
    }
  });

  it('the dead popover/sheet CSS is gone; the dock button styles stay', () => {
    expect(css).not.toContain('.sound-pop');
    expect(css).not.toContain('.sound-sheet');
    expect(css).not.toContain('.sound-btn-wrap');
    expect(css).not.toContain('.sheet-sec');
    expect(css).toContain('.sound-dock');
    expect(css).toContain('.dock-btn');
    // the quick actions that moved into the Settings sheet keep their styling
    expect(css).toContain('.sheet-actions');
    expect(css).toContain('.mute-all.big');
  });
});

describe('one sheet, two doors', () => {
  it('the speaker files a sound-landing request; the gear files a plain one', () => {
    expect(sc).toContain("requestSettingsSheet('sound')");
    const setup = read('../src/Setup.tsx');
    expect(setup).toContain('onClick={() => requestSettingsSheet()}');
    // Setup no longer renders a sheet of its own — the host owns the one sheet
    expect(setup).not.toContain('<MoreOptions');
  });

  it('the host opens the one sheet on request and closes it again', async () => {
    const { default: SettingsSheetHost } = await import('../src/SettingsSheetHost');
    const { requestSettingsSheet, closeSettingsSheet } = await import('../src/settingsSheet');
    const { DEFAULT_SETTINGS } = await import('../src/settings');
    const c = await mount(createElement(SettingsSheetHost, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
    }));
    expect(c.querySelector('[data-testid="more-options"]')).toBeNull();
    await act(async () => requestSettingsSheet('sound'));
    const sheet = c.querySelector('[data-testid="more-options"]');
    expect(sheet).not.toBeNull();
    const group = c.querySelector('[data-testid="settings-sound-group"]');
    expect(group).not.toBeNull();
    expect(group!.querySelector('[data-testid="mute-all"]')).not.toBeNull();
    expect(group!.querySelector('[data-testid="bot-voice-quick"]')).not.toBeNull();
    await act(async () => closeSettingsSheet());
    expect(c.querySelector('[data-testid="more-options"]')).toBeNull();
  });

  it('the speaker button opens the sheet at the sound group', async () => {
    const { SoundDock } = await import('../src/SoundControls');
    const { default: SettingsSheetHost } = await import('../src/SettingsSheetHost');
    const { DEFAULT_SETTINGS } = await import('../src/settings');
    const c = await mount(createElement('div', null,
      createElement(SoundDock),
      createElement(SettingsSheetHost, {
        settings: DEFAULT_SETTINGS,
        onChange: () => {},
        tips: { on: false, asked: true },
        onTips: () => {},
      }),
    ));
    const btn = c.querySelector<HTMLButtonElement>('[data-testid="sound-button"]')!;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn.click();
    });
    expect(c.querySelector('[data-testid="more-options"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="settings-sound-group"]')).not.toBeNull();
    // and it did NOT open any second sound panel
    expect(c.querySelector('[data-testid="sound-sheet"]')).toBeNull();
  });
});

describe('the sound landing scrolls the group into view', () => {
  it('initialSection="sound" scrolls; a plain open does not', async () => {
    const spy = vi.fn();
    (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = spy;
    const { default: MoreOptions } = await import('../src/MoreOptions');
    const { DEFAULT_SETTINGS } = await import('../src/settings');
    const props = {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onClose: () => {},
    };
    await mount(createElement(MoreOptions, props));
    expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      root!.render(createElement(MoreOptions, { ...props, initialSection: 'sound' as const, anchorSeq: 1 }));
    });
    expect(spy).toHaveBeenCalled();
  });
});

describe('the floating dock stays off the full-screen routes', () => {
  it('main.tsx does not render the dock on /profile or /rewards', () => {
    const main = read('../src/main.tsx');
    expect(main).toContain("path !== '/profile'");
    expect(main).toContain("path !== '/rewards'");
    expect(main).toContain('<SoundDock />');
  });
});
