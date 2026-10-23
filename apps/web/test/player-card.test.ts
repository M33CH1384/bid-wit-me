/**
 * @vitest-environment happy-dom
 *
 * The Player Card (owner-approved 2026-10-23, front redesigned same day):
 * the flippable card that heads every profile. The first front "did not
 * look like a playing card at all" (owner), so the FRONT is now a true
 * card face: 5:7 proportions, dual corner indices (bottom rotated), a
 * keyline frame, true pip layouts around a portrait art window for number
 * cards, court/ace/deuce/joker field treatments, and a nameplate band
 * whose ink can never vanish into the face. These tests pin: the new
 * anatomy (pip map for every rank 3–10, no interactive controls inside
 * the card, nameplate contrast), the back's stats in their patterned
 * card back, the honest zero-record back, the editor's save round-trip
 * and caps, and the ProfileView wiring (card when the payload carries
 * one, the legacy identity header when it doesn't).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerCard, PIP_LAYOUTS, type PlayerCardData } from '../src/profile/PlayerCard';
import { CardEditor } from '../src/profile/CardEditor';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* ------------------------------------------------------------- fixtures */

const BADGE_ACH = { kind: 'achievement' as const, id: 'first-dub', name: 'First Dub', icon: null, earnedAt: 1000 };
const BADGE_STORY = { kind: 'story' as const, id: 'porch-graduate', name: 'Porch Graduate', icon: '🎓', earnedAt: null };
const BADGE_PROG = { kind: 'badge' as const, id: 'storm-chaser', name: null, icon: null, earnedAt: 3000 };

const cardBase = (over: Partial<PlayerCardData> = {}): PlayerCardData => ({
  userId: 'u-1',
  name: 'ShotCaller',
  avatar: null,
  avatarUpdatedAt: null,
  memberSince: 1760000000000,
  level: { level: 34, title: 'Shot Caller' },
  rank: { level: 34, step: 34, prestige: false, rank: 'Q', rankName: 'Queen', suit: 'diamonds', symbol: '♦', tier: 'diamonds', isJoker: false, isLittleJoker: false, isBigJoker: false },
  bigJoker: { earned: false, active: false },
  status: 'Here for the run, not the talk',
  tags: ['story-coop', 'big-bank'],
  showcase: [BADGE_STORY, BADGE_ACH],
  badges: [BADGE_ACH, BADGE_STORY, BADGE_PROG],
  story: { stopsCleared: 4, stopsTotal: 11, completed: false },
  stats: {
    games: 50, wins: 32, losses: 18, winPct: 64, streak: 3, bestStreak: 7,
    team: { rating: 1240, games: 10, wins: 6, losses: 4 },
    cutthroat: { rating: 980, games: 2, wins: 1, losses: 1 },
  },
  ...over,
});

const numberRank = (rank: string, suit: 'hearts' | 'clubs' | 'diamonds' | 'spades', symbol: string, step: number) => ({
  level: step, step, prestige: false, rank, rankName: `${rank} of ${suit}`, suit, symbol,
  tier: suit, isJoker: false, isLittleJoker: false, isBigJoker: false,
});

/* ------------------------------------------------------------- rendering */

let root: Root | null = null;
let el: HTMLDivElement | null = null;
async function render(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove(); el = null;
  vi.unstubAllGlobals();
});
const q = (sel: string) => el!.querySelector(sel);
const qa = (sel: string) => [...el!.querySelectorAll(sel)];
const text = () => el!.textContent ?? '';

/* ---------------------------------------------------------------- front */

describe('the playing-card front', () => {
  it('renders the rank card the payload carries: dual corners, court field, nameplate', async () => {
    await render(createElement(PlayerCard, { data: cardBase() }));
    const card = q('[data-testid="player-card"]')!;
    expect(card.getAttribute('data-suit')).toBe('diamonds');
    expect(card.getAttribute('data-treatment')).toBe('court');
    const corners = qa('.pcard-corner');
    expect(corners).toHaveLength(2);
    expect(corners[0]!.classList.contains('tl')).toBe(true);
    expect(corners[1]!.classList.contains('br')).toBe(true);
    for (const c of corners) {
      expect(c.querySelector('.pcard-crank')?.textContent).toBe('Q');
      expect(c.querySelector('.pcard-csuit')?.textContent).toBe('♦');
    }
    // Court treatment: the portrait fills the field as the figure under a
    // royal tab; no pips anywhere.
    expect(q('.pcard-artwin.court')).not.toBeNull();
    expect(q('.pcard-royaltab')?.textContent).toBe('♛');
    expect(qa('.pcard-pipdot')).toHaveLength(0);
    // The nameplate band carries name + @handle (and only that).
    const plate = q('[data-testid="pcard-front"] .pcard-plate')!;
    expect(plate).not.toBeNull();
    expect(q('[data-testid="pcard-name"]')?.textContent).toContain('ShotCaller');
    expect(plate.querySelector('.pcard-handle')?.textContent).toBe('@ShotCaller');
    expect(plate.contains(q('[data-testid="pcard-name"]'))).toBe(true);
    // The redundant rank/level/title caption is GONE from the face.
    expect(q('[data-testid="pcard-level"]')).toBeNull();
  });

  it('the flair lives BELOW the card: status, tags, ribbon — never inside the card element', async () => {
    await render(createElement(PlayerCard, { data: cardBase() }));
    const card = q('[data-testid="player-card"]')!;
    expect(text()).toContain('Here for the run, not the talk');
    expect(q('[data-testid="pcard-tags"]')?.textContent).toContain('Story Co-op');
    expect(q('[data-testid="pcard-tags"]')?.textContent).toContain('Big Bank');
    expect(q('[data-testid="pcard-ribbon"]')?.textContent).toContain('4 of 11 stops cleared');
    for (const sel of ['[data-testid="pcard-tags"]', '[data-testid="pcard-ribbon"]', '.pcard-status']) {
      const node = q(sel)!;
      expect(node, sel).not.toBeNull();
      expect(card.contains(node), `${sel} outside the card`).toBe(false);
    }
  });

  it('showcased badges are medal seals in the nameplate — glyph only, name on the title', async () => {
    await render(createElement(PlayerCard, { data: cardBase() }));
    const seals = qa('[data-testid="pcard-showcase"] .pcard-seal');
    expect(seals).toHaveLength(2);
    expect(seals[0]!.textContent).toBe('🎓');
    expect(seals[0]!.getAttribute('title')).toBe('Porch Graduate');
    expect(seals[1]!.getAttribute('title')).toBe('First Dub');
    expect(q('[data-testid="pcard-front"] .pcard-plate')!.contains(seals[0]!)).toBe(true);
  });

  it('NO interactive controls inside the card element — edit + flip live below it', async () => {
    await render(createElement(PlayerCard, { data: cardBase(), self: true, onEditCard: () => {} }));
    const card = q('[data-testid="player-card"]')!;
    expect(card.querySelectorAll('button, a, input, [role="button"]')).toHaveLength(0);
    expect(q('[data-testid="card-edit"]')).not.toBeNull();
    expect(q('[data-testid="pcard-flip"]')).not.toBeNull();
    expect(card.contains(q('[data-testid="card-edit"]'))).toBe(false);
    expect(card.contains(q('[data-testid="pcard-flip"]'))).toBe(false);
  });

  it('number cards print their true pips around the portrait window', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({ level: { level: 17, title: 'Certified' }, rank: numberRank('7', 'clubs', '♣', 17) }),
    }));
    expect(q('[data-testid="player-card"]')!.getAttribute('data-treatment')).toBe('number');
    const pips = qa('.pcard-pipdot');
    expect(pips).toHaveLength(7);
    expect(pips.every((p) => p.textContent === '♣')).toBe(true);
    // The 7's two lower-half pips are inverted; positions ride inline style.
    expect(pips.filter((p) => p.getAttribute('data-inv') === '1')).toHaveLength(2);
    expect((pips[0] as HTMLElement).style.left).toBe('15%');
    expect((pips[0] as HTMLElement).style.top).toBe('10%');
    // The portrait window owns the field's center.
    expect(q('.pcard-artwin.number')).not.toBeNull();
    expect(q('.pcard-artwin .pcard-artletter')?.textContent).toBe('S');
  });

  it('the Deuce, Little Joker and Big Joker get the three summit treatments', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({ level: { level: 49, title: 'OG' }, rank: numberRank('2', 'spades', '♠', 49) }),
    }));
    expect(q('[data-testid="player-card"]')!.getAttribute('data-treatment')).toBe('deuce');
    expect(qa('[data-field="deuce"] .pcard-heropip')).toHaveLength(2);
    expect(q('.pcard-artwin.deuce')).not.toBeNull();

    await render(createElement(PlayerCard, {
      data: cardBase({
        level: { level: 50, title: 'King of the Block' },
        rank: { level: 50, step: 50, prestige: false, rank: 'JOKER', rankName: 'Little Joker', suit: null, symbol: '★', tier: 'spades', isJoker: true, isLittleJoker: true, isBigJoker: false },
      }),
    }));
    const little = q('[data-testid="player-card"]')!;
    expect(little.getAttribute('data-treatment')).toBe('little-joker');
    expect(little.getAttribute('data-suit')).toBe('joker');
    expect(q('.pcard-crank')?.textContent).toBe('★');
    expect(q('.pcard-csuit')?.textContent).toBe('JOKER');
    expect(q('.pcard-jokerword')?.textContent).toBe('JOKER');
    expect(q('.pcard-artwin.joker')).not.toBeNull();

    await render(createElement(PlayerCard, {
      data: cardBase({
        level: { level: 50, title: 'King of the Block' },
        rank: { level: 50, step: 51, prestige: true, rank: 'JOKER', rankName: 'Big Joker', suit: null, symbol: '★', tier: 'spades', isJoker: true, isLittleJoker: false, isBigJoker: true },
        bigJoker: { earned: true, active: true },
      }),
    }));
    const big = q('[data-testid="player-card"]')!;
    expect(big.getAttribute('data-treatment')).toBe('big-joker');
    expect(big.getAttribute('data-suit')).toBe('joker');
    expect(q('[data-testid="pcard-upkeep"]')).toBeNull();
  });

  it('the Ace rides one oversized hero pip with the portrait window within it', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({ level: { level: 48, title: 'OG' }, rank: numberRank('A', 'spades', '♠', 48) }),
    }));
    expect(q('[data-testid="player-card"]')!.getAttribute('data-treatment')).toBe('ace');
    expect(q('.pcard-heropip')?.textContent).toBe('♠');
    expect(q('.pcard-artwin.ace')).not.toBeNull();
    expect(qa('.pcard-pipdot')).toHaveLength(0);
  });

  it('an earned-but-inactive Big Joker shows the Little Joker face with the upkeep-due note below the card', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({
        level: { level: 50, title: 'King of the Block' },
        rank: { level: 50, step: 50, prestige: false, rank: 'JOKER', rankName: 'Little Joker', suit: null, symbol: '★', tier: 'spades', isJoker: true, isLittleJoker: true, isBigJoker: false },
        bigJoker: { earned: true, active: false },
      }),
    }));
    expect(q('[data-testid="player-card"]')!.getAttribute('data-treatment')).toBe('little-joker');
    const upkeep = q('[data-testid="pcard-upkeep"]')!;
    expect(upkeep?.textContent).toContain('season upkeep due');
    expect(q('[data-testid="player-card"]')!.contains(upkeep)).toBe(false);
  });

  it('tapping the CARD flips it; the hint below flips it back', async () => {
    await render(createElement(PlayerCard, { data: cardBase() }));
    const card = q('[data-testid="player-card"]') as HTMLElement;
    await act(async () => { card.click(); });
    expect(q('.pcard-inner')!.className).toContain('flipped');
    expect(q('[data-testid="pcard-flip"]')?.textContent).toContain('See front');
    const flipBtn = q('[data-testid="pcard-flip"]') as HTMLButtonElement;
    await act(async () => { flipBtn.click(); });
    expect(q('.pcard-inner')!.className).not.toContain('flipped');
  });

  it('the back carries the line in the inset panel: record, splits, head-to-head, member-since', async () => {
    await render(createElement(PlayerCard, { data: cardBase({ vsViewer: { games: 4, wins: 3, losses: 1 } }) }));
    const panel = q('.pcard-back-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.contains(q('[data-testid="pcard-record"]'))).toBe(true);
    expect(q('[data-testid="pcard-record"]')?.textContent).toContain('32–18');
    expect(text()).toContain('64%');
    expect(text()).toContain('Partnership');
    expect(text()).toContain('Rating 1240');
    expect(text()).toContain('Cutthroat');
    expect(text()).toContain('Rating 980');
    expect(q('[data-testid="pcard-vs"]')?.textContent).toContain('You vs ShotCaller:');
    expect(q('[data-testid="pcard-vs"]')?.textContent).toContain('3–1');
    expect(text()).toMatch(/Member since \w+ \d{4}/);
  });

  it('a zero-record player still gets a full front — and an honest back, no fake numbers', async () => {
    const zero = cardBase({
      status: null, tags: [], showcase: [], badges: [],
      story: { stopsCleared: 0, stopsTotal: 11, completed: false },
      stats: {
        games: 0, wins: 0, losses: 0, winPct: null, streak: 0, bestStreak: 0,
        team: { rating: 1000, games: 0, wins: 0, losses: 0 },
        cutthroat: { rating: 1000, games: 0, wins: 0, losses: 0 },
      },
    });
    await render(createElement(PlayerCard, { data: zero }));
    expect(q('[data-testid="pcard-name"]')?.textContent).toContain('ShotCaller');
    expect(q('[data-testid="pcard-ribbon"]')?.textContent).toContain('0 of 11 stops cleared');
    const flipBtn = q('[data-testid="pcard-flip"]') as HTMLButtonElement;
    await act(async () => { flipBtn.click(); });
    expect(q('[data-testid="pcard-nogames"]')?.textContent).toContain('No games on record yet');
    expect(q('[data-testid="pcard-record"]')).toBeNull();
    expect(text()).not.toContain('0–0');
  });

  it('the Edit card button belongs to the owner and never flips the card', async () => {
    const onEditCard = vi.fn();
    await render(createElement(PlayerCard, { data: cardBase(), self: true, onEditCard }));
    const btn = q('[data-testid="card-edit"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => { btn.click(); });
    expect(onEditCard).toHaveBeenCalledOnce();
    expect(q('.pcard-inner')!.className).not.toContain('flipped');
  });

  it('no Edit card button on someone else’s card', async () => {
    await render(createElement(PlayerCard, { data: cardBase() }));
    expect(q('[data-testid="card-edit"]')).toBeNull();
  });
});

/* --------------------------------------------------------- pip layouts */

describe('pip layouts — the classic geometry for 3–10', () => {
  // Visible pip counts: the portrait window owns the field's center, so
  // the 3, 5 and 9 print one pip fewer than their rank.
  const COUNTS: Record<string, number> = { '3': 2, '4': 4, '5': 4, '6': 6, '7': 7, '8': 8, '9': 8, '10': 10 };
  it('every rank 3–10 has a layout with the expected visible count', () => {
    for (const [r, n] of Object.entries(COUNTS)) {
      expect(PIP_LAYOUTS[r], `layout for ${r}`).toHaveLength(n);
    }
  });

  it('layouts are mirror-symmetric: every pip has its 180° partner, inversion flipped', () => {
    for (const [r, layout] of Object.entries(PIP_LAYOUTS)) {
      for (const p of layout) {
        const mirror = layout.find((m) => m.x === 100 - p.x && m.y === 100 - p.y);
        if (r === '7' && p.x === 50 && p.y === 26) continue; // the 7's lone extra (below)
        expect(mirror, `${r}: mirror of (${p.x},${p.y})`).toBeTruthy();
        expect(!!mirror!.inv, `${r}: mirror inversion at (${p.x},${p.y})`).toBe(p.y === 50 ? false : !p.inv);
      }
    }
  });

  it('the 7 is the classic exception: exactly one unpaired pip, above center, upright', () => {
    const unpaired = PIP_LAYOUTS['7']!.filter(
      (p) => !PIP_LAYOUTS['7']!.some((m) => m.x === 100 - p.x && m.y === 100 - p.y),
    );
    expect(unpaired).toEqual([{ x: 50, y: 26 }]);
  });

  it('inversion is exactly the lower half (y > 50); the y=50 row stands upright', () => {
    for (const layout of Object.values(PIP_LAYOUTS)) {
      for (const p of layout) expect(!!p.inv).toBe(p.y > 50);
    }
  });

  it('no pip sits dead-center for 3/5/9 (the art window owns the center)', () => {
    for (const r of ['3', '5', '9']) {
      expect(PIP_LAYOUTS[r]!.some((p) => p.x === 50 && p.y === 50)).toBe(false);
    }
  });

  it('the 10 carries its classic offset pair; the 7/8 their offset center pips', () => {
    expect(PIP_LAYOUTS['10']!.some((p) => p.x === 50 && p.y === 22 && !p.inv)).toBe(true);
    expect(PIP_LAYOUTS['10']!.some((p) => p.x === 50 && p.y === 78 && p.inv)).toBe(true);
    expect(PIP_LAYOUTS['7']!.some((p) => p.x === 50 && p.y === 26)).toBe(true);
    expect(PIP_LAYOUTS['8']!.some((p) => p.x === 50 && p.y === 74 && p.inv)).toBe(true);
  });
});

/* --------------------------------------------------------------- editor */

describe('the card editor', () => {
  const okJson = (card: PlayerCardData) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, card }) });

  it('saves status/tags/showcase through the card endpoint and hands back the fresh card', async () => {
    const savedCard = cardBase({ status: 'New line', tags: ['casual'], showcase: [BADGE_PROG] });
    const fetchMock = vi.fn(async () => okJson(savedCard));
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    await render(createElement(CardEditor, { card: cardBase(), onSaved, onClose: () => {} }));

    const status = q('[data-testid="card-status-input"]') as HTMLInputElement;
    await act(async () => {
      // React tracks input values natively; set + dispatch like the other suites do
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(status, 'New line');
      status.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // swap the two starting tags for Casual alone, and the showcase for the progress badge
    await act(async () => { (q('[data-testid="card-tag-story-coop"]') as HTMLButtonElement).click(); });
    await act(async () => { (q('[data-testid="card-tag-big-bank"]') as HTMLButtonElement).click(); });
    await act(async () => { (q('[data-testid="card-tag-casual"]') as HTMLButtonElement).click(); });
    await act(async () => { (q('[data-testid="card-pick-story:porch-graduate"]') as HTMLButtonElement).click(); });
    await act(async () => { (q('[data-testid="card-pick-achievement:first-dub"]') as HTMLButtonElement).click(); });
    await act(async () => { (q('[data-testid="card-pick-badge:storm-chaser"]') as HTMLButtonElement).click(); });
    await act(async () => { (q('[data-testid="card-save"]') as HTMLButtonElement).click(); });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('/api/profile/me/card');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'New line', tags: ['casual'], showcase: ['badge:storm-chaser'] });
    expect(onSaved).toHaveBeenCalledWith(savedCard);
  });

  it('caps tags at 3 in the UI, mirroring the server rule', async () => {
    await render(createElement(CardEditor, { card: cardBase({ tags: ['casual', 'competitive', 'big-bank'] }), onSaved: () => {}, onClose: () => {} }));
    const fourth = q('[data-testid="card-tag-nil-hunter"]') as HTMLButtonElement;
    await act(async () => { fourth.click(); });
    expect(fourth.getAttribute('aria-pressed')).toBe('false');
    // removing one frees the slot again
    await act(async () => { (q('[data-testid="card-tag-casual"]') as HTMLButtonElement).click(); });
    await act(async () => { fourth.click(); });
    expect(fourth.getAttribute('aria-pressed')).toBe('true');
  });

  it('an empty earned pool says so instead of showing a dead picker', async () => {
    await render(createElement(CardEditor, { card: cardBase({ badges: [], showcase: [] }), onSaved: () => {}, onClose: () => {} }));
    expect(q('[data-testid="card-showcase-empty"]')?.textContent).toContain('Earn badges');
  });
});

/* ------------------------------------------------------- profile wiring */

const RANK = { division: 'block', elo: 1000, games: 10, wins: 4, losses: 6, peak: 1100, rank: 3, of: 9 };
const credWithCard = (id: string, name: string, card: PlayerCardData) => ({
  user: { id, name, avatar: null, avatarUpdatedAt: null, tagline: null, socialLinks: {} },
  card,
  level: { level: card.level.level, xp: 463, title: card.level.title, xpForNext: 375, xpIntoLevel: 75 },
  season: { id: 's1', name: 'Season 1', endsAt: 0 },
  rank: { team: RANK, cutthroat: RANK },
  stats: { team: { games: 10, wins: 4 }, cutthroat: { games: 2, wins: 1 } },
  achievements: [],
  coins: { balance: 100 },
});
const credBare = (id: string, name: string) => {
  const { card: _card, ...rest } = credWithCard(id, name, cardBase());
  return rest;
};
const socialRec = (id: string, username: string) => ({
  id, avatar: null, username, memberSince: 1760000000000, tagline: null,
  badges: [], teamNames: [], ratings: {}, totals: { games: 0, wins: 0 }, h2h: [], champion: 0,
  stats: { games: 0, wins: 0, streak: 0, bestStreak: 0, accuracy: null, booksPerHand: null, nil: '0/0', shotsGiven: 0, shotsTaken: 0, wheels: 0, bjWins: 0, bidSec: null, playSec: null },
  awards: [],
});

function mockProfileFetch(selfPayload: unknown, otherPayload: unknown) {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/M33CH')) return json(socialRec('u-self-1', 'M33CH'));
    if (url.includes('/api/social/profile/LovleyT714')) return json(socialRec('u-other-1', 'LovleyT714'));
    if (url.endsWith('/api/profile/me')) return json(selfPayload);
    if (url.endsWith('/api/profile/u-other-1')) return json(otherPayload);
    if (url.endsWith('/api/profile/u-self-1')) return json(selfPayload);
    return json({ error: 'not found' }, false);
  }));
}

describe('ProfileView: the card heads the profile', () => {
  beforeEach(() => { mockProfileFetch(credWithCard('u-self-1', 'M33CH', cardBase({ name: 'M33CH' })), credWithCard('u-other-1', 'LovleyT714', cardBase({ name: 'LovleyT714' }))); });

  it('own profile: card first, presence + RepBlock keep their order under it, Edit card opens the editor', async () => {
    await act(async () => { await loadAccount(true); });
    await render(createElement(ProfileView, { host: 'page' }));
    expect(q('[data-testid="player-card"]')).not.toBeNull();
    expect(q('[data-testid="pcard-name"]')?.textContent).toContain('M33CH');
    expect(q('[data-testid="profile-name"]')).toBeNull();
    const src = el!.innerHTML;
    expect(src.indexOf('player-card')).toBeLessThan(src.indexOf('profile-online'));
    expect(src.indexOf('profile-online')).toBeLessThan(src.indexOf('profile-rep'));
    const edit = q('[data-testid="card-edit"]') as HTMLButtonElement;
    await act(async () => { edit.click(); });
    expect(q('[data-testid="card-editor"]')).not.toBeNull();
    expect(q('[data-testid="card-status-input"]')).not.toBeNull();
  });

  it('another player’s profile: their card, no editor affordance, the action row intact', async () => {
    await act(async () => { await loadAccount(true); });
    await render(createElement(ProfileView, { host: 'panel', name: 'LovleyT714', id: 'u:u-other-1' }));
    expect(q('[data-testid="pcard-name"]')?.textContent).toContain('LovleyT714');
    expect(q('[data-testid="card-edit"]')).toBeNull();
    expect(q('[data-testid="profile-add"]')).not.toBeNull();
    expect(q('[data-testid="profile-block"]')).not.toBeNull();
  });

  it('a payload without a card falls back to the legacy identity header', async () => {
    mockProfileFetch(credBare('u-self-1', 'M33CH'), credBare('u-other-1', 'LovleyT714'));
    await act(async () => { await loadAccount(true); });
    await render(createElement(ProfileView, { host: 'page' }));
    expect(q('[data-testid="player-card"]')).toBeNull();
    expect(q('[data-testid="profile-name"]')?.textContent).toContain('M33CH');
    expect(q('[data-testid="profile-rep"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------ css pins */

describe('the card face (source pins)', () => {
  const css = read('../src/profile/playercard.css');
  const card = read('../src/profile/PlayerCard.tsx');
  const view = read('../src/profile/ProfileView.tsx');

  it('true card proportions on the scoped root; no bare .pcard rule to fight the deck browser', () => {
    expect(css).toMatch(/\.plcard\.pcard \{[^}]*aspect-ratio: 5 \/ 7/);
    expect(css).not.toMatch(/^\.pcard\s*\{/m);
  });

  it('dual corner indices: br pinned to the bottom-right corner and rotated 180°', () => {
    expect(css).toMatch(/\.plcard \.pcard-corner\.tl \{[^}]*top:/);
    expect(css).toMatch(/\.plcard \.pcard-corner\.tl \{[^}]*left:/);
    expect(css).toMatch(/\.plcard \.pcard-corner\.br \{[^}]*bottom:/);
    expect(css).toMatch(/\.plcard \.pcard-corner\.br \{[^}]*right:/);
    expect(css).toMatch(/\.plcard \.pcard-corner\.br \{[^}]*rotate\(180deg\)/);
  });

  it('the classic double-line frame: keyline in the suit ink, gold hairline for spades', () => {
    expect(css).toMatch(/\.plcard \.pcard-front::before \{[^}]*inset: 6px/);
    expect(css).toMatch(/\.plcard \.pcard-front::before \{[^}]*border: 1\.5px solid var\(--suit-line\)/);
    expect(css).toContain('.plcard[data-suit="spades"] .pcard-front::after');
  });

  it('field treatments are styled: pips (inverted low), hero pip, art window, royal tab, joker word', () => {
    expect(css).toContain('.plcard .pcard-pipdot');
    expect(css).toMatch(/\.plcard \.pcard-pipdot\[data-inv="1"\] \{[^}]*rotate\(180deg\)/);
    expect(css).toContain('.plcard .pcard-heropip');
    expect(css).toContain('.plcard .pcard-artwin');
    expect(css).toContain('.plcard .pcard-royaltab');
    expect(css).toMatch(/\.plcard \.pcard-jokerword \{[^}]*writing-mode: vertical-rl/);
  });

  it('the back is a patterned card back with the stats as an inset panel', () => {
    expect(css).toMatch(/\.plcard \.pcard-back \{[^}]*repeating-linear-gradient\(45deg/);
    expect(css).toMatch(/\.plcard \.pcard-back \{[^}]*repeating-linear-gradient\(-45deg/);
    expect(css).toContain('.plcard .pcard-back-panel');
  });

  it('the flip is a real 3D flip, and reduced motion makes it an instant swap', () => {
    expect(css).toContain('backface-visibility: hidden');
    expect(css).toContain('.pcard-inner.flipped { transform: rotateY(180deg); }');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.pcard-inner { transition: none; }');
  });

  it('suit palettes + summit treatments are data-driven off the payload rank', () => {
    for (const suit of ['hearts', 'clubs', 'diamonds', 'spades', 'joker']) {
      expect(css).toContain(`.plcard[data-suit="${suit}"]`);
    }
    expect(card).toContain('data-suit={r.suit ?? \'joker\'}');
    expect(card).toContain('data-treatment={treatment}');
  });

  it('ProfileView renders the card as its header and the editor from the card’s own button', () => {
    expect(view).toContain("import { PlayerCard, type PlayerCardData } from './PlayerCard';");
    expect(view).toContain('<PlayerCard data={cardData}');
    expect(view).toContain('<CardEditor card={cardData}');
    expect(view.indexOf('<PlayerCard')).toBeLessThan(view.indexOf('testid="profile-rep"'));
  });
});

/* ------------------------------------------- nameplate contrast (WCAG) */

describe('nameplate contrast (computed from the shipped css)', () => {
  const css = read('../src/profile/playercard.css');
  const hexRgb = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const luminance = (hex: string): number => {
    const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = hexRgb(hex);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const ruleBlock = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    return css.slice(open, css.indexOf('}', open));
  };
  const gradientStops = (block: string): string[] =>
    [...(block.match(/background:[^;]+/)?.[0] ?? '').matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
  const inkOf = (block: string): string =>
    (block.match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? '');

  it('the display name is light ink on the deep nameplate band (≥ 7:1 at every stop)', () => {
    const stops = gradientStops(ruleBlock('.plcard .pcard-plate {'));
    expect(stops.length).toBeGreaterThanOrEqual(2);
    const ink = inkOf(ruleBlock('.plcard .pcard-name {'));
    expect(ink).toBeTruthy();
    for (const stop of stops) expect(contrast(ink, stop)).toBeGreaterThanOrEqual(7);
  });

  it('the Big Joker band inverts the pairing: dark ink on gold (≥ 4.5:1 at every stop)', () => {
    const stops = gradientStops(ruleBlock('.plcard[data-treatment="big-joker"] .pcard-plate {'));
    expect(stops.length).toBeGreaterThanOrEqual(2);
    const ink = inkOf(ruleBlock('.plcard[data-treatment="big-joker"] .pcard-name {'));
    expect(ink).toBeTruthy();
    for (const stop of stops) expect(contrast(ink, stop)).toBeGreaterThanOrEqual(4.5);
  });
});
