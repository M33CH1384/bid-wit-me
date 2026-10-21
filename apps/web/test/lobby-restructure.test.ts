/**
 * @vitest-environment happy-dom
 *
 * LOBBY + TABLE SETUP RESTRUCTURE (owner, 2026-10-20): the online table step
 * opens on a LOBBY — join-by-code + Open Tables under exactly ONE heading +
 * exactly ONE create entry — and the create form is its own step (ESPN-style
 * grouped cards, its submit inside it, Back returns to the lobby). The Open
 * Tables filters derive from the modes the wizard OFFERS (joker / aceDown /
 * cutthroat4) — the retired 3-player cutthroat keeps engine support but gets
 * no filter chip. Team names are per pairing, set at table setup.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { OFFERED_MODES, offeredKindOf, openTableModeName } from '../src/offeredModes';
import { tableKind } from '../src/social/OpenTables';
import { OFFLINE_PAIR_KEY, myTeamName, pairKeyForUser, pairTeamNames, teamNameFor } from '../src/TeamName';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;
function Harness() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [tips, setTips] = useState({ on: false, asked: true });
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart: () => {} });
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).startsWith('/api/tables') ? { tables: [] } : {}),
  })));
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});

afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); vi.unstubAllGlobals(); });

async function renderWizard() {
  await act(async () => { root.render(createElement(Harness)); });
  await flush();
}
async function toOnlineLobby() {
  await renderWizard();
  await click(qs('[data-testid=play]'));
  await click(qs('[data-testid=door-team]'));
  await click(qs('[data-testid=mode-joker]'));
  await click(qs('[data-testid=play-online]'));
}

describe('online lobby first', () => {
  it('shows ONE create entry, ONE Open tables heading, and NO form until create is chosen', async () => {
    await toOnlineLobby();
    // exactly one create affordance, and it is the lobby entry — not a form submit
    expect(el.querySelectorAll('[data-testid=create-open]')).toHaveLength(1);
    expect(qs('[data-testid=create-table]')).toBeNull();
    // exactly one "Open tables" heading anywhere on the step
    const headings = [...el.querySelectorAll('h1,h2,h3,h4')].filter((h) => /open tables/i.test(h.textContent ?? ''));
    expect(headings).toHaveLength(1);
    // join-by-code is part of the lobby
    expect(qs('[data-testid=join-code]')).not.toBeNull();
    // the create form's fields are not on this screen at all
    expect(qs('[data-testid=table-name]')).toBeNull();
  });

  it('the Open Tables filters are exactly the offered modes — no cutthroat3 chip', async () => {
    await toOnlineLobby();
    expect(qs('[data-testid=ot-filter-all]')).not.toBeNull();
    for (const m of OFFERED_MODES) expect(qs(`[data-testid=ot-filter-${m.key}]`)).not.toBeNull();
    expect(qs('[data-testid=ot-filter-cutthroat3]')).toBeNull();
    expect(OFFERED_MODES.map((o) => o.key)).toEqual(['joker', 'cutthroat4', 'aceDown']);
  });
});

describe('create as its own step', () => {
  it('opens the grouped form with its submit inside; Back returns to the lobby', async () => {
    await toOnlineLobby();
    await click(qs('[data-testid=create-open]'));
    // the form's own submit is here; the lobby entry is gone (one create affordance per view)
    expect(qs('[data-testid=create-table]')).not.toBeNull();
    expect(qs('[data-testid=create-open]')).toBeNull();
    // ESPN-style grouped cards with the specced section headers
    const headers = [...el.querySelectorAll('.setup-card-h')].map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Table', 'Deck & venue', 'Rules', 'Sound']));
    // the house-rules summary renders as a stat line (mode · play to · timers)
    expect(qs('[data-testid=rules-stats]')?.textContent).toMatch(/Play to/);
    expect(qs('[data-testid=rules-stats]')?.textContent).toMatch(/30s bid/);
    // Back returns to the lobby, form hidden again
    await click(qs('[data-testid=wiz-back]'));
    expect(qs('[data-testid=create-open]')).not.toBeNull();
    expect(qs('[data-testid=create-table]')).toBeNull();
  });
});

describe('offered modes vs engine kinds', () => {
  it('a legacy 3-player cutthroat table still classifies, but is never an offered filter', () => {
    const legacy = { mode: 'cutthroat', playerCount: 3 } as never;
    expect(tableKind(legacy)).toBe('cutthroat3'); // engine/legacy support intact
    expect(offeredKindOf(legacy)).toBeNull(); // …but not offered/filterable
    expect(openTableModeName(legacy)).toBe('Cutthroat · 3 players');
    expect(offeredKindOf({ mode: 'joker', playerCount: 4 } as never)).toBe('joker');
    expect(offeredKindOf({ mode: 'aceDown', playerCount: 4 } as never)).toBe('aceDown');
    expect(offeredKindOf({ mode: 'cutthroat', playerCount: 4 } as never)).toBe('cutthroat4');
    expect(openTableModeName({ mode: 'cutthroat', playerCount: 4 } as never)).toBe('Cutthroat');
  });
});

describe('per-pairing team names (offline setup)', () => {
  it('the bots step shows the team-name field for team modes, prefilled with the pairing name', async () => {
    pairTeamNames.set(OFFLINE_PAIR_KEY, 'Book Bandits'); // the pairing's saved name
    await renderWizard();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
    await click(qs('[data-testid=play-bots]'));
    const field = qs<HTMLInputElement>('[id="setup-team-name-in"]');
    expect(field).not.toBeNull();
    expect(field!.value).toBe('Book Bandits'); // prefilled from the pairing store
    // (editing saves through the same pairTeamNames.set the store test below
    // exercises — synthetic typing into a controlled input is not reliable
    // under happy-dom, so the save path is asserted at the store level)
  });

  it('the bots step hides the team-name field for cutthroat (no teams)', async () => {
    await renderWizard();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-cutthroat]'));
    await click(qs('[data-testid=play-bots]'));
    expect(qs('[data-testid=setup-team-name]')).toBeNull();
  });

  it('store: per-pairing save, legacy global fallback, account-wins merge', () => {
    myTeamName.set('Homies'); // the retired Settings value migrates as the default
    // a pairing with no saved name of its own falls back to the legacy global name
    expect(teamNameFor(pairKeyForUser('Fallback Pal'))).toBe('Homies');
    pairTeamNames.set(OFFLINE_PAIR_KEY, 'New Crew');
    expect(teamNameFor(OFFLINE_PAIR_KEY)).toBe('New Crew'); // the pairing's own name wins over the fallback
    // the account's merged map (applied after sign-in) wins per key and fills gaps,
    // mirroring the server's mergeProgress
    pairTeamNames.merge({ 'user:merge-pal': 'Block Stars', [OFFLINE_PAIR_KEY]: 'Account Crew' });
    expect(teamNameFor(pairKeyForUser('Merge Pal'))).toBe('Block Stars');
    expect(teamNameFor(OFFLINE_PAIR_KEY)).toBe('Account Crew');
  });
});

const stylesCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8');

describe('setup card rows', () => {
  it('the HOUSE RULES row carries its own horizontal padding (owner, 2026-10-21: "this box needs some padding")', () => {
    const styles = stylesCss;
    // in-card quiet rows are flat rows, but the row's own label/chip must
    // not kiss its edges: 11px vertical / 16px horizontal, both themes
    // (the neon .quiet-row overrides set no padding, so this carries).
    expect(styles).toContain('.setup-card .quiet-row { background: transparent; box-shadow: none; padding: 11px 16px; min-height: 48px; }');
    // the deliberate gold corner fold on the row is design language —
    // the padding fix must not retire it
    expect(styles).toContain('button.mode-pick::after, button.quiet-row::after');
  });
});
