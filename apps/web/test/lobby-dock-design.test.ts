/**
 * @vitest-environment happy-dom
 *
 * LOBBY DOCK DESIGN (owner 2026-11-04: "This looks lazy") — the PICK YOUR
 * SEAT lobby's bottom action zone (team chips, status, START, LEAVE, and
 * the CAM / MIC / CHAT bar) floated on the page void: the dock's
 * background dissolved to transparent at its top edge, the status line
 * whispered in muted grey, and the media buttons were plain boxes with
 * emoji faces. The v9 paint layer (online.css, inside the v8A block —
 * geometry untouched, see layout-lobby-fit.test.ts) makes the dock a
 * solid panel in the app's glass/gold language, lifts the status to
 * full-strength ink, gives START the gold glow the bid panel's primary
 * already carries, and swaps the media/chat emoji for the app's stroke
 * icons (Media.tsx / Lobby.tsx markup — handlers, labels, testids
 * unchanged). These pins keep the zone from drifting back to the void,
 * and the render below extends the theme-parity guardrail to the lobby:
 * Classic and Neon render the identical control inventory.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Lobby from '../src/online/Lobby';
import { DEFAULT_SETTINGS, settingsToRules } from '../src/settings';
import { themeStore } from '../src/theme';
import type { ConnState, TableConnection } from '../src/online/connection';
import type { RoomInfo } from '@spades/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/online/online.css');
const v8 = css.slice(css.indexOf('lobby v8'), css.indexOf('lobby v8b'));
const v8A = v8.slice(v8.indexOf('@media (max-width: 1023px)'), v8.indexOf('/* (3) phone landscape stage'));
const mediaSrc = read('../src/online/Media.tsx');
const lobbySrc = read('../src/online/Lobby.tsx');

/* The owner's screenshot state: host, partnership room, 1 of 4 seated. */
function fixtureRoom(): RoomInfo {
  return {
    code: 'KYWCH', hostId: 'me', phase: 'lobby',
    rules: settingsToRules(DEFAULT_SETTINGS), botLevel: 'mixed',
    seats: [
      { kind: 'human', playerId: 'me', uid: 'me', name: 'You', connected: true, media: { cam: false, mic: false } },
      { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' },
    ],
    members: [{ playerId: 'me', name: 'You', connected: true, seat: 0 }],
    deadline: null, turnClockStart: null, ready: [], rev: 1, seq: 0, game: 0,
    teamNames: ['', ''], venue: 'classic',
  } as unknown as RoomInfo;
}

const inventory = (c: HTMLElement) =>
  [...c.querySelectorAll('button, a[href], input, select, textarea')]
    .map((n) => {
      const el = n as HTMLElement & { value?: string };
      return [
        el.tagName,
        el.getAttribute('data-testid') ?? '',
        el.getAttribute('aria-label') ?? '',
        (el.textContent ?? '').trim().replace(/\s+/g, ' '),
        el.getAttribute('href') ?? '',
        el.value ?? '',
      ].join('|');
    })
    .sort();

let root: Root | null = null;
let el: HTMLDivElement | null = null;

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
  // the dock + chat drawer portal to <body>: sweep any leftovers so one
  // scenario's portals can't leak into the next scenario's inventory
  document.body.querySelectorAll('.lobby-dock, .lobby-chat-portal').forEach((n) => n.remove());
}

async function renderLobby(theme: 'classic' | 'neon') {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const room = fixtureRoom();
  const cs = {
    status: 'open', you: 'me', room, seat: 0, view: null, run: null,
    chat: [], error: null, pending: false, socketGen: 1, statsOff: false,
  } as unknown as ConnState;
  const conn = { send: () => {} } as unknown as TableConnection;
  await act(async () => {
    themeStore.set(theme);
    root!.render(createElement(Lobby, {
      conn, cs, mesh: null, settings: DEFAULT_SETTINGS,
      onSettings: () => {}, onBackToGame: null, onLeave: () => {},
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return document.body;
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
});

afterEach(() => {
  unmount();
  act(() => themeStore.set('classic'));
  localStorage.clear(); sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('lobby parity (theme-parity guardrail, extended to the room lobby)', () => {
  it('host lobby, 1 of 4 seated: identical interactive inventory under Classic and Neon', async () => {
    const classic = await renderLobby('classic');
    const classicInv = inventory(classic);
    expect(classicInv.length).toBeGreaterThan(10);
    // the circled zone is all here: teams, START, LEAVE, CHAT
    expect(classicInv.some((x) => x.includes('|start|'))).toBe(true);
    expect(classicInv.some((x) => x.includes('|leave-table|'))).toBe(true);
    expect(classicInv.some((x) => x.includes('|lobby-chat-tab|'))).toBe(true);
    // the team chips are spans (only the chip-0 pencil is interactive):
    // assert them on the DOM, and the status line with them
    expect(classic.querySelector('[data-testid="team-chip-0"]')).not.toBeNull();
    expect(classic.querySelector('[data-testid="team-chip-1"]')).not.toBeNull();
    expect(classic.querySelector('[data-testid="lobby-status"]')?.textContent).toContain('1 of 4 seated');
    const neon = await renderLobby('neon');
    expect(inventory(neon)).toEqual(classicInv);
  });
});

describe('the v9 dock design pins', () => {
  it('the dock is a solid panel in the v8A block — no transparent fade stop', () => {
    expect(v8A).toContain('lobby v9');
    expect(v8A).toContain('.lobby-dock { background: linear-gradient(180deg, rgba(var(--glass-strong-rgb),.97), rgba(var(--glass-strong-rgb),1) 72px); border-top: 1px solid rgba(var(--edge-rgb),.45); box-shadow: 0 -14px 34px rgba(0,0,0,.5), inset 0 1px 0 rgba(var(--gold-rgb),.22); }');
    expect(v8A).toContain('.dock-bar .av-btn { background: rgba(var(--glass-strong-rgb),.94); box-shadow: inset 0 0 0 1px rgba(var(--edge-rgb),.5), 0 4px 12px rgba(0,0,0,.45); }');
  });

  it('the status line reads at full strength, and START carries the gold glow', () => {
    const statusRule = css.match(/\.lobby-status \{[^}]*\}/)![0];
    expect(statusRule).toContain('color: var(--ink)');
    expect(statusRule).toContain('font-weight: 600');
    const goldRule = css.match(/\.start-gold \{[^}]*\}/)![0];
    expect(goldRule).toContain('box-shadow: 0 0 18px rgba(var(--gold-rgb),.35)');
  });

  it('CAM / MIC render as designed stroke icons, not emoji (MediaBar + OfflineMediaBar)', () => {
    const bars = mediaSrc.slice(mediaSrc.indexOf('const camIcon'), mediaSrc.indexOf('/** Table Talk'));
    expect(bars).toContain('<svg');
    for (const glyph of ['📷', '📹', '🎙', '🔇']) expect(bars).not.toContain(glyph);
    // the controls themselves are untouched: same labels, same small caps
    expect(bars).toContain("aria-label={vs.cam ? 'Turn camera off' : 'Turn camera on'}");
    expect(bars).toContain("aria-label={vs.mic ? 'Mute microphone' : 'Turn microphone on'}");
    expect(bars).toContain("<small>{vs.cam ? 'ON' : 'CAM'}</small>");
    expect(bars).toContain("<small>{vs.mic ? 'ON' : 'MIC'}</small>");
  });

  it('the dock CHAT button carries the stroke bubble, not the emoji', () => {
    expect(lobbySrc).not.toContain('💬');
    const btn = lobbySrc.slice(lobbySrc.indexOf('data-testid="lobby-chat-tab"'), lobbySrc.indexOf('data-testid="lobby-chat-tab"') + 500);
    expect(btn).toContain('<svg');
    expect(btn).toContain('<small>CHAT</small>');
  });
});
