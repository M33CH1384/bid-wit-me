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

  it('the back carries the line as a stat table in the inset panel: modes, career totals, streak, head-to-head, member-since', async () => {
    await render(createElement(PlayerCard, { data: cardBase({ vsViewer: { games: 4, wins: 3, losses: 1 } }) }));
    const panel = q('.pcard-back-panel')!;
    expect(panel).not.toBeNull();
    const table = q('[data-testid="pcard-stats"]')!;
    expect(table).not.toBeNull();
    expect(table.tagName).toBe('TABLE');
    expect(panel.contains(table)).toBe(true);
    /* column headers, baseball-card style */
    expect(qa('[data-testid="pcard-stats"] thead th').map((h) => h.textContent)).toEqual(['Mode', 'Rating', 'W–L', 'Win %', 'Games']);
    /* the data rows carry the same five aligned cells each */
    const prow = q('[data-testid="pcard-row-partnership"]')!;
    expect(prow.children).toHaveLength(5);
    expect(prow.textContent).toContain('Partnership');
    expect(prow.textContent).toContain('1240');
    expect(prow.textContent).toContain('6–4');
    expect(prow.textContent).toContain('60%');
    expect(prow.textContent).toContain('10');
    const crow = q('[data-testid="pcard-row-cutthroat"]')!;
    expect(crow.children).toHaveLength(5);
    expect(crow.textContent).toContain('Cutthroat');
    expect(crow.textContent).toContain('980');
    expect(crow.textContent).toContain('1–1');
    expect(crow.textContent).toContain('50%');
    /* the career line is the totals row: record, win%, games */
    const career = q('[data-testid="pcard-row-career"]')!;
    expect(career.children).toHaveLength(5);
    expect(career.textContent).toContain('Career');
    expect(career.textContent).toContain('32–18');
    expect(career.textContent).toContain('64%');
    expect(career.textContent).toContain('50');
    /* the streak rides its own ruled row in the same grid */
    const streak = q('[data-testid="pcard-row-streak"]')!;
    expect(streak.textContent).toContain('Streak');
    expect(streak.textContent).toContain('W3');
    expect(streak.textContent).toContain('best W7');
    expect((streak.querySelector('td') as HTMLTableCellElement).colSpan).toBe(4);
    expect(q('[data-testid="pcard-vs"]')?.textContent).toContain('You vs ShotCaller:');
    expect(q('[data-testid="pcard-vs"]')?.textContent).toContain('3–1');
    expect(text()).toMatch(/Member since \w+ \d{4}/);
  });

  it('a mode with no games gets an honest row in the table — its seed rating never prints', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({
        stats: {
          games: 10, wins: 6, losses: 4, winPct: 60, streak: 0, bestStreak: 0,
          team: { rating: 1240, games: 10, wins: 6, losses: 4 },
          cutthroat: { rating: 1000, games: 0, wins: 0, losses: 0 },
        },
      }),
    }));
    const crow = q('[data-testid="pcard-row-cutthroat"]')!;
    expect(crow.textContent).toContain('Cutthroat');
    expect(crow.textContent).toContain('No games yet');
    expect(crow.textContent).not.toContain('1000');
    expect(q('[data-testid="pcard-row-partnership"]')?.textContent).toContain('1240');
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
    expect(q('[data-testid="pcard-stats"]')).toBeNull();
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

  it('own profile: status + presence up top, then the card, RepBlock under it, Edit card opens the editor', async () => {
    await act(async () => { await loadAccount(true); });
    await render(createElement(ProfileView, { host: 'page' }));
    expect(q('[data-testid="player-card"]')).not.toBeNull();
    expect(q('[data-testid="pcard-name"]')?.textContent).toContain('M33CH');
    expect(q('[data-testid="profile-name"]')).toBeNull();
    const src = el!.innerHTML;
    // v4 (owner): the presence line renders ABOVE the card, and the card's
    // own status rides up there too — exactly once, never in both places.
    expect(src.indexOf('profile-online')).toBeLessThan(src.indexOf('player-card'));
    expect(src.indexOf('player-card')).toBeLessThan(src.indexOf('profile-rep'));
    expect(q('[data-testid="pcard-status-top"]')).not.toBeNull();
    expect(src.indexOf('Here for the run, not the talk')).toBeLessThan(src.indexOf('player-card'));
    expect(src.split('Here for the run, not the talk')).toHaveLength(2);
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

/* ----------------------------------- polish pass (owner, 2026-10-23) */

describe('polish pass: classic ink, real-card scale, the corner owns its corner', () => {
  const css = read('../src/profile/playercard.css');
  const block = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    return css.slice(open, css.indexOf('}', open));
  };
  const suitDeep = (suit: string): [number, number, number] => {
    const m = block(`.plcard[data-suit="${suit}"]`).match(/--suit-deep:\s*#([0-9a-fA-F]{6})/);
    expect(m, `--suit-deep for ${suit}`).toBeTruthy();
    const h = m![1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const cqwOf = (selector: string): number => {
    const m = block(selector).match(/font-size:\s*([\d.]+)cqw/);
    expect(m, `cqw font-size in ${selector}`).toBeTruthy();
    return parseFloat(m![1]!);
  };
  const pctOf = (selector: string, prop: string): number => {
    const m = block(selector).match(new RegExp(`${prop}:\\s*([\\d.]+)%`));
    expect(m, `${prop} % in ${selector}`).toBeTruthy();
    return parseFloat(m![1]!);
  };

  it('classic suit ink: hearts/diamonds print red, clubs/spades print black', () => {
    for (const suit of ['hearts', 'diamonds']) {
      const [r, g, b] = suitDeep(suit);
      expect(r, `${suit} ink is red`).toBeGreaterThanOrEqual(150);
      expect(r - g).toBeGreaterThanOrEqual(70);
      expect(r - b).toBeGreaterThanOrEqual(50);
    }
    for (const suit of ['clubs', 'spades']) {
      const [r, g, b] = suitDeep(suit);
      // black family: every channel low, near-neutral (never green/blue/violet)
      expect(Math.max(r, g, b), `${suit} ink is black`).toBeLessThanOrEqual(48);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12);
    }
  });

  it('indices and pips print at real-card scale, sized off the card’s own width', () => {
    expect(block('.plcard.pcard {')).toContain('container-type: inline-size');
    expect(cqwOf('.plcard .pcard-crank {')).toBeGreaterThanOrEqual(16);
    expect(cqwOf('.plcard .pcard-csuit {')).toBeGreaterThanOrEqual(11);
    expect(cqwOf('.plcard .pcard-pipdot {')).toBeGreaterThanOrEqual(20);
    // the deck variant must not shrink them back down — cqw does the scaling
    expect(css).not.toContain('[data-variant="deck"] .pcard-crank');
    expect(css).not.toContain('[data-variant="deck"] .pcard-csuit');
    expect(css).not.toContain('[data-variant="deck"] .pcard-pipdot');
    expect(css).not.toContain('[data-variant="deck"] .pcard-heropip');
  });

  it('a two-digit rank prints condensed (data-two from the component, a smaller cqw in css)', async () => {
    expect(cqwOf('.plcard .pcard-crank[data-two="1"] {')).toBeLessThan(cqwOf('.plcard .pcard-crank {'));
    await render(createElement(PlayerCard, {
      data: cardBase({ rank: numberRank('10', 'clubs', '♣', 21) }),
    }));
    const cranks = qa('.pcard-crank');
    expect(cranks).toHaveLength(2);
    for (const c of cranks) expect(c.getAttribute('data-two')).toBe('1');
    await render(createElement(PlayerCard, {
      data: cardBase({ rank: numberRank('4', 'clubs', '♣', 15) }),
    }));
    for (const c of qa('.pcard-crank')) expect(c.getAttribute('data-two')).toBeNull();
  });

  it('the corner contract: every corner pins ALL FOUR offsets (the styles.css leak cannot stretch the box)', () => {
    // styles.css's deck-browser .pcard-corner sets top/left at lower
    // specificity; any offset this sheet leaves unpinned leaks through
    // and stretches the corner box across the face (the circled defect).
    const base = block('.plcard .pcard-corner {');
    for (const pin of ['top: auto', 'right: auto', 'bottom: auto', 'left: auto']) {
      expect(base, `base corner pins ${pin}`).toContain(pin);
    }
    const tl = block('.plcard .pcard-corner.tl {');
    expect(tl).toMatch(/top:\s*2\.4%/);
    expect(tl).toMatch(/left:\s*3\.5%/);
    expect(tl).toContain('right: auto');
    expect(tl).toContain('bottom: auto');
    const br = block('.plcard .pcard-corner.br {');
    expect(br).toMatch(/bottom:\s*2\.4%/);
    expect(br).toMatch(/right:\s*3\.5%/);
    expect(br).toContain('top: auto');
    expect(br).toContain('left: auto');
    expect(br).toContain('rotate(180deg)');
  });

  it('the nameplate is a plaque between the corners: its right inset clears the index zone with room to spare', () => {
    const plateRight = pctOf('.plcard .pcard-plate {', 'right');
    const plateLeft = pctOf('.plcard .pcard-plate {', 'left');
    expect(plateRight).toBeGreaterThanOrEqual(24);
    expect(plateLeft).toBeGreaterThanOrEqual(9);
    // the bottom-right index's ink zone: its right offset plus the wider
    // of (the condensed two-digit numeral, the corner suit glyph)
    const zone = pctOf('.plcard .pcard-corner.br {', 'right')
      + Math.max(cqwOf('.plcard .pcard-crank[data-two="1"] {') * 1.05, cqwOf('.plcard .pcard-csuit {') * 0.95);
    expect(plateRight - zone).toBeGreaterThanOrEqual(5);
  });

  it('the number art window is sized by pip density now (the v4 pins below carry the sizes)', () => {
    expect(css).toContain('.plcard .pcard-artwin.number.sparse {');
    expect(css).toContain('.plcard .pcard-artwin.number.dense {');
    expect(css).toContain('.plcard .pcard-artwin.number.tight {');
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

/* --------------------------- layout pass v4 (owner, 2026-10-23) */

describe('layout pass v4: status up top, the portrait grows, courts fill the field', () => {
  const css = read('../src/profile/playercard.css');
  const card = read('../src/profile/PlayerCard.tsx');
  const view = read('../src/profile/ProfileView.tsx');
  const block = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    return css.slice(open, css.indexOf('}', open));
  };

  it('statusPlacement="above" renders the status over the card, exactly once; the default keeps it below', async () => {
    await render(createElement(PlayerCard, { data: cardBase(), statusPlacement: 'above' }));
    const top = q('[data-testid="pcard-status-top"]')!;
    expect(top).not.toBeNull();
    expect(top.textContent).toContain('Here for the run, not the talk');
    expect(el!.innerHTML.indexOf('pcard-status-top')).toBeLessThan(el!.innerHTML.indexOf('player-card'));
    expect(q('.pcard-below')!.textContent).not.toContain('Here for the run, not the talk');
    expect(text().split('Here for the run, not the talk')).toHaveLength(2);

    await render(createElement(PlayerCard, { data: cardBase() }));
    expect(q('[data-testid="pcard-status-top"]')).toBeNull();
    expect(q('.pcard-below .pcard-status')?.textContent).toContain('Here for the run, not the talk');
  });

  it('ProfileView asks for the status up top and puts its own tagline + presence row above the card', () => {
    expect(card).toContain("statusPlacement?: 'above' | 'below'");
    expect(view).toContain('statusPlacement="above"');
    expect(view.indexOf('className="prof-above-card"')).toBeLessThan(view.indexOf('<PlayerCard'));
    expect(view.indexOf('data-testid="profile-online"')).toBeLessThan(view.indexOf('<PlayerCard'));
    // the region line is the one identity line that stays under the card
    expect(view.indexOf('data-testid="profile-region"')).toBeGreaterThan(view.indexOf('<PlayerCard'));
    expect(css).toMatch(/\.prof-above-card \{[^}]*align-items: center/);
    expect(css).toMatch(/\.pcard-above \{[^}]*text-align: center/);
  });

  it('number windows carry their density group from the component (sparse/dense/tight)', async () => {
    const cases: [string, string][] = [['4', 'sparse'], ['3', 'sparse'], ['5', 'sparse'], ['6', 'dense'], ['9', 'dense'], ['10', 'dense'], ['7', 'tight'], ['8', 'tight']];
    for (const [rank, group] of cases) {
      await render(createElement(PlayerCard, {
        data: cardBase({ rank: numberRank(rank, 'clubs', '♣', 10 + Number(rank)) }),
      }));
      const win = q('.pcard-artwin.number')!;
      expect(win, `rank ${rank}`).not.toBeNull();
      expect(win.classList.contains(group), `rank ${rank} is ${group}`).toBe(true);
    }
  });

  it('window size floors: sparse ≥ 65% of the field, dense/tight ≥ 45%, ace ≥ 55%, deuce ≥ 45%', () => {
    const widthOf = (selector: string) => parseFloat(block(selector).match(/width:\s*([\d.]+)%/)![1]!);
    expect(widthOf('.plcard .pcard-artwin.number.sparse {')).toBeGreaterThanOrEqual(65);
    expect(widthOf('.plcard .pcard-artwin.number.dense {')).toBeGreaterThanOrEqual(45);
    expect(widthOf('.plcard .pcard-artwin.number.tight {')).toBeGreaterThanOrEqual(45);
    expect(widthOf('.plcard .pcard-artwin.ace {')).toBeGreaterThanOrEqual(55);
    expect(widthOf('.plcard .pcard-artwin.deuce {')).toBeGreaterThanOrEqual(45);
  });

  it('no pip ink overlaps the grown window at any rank 3–10 (geometry model over the shipped css)', () => {
    // Card = 100 units wide × 140 tall. The field box: left 14, width 72,
    // top 11.5% of 140 = 16.1, height 70.5% of 140 = 98.7. Pip ink spans
    // ~15 units around each PIP_LAYOUTS center. The window is centered.
    const FIELD = { left: 14, width: 72, top: 16.1, height: 98.7 };
    const GROUP: Record<string, string> = { '3': 'sparse', '4': 'sparse', '5': 'sparse', '6': 'dense', '7': 'tight', '8': 'tight', '9': 'dense', '10': 'dense' };
    const winBox = (group: string) => {
      const b = block(`.plcard .pcard-artwin.number.${group} {`);
      const wPct = parseFloat(b.match(/width:\s*([\d.]+)%/)![1]!);
      const ar = b.match(/aspect-ratio:\s*([\d.]+) \/ ([\d.]+)/)!;
      const w = wPct * FIELD.width / 100;
      const h = w * parseFloat(ar[2]!) / parseFloat(ar[1]!);
      return { w, h };
    };
    for (const [rank, layout] of Object.entries(PIP_LAYOUTS)) {
      if (rank === '2') continue; // the Deuce field, not a number layout
      const { w, h } = winBox(GROUP[rank]!);
      const cx = FIELD.left + FIELD.width / 2;
      const cy = FIELD.top + FIELD.height / 2;
      for (const p of layout) {
        const px = FIELD.left + p.x * FIELD.width / 100;
        const py = FIELD.top + p.y * FIELD.height / 100;
        const overlap = Math.abs(px - cx) < w / 2 + 7.5 && Math.abs(py - cy) < h / 2 + 7.5;
        expect(overlap, `${rank}: pip (${p.x},${p.y}) vs window ${w.toFixed(1)}×${h.toFixed(1)}`).toBe(false);
      }
    }
  });

  it('the Ace keeps its hero pip: the pip drops to top 66% and the grown window rides above it', () => {
    expect(block('.plcard .pcard-field[data-field="ace"] .pcard-heropip {')).toContain('top: 66%');
  });

  it('court figures fill the field keyline to keyline, indices backed in ivory, the tab inside the figure', async () => {
    const field = block('.plcard[data-treatment="court"] .pcard-field {');
    for (const pin of ['top: 3%', 'bottom: 3%', 'left: 3%', 'right: 3%']) expect(field).toContain(pin);
    expect(block('.plcard[data-treatment="court"] .pcard-corner {')).toContain('background: rgba(253, 250, 241');
    expect(block('.plcard[data-treatment="court"] .pcard-royaltab {')).toContain('top: 10px');
    await render(createElement(PlayerCard, { data: cardBase() }));
    expect(q('.pcard-field[data-field="court"] .pcard-artwin.court')).not.toBeNull();
    expect(qa('.pcard-corner')).toHaveLength(2);
  });
});

/* ---------------- flip culling + footprint (owner iOS report, 2026-10-23) */

describe('flip culling: the turned-away face can never paint (iOS bleed fix)', () => {
  const css = read('../src/profile/playercard.css');
  const block = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    return css.slice(open, css.indexOf('}', open));
  };

  it('the flipper keeps the shared 3D context; the faces stay stacked in one cell', () => {
    expect(block('.plcard .pcard-inner')).toContain('transform-style: preserve-3d');
    expect(block('.plcard .pcard-face')).toContain('grid-area: 1 / 1');
    expect(css).toContain('.pcard-inner.flipped { transform: rotateY(180deg); }');
    expect(block('.plcard .pcard-back')).toContain('transform: rotateY(180deg)');
  });

  it('both faces share ONE sizing box, so the footprint is identical in both states', () => {
    const face = block('.plcard .pcard-face');
    expect(face).toContain('width: 100%');
    expect(face).toContain('height: 100%');
    /* neither face carries a size of its own — the front's own block is
     * paint only — and no transform in the sheet scales the card */
    expect(block('.plcard .pcard-front')).not.toMatch(/width:|height:|inset:|margin:/);
    expect(css).not.toContain('scale(');
  });

  it('both faces carry backface culling in both spellings', () => {
    const face = block('.plcard .pcard-face');
    expect(face).toContain('backface-visibility: hidden');
    expect(face).toContain('-webkit-backface-visibility: hidden');
  });

  it('every descendant layer of a face is culled with its face (the bleed path)', () => {
    const i = css.indexOf('.plcard .pcard-face *,');
    expect(i).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    expect(css.slice(i, open)).toContain('.pcard-face::before');
    expect(css.slice(i, open)).toContain('.pcard-face::after');
    const rule = css.slice(open, css.indexOf('}', open));
    expect(rule).toContain('backface-visibility: hidden');
    expect(rule).toContain('-webkit-backface-visibility: hidden');
  });

  it('settled states are deterministic: the turned-away face is visibility:hidden', () => {
    expect(block('.plcard .pcard-back')).toContain('visibility: hidden');
    expect(css).toContain('.pcard-inner.flipped .pcard-front { visibility: hidden; }');
    expect(css).toContain('.pcard-inner.flipped .pcard-back { visibility: visible; }');
    /* the swap lands mid-flip, when both faces are edge-on — not at the tap */
    expect(block('.plcard .pcard-face')).toContain('transition: visibility 0s linear .28s');
    /* reduced motion makes the swap instant with the class */
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('.pcard-face { transition: none; }');
  });

  it('no will-change in the sheet (no extra promoted layers to punch through)', () => {
    expect(css).not.toContain('will-change');
  });

  it('the stat table is ruled and tabular, and the retired blocks stay retired', () => {
    expect(css).toContain('.plcard .pcard-stats');
    expect(block('.plcard .pcard-stats')).toContain('border-collapse: collapse');
    expect(css).toMatch(/\.plcard \.pcard-stats thead th \{[^}]*text-transform: uppercase/);
    expect(css).toMatch(/\.plcard \.pcard-stats tbody td \{[^}]*font-variant-numeric: tabular-nums/);
    expect(css).not.toContain('.pcard-record');
    expect(css).not.toContain('.pcard-split');
  });
});

/* ------------------------------------------------- back fit (owner flip) */
/* The owner's second flip (2026-10-23): the bleed was gone and the
 * table had landed, but the frame still read off — and the table did
 * not FIT its panel: WIN % sheared mid-glyph at the panel's edge and
 * the GAMES column lived entirely outside it. The DOM carried all
 * five columns all along (the content pins above passed); what was
 * missing was a FIT contract. These pins are that contract: fixed
 * layout over an explicit colgroup whose shares sum to the table,
 * the panel's box math and the back's type in one proportional unit
 * system (cqw), one stepped frame, and the rhythm that fills the
 * panel. Happy-dom cannot lay out, so the contract is structural —
 * proportions that cannot clip at any width the card renders at. */
describe('back fit pass: the table fits its frame at every card size', () => {
  const css = read('../src/profile/playercard.css');
  const card = read('../src/profile/PlayerCard.tsx');
  const block = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    return css.slice(open, css.indexOf('}', open));
  };

  it('the stat table is fixed-layout at the panel width — content can never widen it', () => {
    const stats = block('.plcard .pcard-stats');
    expect(stats).toContain('table-layout: fixed');
    expect(stats).toContain('width: 100%');
  });

  it('the component deals the five-column colgroup the contract sizes', async () => {
    expect(card).toContain('<colgroup>');
    const names = ['pcard-col-mode', 'pcard-col-rating', 'pcard-col-wl', 'pcard-col-winpct', 'pcard-col-games'];
    for (const cls of names) expect(card).toContain(`className="${cls}"`);
    await render(createElement(PlayerCard, { data: cardBase() }));
    const cols = qa('[data-testid="pcard-stats"] colgroup col');
    expect(cols.map((c) => c.className)).toEqual(names);
  });

  it('the column shares are explicit in the sheet and sum to exactly the table', () => {
    const shares = ['mode', 'rating', 'wl', 'winpct', 'games'].map((n) => {
      const b = block(`.plcard .pcard-stats col.pcard-col-${n}`);
      const m = b.match(/width: ([\d.]+)%/);
      expect(m, `col ${n} width`).not.toBeNull();
      return Number(m![1]);
    });
    expect(shares).toEqual([29, 18, 18, 18, 17]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('one proportional system: panel inset, panel padding and back type all run in cqw', () => {
    const panel = block('.plcard .pcard-back-panel');
    /* a single inset value in cqw = the same px band on all four
     * sides at any card size; %-axis insets can never promise that */
    expect(panel).toContain('inset: 4.5cqw');
    expect(panel).toContain('padding: 4.7cqw 4cqw');
    expect(block('.plcard .pcard-stats')).toContain('font-size: 4.05cqw');
    expect(block('.plcard .pcard-stats thead th')).toContain('font-size: 2.8cqw');
    /* the retired fixed-px deck stat font would break the contract
     * at deck width — it stays retired */
    expect(css).not.toContain('[data-variant="deck"] .pcard-stats');
  });

  it('one stepped frame: the keyline rides concentric to the card edge', () => {
    const key = block('.plcard .pcard-back::before');
    expect(key).toContain('inset: 2cqw');
    /* 13px is the face's own radius (the .plcard.pcard rule): the
     * keyline's radius is the edge radius minus its inset, so the
     * two corners stay concentric at every card size */
    expect(key).toContain('border-radius: calc(13px - 2cqw)');
  });

  it('the rhythm is in the sheet: tall ruled rows, even gaps, anchored footnotes', () => {
    expect(block('.plcard .pcard-back-panel')).toContain('gap: 3.2cqw');
    expect(css).toMatch(/\.plcard \.pcard-stats th, \.plcard \.pcard-stats td \{[^}]*padding: 4\.8cqw \.6cqw/);
    expect(block('.plcard .pcard-back-story')).toContain('margin: auto 0 0');
    expect(block('.plcard .pcard-nogames')).toContain('margin: auto 0');
  });
});
