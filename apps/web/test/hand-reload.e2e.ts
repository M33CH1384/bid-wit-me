/**
 * Round 16: reload, then tap the fan at 390×844.
 * The raised 7♣ must take the tap that lands on it, not the 5♣ underneath.
 * A strip tap selects that card. One tap never plays.
 */
import { writeFileSync } from 'node:fs';
import { makeRules, newGame, viewFor, canRunIt, type Card, type GameState } from '@spades/rules';
import { DEFAULT_SETTINGS } from '../src/settings';
import { chromium, webkit, type Browser, type Page } from 'playwright-core';

const MINE: Card[] = ['LJ', '8S', 'AH', '6H', 'AC', 'KC', '7C', '5C'];

function fixture(): string {
  const rules = makeRules('joker');
  const dealt = newGame(rules, 'hand-reload', { dealer: 3 });
  const all = dealt.hands.flat();
  for (const c of MINE) if (!all.includes(c)) throw new Error(`deck is missing ${c}`);
  const rest = all.filter((c) => !MINE.includes(c));
  const played = rest.slice(0, 20);
  const others = rest.slice(20);
  if (others.length !== 24) throw new Error(`expected 24 opponent cards, got ${others.length}`);
  const hands: Card[][] = [MINE, others.slice(0, 8), others.slice(8, 16), others.slice(16, 24)];
  const tricks = Array.from({ length: 5 }, (_, t) => {
    const cards = played.slice(t * 4, t * 4 + 4);
    return { leader: 0, winner: 1, plays: cards.map((card, seat) => ({ seat, card })) };
  });
  const st: GameState = {
    ...dealt,
    phase: 'playing',
    bids: [3, 3, 3, 3],
    hands,
    tricks,
    tricksWon: [2, 2, 1, 0],
    turn: 0,
    trick: { leader: 0, winner: null, plays: [] },
    spadesBroken: true,
    revealed: [true, true, true, true],
  };
  viewFor(st, 0);
  for (let seat = 1; seat < 4; seat++) if (canRunIt(st, seat)) throw new Error(`seat ${seat} can run`);
  const save = {
    v: 1,
    savedAt: Date.now(),
    seed: st.seed,
    settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: 'novice' },
    state: st,
    chat: [],
    names: ['You', 'Big Mike', 'Omar', 'Sven'],
    teamNames: ['YOU + OMAR', 'BIG WHISPERERS'],
  };
  return JSON.stringify(save);
}

interface Hit { id: string; order: number; poly: { x: number; y: number }[] }

function inside(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > y) !== (b.y > y)) {
      const t = (y - a.y) / (b.y - a.y);
      if (x < a.x + (b.x - a.x) * t) inn = !inn;
    }
  }
  return inn;
}

function topAt(hits: Hit[], x: number, y: number): string | null {
  let best: Hit | null = null;
  for (const c of hits) {
    if (!inside(x, y, c.poly)) continue;
    if (!best || c.order > best.order) best = c;
  }
  return best?.id ?? null;
}

/** A point on this card's drawn face. `left` walks toward the exposed edge until this card is the one on top. */
function pointOf(hits: Hit[], id: string, where: 'center' | 'left'): { x: number; y: number } {
  const card = hits.find((c) => c.id === id);
  if (!card) throw new Error(`no drawn quad for ${id}`);
  const poly = card.poly;
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  if (where === 'center') {
    if (topAt(hits, cx, cy) !== id) throw new Error(`center of ${id} is ${topAt(hits, cx, cy)}`);
    return { x: cx, y: cy };
  }
  const left = [...poly].sort((a, b) => a.x - b.x).slice(0, 2);
  const lx = (left[0]!.x + left[1]!.x) / 2;
  const ly = (left[0]!.y + left[1]!.y) / 2;
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const x = cx + (lx - cx) * t;
    const y = cy + (ly - cy) * t;
    if (topAt(hits, x, y) === id) return { x, y };
  }
  throw new Error(`no visible strip for ${id}`);
}

const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

async function chromiumBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
}

async function tap(page: Page, id: string, where: 'center' | 'left'): Promise<void> {
  const hits = await page.evaluate(() => (window as unknown as { __bwmHandHits?: Hit[] }).__bwmHandHits ?? []);
  const p = pointOf(hits, id, where);
  const box = await page.locator('.table-canvas canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  const top = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('.table-canvas canvas');
    if (!canvas) return 'no-canvas';
    const rect = canvas.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + x, rect.top + y);
    return `${el?.tagName ?? 'none'}.${el?.className ?? ''} @${rect.left.toFixed(0)},${rect.top.toFixed(0)} ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`;
  }, p);
  console.log('tap', id, where, p.x.toFixed(0), p.y.toFixed(0), 'box', box.x.toFixed(0), box.y.toFixed(0), box.width.toFixed(0), top);
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

async function ready(page: Page): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 45000 });
  await page.waitForFunction(() => {
    const screen = document.querySelector('.table-screen');
    const hits = (window as unknown as { __bwmHandHits?: { id: string }[] }).__bwmHandHits;
    return !!screen && !screen.hasAttribute('inert') && !!hits && hits.some((c) => c.id === '7C') && hits.some((c) => c.id === '5C');
  }, null, { timeout: 45000 });
}

async function runCase(browser: Browser, save: string, base: string): Promise<void> {
  const page = await browser.newPage(IPHONE);
  page.setDefaultTimeout(20000);
  await page.addInitScript((raw) => {
    localStorage.setItem('bwm.game', raw);
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
    localStorage.setItem('bwm.runItTip.v1', JSON.stringify({ shown: 9, used: true }));
  }, save);
  const shots = '/opt/cursor/artifacts';
  try {
    await page.goto(base);
    await page.getByTestId('resume').click();
    await ready(page);
    await page.reload();
    await page.getByTestId('resume').click();
    await ready(page);

    await page.screenshot({ path: `${shots}/hand-before-tap.png` });
    await tap(page, 'AH', 'left');
    try {
      await page.waitForFunction(() => document.querySelector('[data-testid="card-AH"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 4000 });
    } catch {
      const pressed = await page.locator('[data-testid^="card-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-testid')}:${e.getAttribute('aria-pressed')}`));
      throw new Error(`AH strip did not select AH (${pressed.join(' ')})`);
    }
    const trickAfterAh = await page.getByTestId('hand').getAttribute('data-trick-count');
    if (trickAfterAh !== '0') throw new Error(`a single tap on AH played it (trick ${trickAfterAh})`);
    if (await page.getByTestId('card-AH').count() !== 1) throw new Error('AH left the hand on one tap');

    await tap(page, 'KC', 'left');
    await page.waitForTimeout(300);
    const afterKc = await page.evaluate(() => ({
      last: (window as unknown as { __bwmLastTap?: string }).__bwmLastTap ?? '',
      pressed: [...document.querySelectorAll('[data-testid^="card-"]')].filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.getAttribute('data-testid')),
    }));
    if (!afterKc.pressed.includes('card-KC')) throw new Error(`KC strip selected ${afterKc.pressed.join(',') || 'nothing'} (listener ${afterKc.last})`);
    const pressed = await page.locator('[data-testid^="card-"][aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    if (pressed.join() !== 'card-KC') throw new Error(`KC strip selected ${pressed.join() || 'nothing'}`);

    await tap(page, '7C', 'left');
    await page.waitForFunction(() => document.querySelector('[data-testid="card-7C"]')?.getAttribute('aria-pressed') === 'true');
    if (await page.getByTestId('card-5C').count() !== 1) throw new Error('tapping the 7 played or dropped the 5');
    await page.screenshot({ path: `${shots}/hand-raised-7c.png` });

    await tap(page, '7C', 'center');
    await page.waitForFunction(() => !document.querySelector('[data-testid="card-7C"]'));
    const left = await page.locator('[data-testid^="card-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    if (left.includes('card-7C')) throw new Error('the raised 7 stayed in the hand');
    if (!left.includes('card-5C')) throw new Error('the second tap on the raised 7 played the 5');
    if (left.length !== 7) throw new Error(`expected one card played, hand is ${left.join(' ')}`);
    const trick = await page.getByTestId('hand').getAttribute('data-trick-count');
    await page.screenshot({ path: `${shots}/hand-played-7c.png` });
    console.log('raised 7C passed after reload', 'trick', trick, 'hand', left.join(' '));
  } catch (err) {
    await page.screenshot({ path: `${shots}/hand-reload-fail.png` }).catch(() => undefined);
    throw err;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const save = fixture();
  writeFileSync('/tmp/hand-reload-save.json', save);
  const base = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
  if (process.env.BWM_BROWSER === 'chromium') {
    const browser = await chromiumBrowser();
    try {
      console.log('browser chromium-iphone');
      await runCase(browser, save, base);
    } finally {
      await browser.close().catch(() => undefined);
    }
    return;
  }
  let webkitError: unknown;
  try {
    const browser = await webkit.launch({ headless: true });
    try {
      console.log('browser webkit');
      await runCase(browser, save, base);
      return;
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (err) {
    webkitError = err;
    console.log('webkit crashed, using chromium', err instanceof Error ? err.message : err);
  }
  const browser = await chromiumBrowser();
  try {
    console.log('browser chromium-iphone');
    await runCase(browser, save, base);
  } catch (err) {
    console.error('webkit had failed first:', webkitError);
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
