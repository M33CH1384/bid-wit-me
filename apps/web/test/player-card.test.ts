/**
 * @vitest-environment happy-dom
 *
 * The Player Card (owner-approved 2026-10-23): the flippable card that heads
 * every profile. The FRONT is a playing-card face for the player's rank
 * card (corner indices, the avatar as the figure, nameplate, flair band);
 * the BACK is the stats. These tests pin: the playing-card front renders
 * from the payload's rank alone (court / number / deuce / joker
 * treatments), the flip, the honest zero-record back, the editor's
 * save round-trip and caps, and the ProfileView wiring (card when the
 * payload carries one, the legacy identity header when it doesn't).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerCard, type PlayerCardData } from '../src/profile/PlayerCard';
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
  it('renders the rank card the payload carries: corners, court figure, nameplate, flair band', async () => {
    await render(createElement(PlayerCard, { data: cardBase() }));
    const card = q('[data-testid="player-card"]')!;
    expect(card.getAttribute('data-suit')).toBe('diamonds');
    expect(card.getAttribute('data-treatment')).toBe('court');
    const corners = qa('.pcard-corner');
    expect(corners).toHaveLength(2);
    for (const c of corners) {
      expect(c.querySelector('.pcard-crank')?.textContent).toBe('Q');
      expect(c.querySelector('.pcard-csuit')?.textContent).toBe('♦');
    }
    expect(q('[data-testid="pcard-name"]')?.textContent).toContain('ShotCaller');
    expect(text()).toContain('@ShotCaller');
    expect(q('[data-testid="pcard-level"]')?.textContent).toBe('Q♦ · Level 34 · Shot Caller');
    expect(text()).toContain('Here for the run, not the talk');
    expect(q('[data-testid="pcard-tags"]')?.textContent).toContain('Story Co-op');
    expect(q('[data-testid="pcard-tags"]')?.textContent).toContain('Big Bank');
    expect(q('[data-testid="pcard-showcase"]')?.textContent).toContain('Porch Graduate');
    expect(q('[data-testid="pcard-showcase"]')?.textContent).toContain('First Dub');
    expect(q('[data-testid="pcard-ribbon"]')?.textContent).toContain('4 of 11 stops cleared');
  });

  it('number cards get their pips; the Deuce, Little Joker and Big Joker get the three summit treatments', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({
        level: { level: 17, title: 'Certified' },
        rank: { level: 17, step: 17, prestige: false, rank: '7', rankName: 'Seven', suit: 'clubs', symbol: '♣', tier: 'clubs', isJoker: false, isLittleJoker: false, isBigJoker: false },
      }),
    }));
    expect(q('[data-testid="player-card"]')!.getAttribute('data-treatment')).toBe('number');
    expect(qa('.pcard-pips span')).toHaveLength(7);
    expect(q('.pcard-watermark')).toBeNull();

    await render(createElement(PlayerCard, {
      data: cardBase({
        level: { level: 49, title: 'OG' },
        rank: { level: 49, step: 49, prestige: false, rank: '2', rankName: 'Deuce', suit: 'spades', symbol: '♠', tier: 'spades', isJoker: false, isLittleJoker: false, isBigJoker: false },
      }),
    }));
    expect(q('[data-testid="player-card"]')!.getAttribute('data-treatment')).toBe('deuce');
    expect(qa('.pcard-pips.deuce span')).toHaveLength(2);

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
    expect(q('[data-testid="pcard-level"]')?.textContent).toContain('Little Joker ★ · Level 50 · King of the Block');

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
    expect(q('[data-testid="pcard-level"]')?.textContent).toContain('Big Joker ★ · Level 50 · King of the Block');
    expect(q('[data-testid="pcard-upkeep"]')).toBeNull();
  });

  it('an earned-but-inactive Big Joker shows the Little Joker face with the upkeep-due note', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({
        level: { level: 50, title: 'King of the Block' },
        rank: { level: 50, step: 50, prestige: false, rank: 'JOKER', rankName: 'Little Joker', suit: null, symbol: '★', tier: 'spades', isJoker: true, isLittleJoker: true, isBigJoker: false },
        bigJoker: { earned: true, active: false },
      }),
    }));
    expect(q('[data-testid="player-card"]')!.getAttribute('data-treatment')).toBe('little-joker');
    expect(q('[data-testid="pcard-upkeep"]')?.textContent).toContain('season upkeep due');
  });

  it('flips to the back: real record, splits, head-to-head, member-since', async () => {
    await render(createElement(PlayerCard, { data: cardBase({ vsViewer: { games: 4, wins: 3, losses: 1 } }) }));
    const flipBtn = q('[data-testid="pcard-flip"]') as HTMLButtonElement;
    await act(async () => { flipBtn.click(); });
    expect(q('.pcard-inner')!.className).toContain('flipped');
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

describe('flip mechanics (source pins)', () => {
  const css = read('../src/profile/playercard.css');
  const card = read('../src/profile/PlayerCard.tsx');
  const view = read('../src/profile/ProfileView.tsx');
  it('the flip is a real 3D flip, and reduced motion makes it an instant swap', () => {
    expect(css).toContain('backface-visibility: hidden');
    expect(css).toContain('.pcard-inner.flipped { transform: rotateY(180deg); }');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.pcard-inner { transition: none; }');
  });
  it('suit palettes + summit treatments are data-driven off the payload rank', () => {
    for (const suit of ['hearts', 'clubs', 'diamonds', 'spades', 'joker']) {
      expect(css).toContain(`.pcard[data-suit="${suit}"]`);
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
