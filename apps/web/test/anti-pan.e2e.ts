/**
 * Anti-pan with real touch: Chromium iPhone (hasTouch + CDP Input.dispatchTouchEvent) and WebKit hasTouch.
 * Drags that start on a card, in the gaps, on the plate and along the bottom edge must never scroll or pan
 * the page (scrollY and visualViewport.offsetTop stay 0), and a card drag still plays.
 */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { chromium, devices, webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
type W = { __bwmHandHits: HandHitCard[]; __bwmDrag?: string };

async function open(b: Browser, w: number, h: number): Promise<Page> {
  const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: w, height: h }, hasTouch: true, isMobile: b.browserType().name() === 'chromium' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
  await page.goto(URL);
  if (await page.getByTestId('resume').isVisible().catch(() => false)) await page.getByTestId('resume').tap();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(600);
  return page;
}

async function points(page: Page, h: number) {
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
  const legal = await page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
  let card: { x: number; y: number } | null = null;
  for (const id of legal) {
    const c = hits.find((x) => x.id === id)!;
    const xs = c.poly.map((p) => p.x), ys = c.poly.map((p) => p.y);
    for (let fy = 0.15; fy <= 0.5 && !card; fy += 0.05) for (let fx = 0.1; fx <= 0.9 && !card; fx += 0.1) {
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx, y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy;
      if (pickHandCard(x, y, hits) === id) card = { x, y };
    }
    if (card) break;
  }
  const top = Math.min(...hits.flatMap((c) => c.poly.map((p) => p.y)));
  const plate = await page.getByTestId('seat-0').boundingBox();
  return {
    card: card!,
    gap: { x: 12, y: top - 6 }, // just outside the strips, at the fan's edge
    plate: plate ? { x: plate.x + plate.width / 2, y: plate.y + plate.height / 2 } : { x: 60, y: top - 40 },
    bottom: { x: 195, y: h - 4 },
  };
}

const scroll = (p: Page) => p.evaluate(() => ({ y: window.scrollY, vv: window.visualViewport?.offsetTop ?? 0, x: window.scrollX }));

async function cdpDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  let worst = 0;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (dx * i) / 12, y: from.y + (dy * i) / 12 }] });
    const s = await scroll(page);
    worst = Math.max(worst, Math.abs(s.y), Math.abs(s.vv), Math.abs(s.x));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  const s = await scroll(page);
  return Math.max(worst, Math.abs(s.y), Math.abs(s.vv), Math.abs(s.x));
}

(async () => {
  // Chromium iPhone: real touch scrolling through CDP
  const c = await chromium.launch({ headless: true });
  try {
    for (const [w, h] of [[390, 664], [375, 667]] as const) {
      const page = await open(c, w, h);
      const pts = await points(page, h);
      for (const [name, pt] of Object.entries(pts)) for (const [dx, dy] of [[0, -160], [0, 160], [90, -40]] as const) {
        console.log(`  drag ${name} (${dx},${dy}) from ${pt.x.toFixed(0)},${pt.y.toFixed(0)}`);
        page.once("framenavigated", () => console.log(`  NAVIGATED after ${name} (${dx},${dy})`));
        const moved = await cdpDrag(page, pt, dx, dy);
        if (name === 'card' && dy < 0 && (await page.getByTestId('hand').getAttribute('data-trick-count')) === '1') {
          console.log(`chromium ${w}x${h}: card drag played (${await page.evaluate(() => (window as unknown as W).__bwmDrag)})`);
        }
        if (moved > 0) throw new Error(`chromium ${w}x${h}: drag from ${name} (${dx},${dy}) panned the page by ${moved}px`);
      }
      console.log(`chromium ${w}x${h}: no pan from card / gap / plate / bottom`);
      await page.context().close();
    }
  } finally { await c.close(); }
  // WebKit hasTouch: no CDP, so check the guards directly: touchmove is cancelled and nothing scrolled.
  const k = await webkit.launch({ headless: true });
  try {
    const page = await open(k, 390, 664);
    const pts = await points(page, 664);
    for (const [name, pt] of Object.entries(pts)) {
      // a string body: tsx's __name helper does not exist inside the page
      const r = (await page.evaluate(`(() => { const x = ${pt.x}, y = ${pt.y};
        const el = document.elementFromPoint(x, y);
        const mk = (type, yy) => { try { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: yy }); return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }); } catch { return new Event(type, { bubbles: true, cancelable: true }); } };
        el.dispatchEvent(mk('touchstart', y));
        const mv = mk('touchmove', y - 80);
        el.dispatchEvent(mv);
        el.dispatchEvent(mk('touchend', y - 80));
        const cs = getComputedStyle(document.body);
        return { prevented: mv.defaultPrevented, y: window.scrollY, vv: window.visualViewport ? window.visualViewport.offsetTop : 0, pos: cs.position, overflow: cs.overflow, ta: getComputedStyle(el).touchAction, tag: el.tagName + '.' + el.className };
      })()`)) as { prevented: boolean; y: number; vv: number; pos: string; overflow: string; ta: string; tag: string };
      console.log(`webkit 390 ${name}: prevented=${r.prevented} scrollY=${r.y} vv=${r.vv} body=${r.pos}/${r.overflow} touch-action=${r.ta} on ${r.tag.slice(0, 40)}`);
      if (!r.prevented || r.y !== 0 || r.vv !== 0) throw new Error(`webkit: touch from ${name} not guarded`);
      if (r.pos !== 'fixed' || r.overflow !== 'hidden') throw new Error('webkit: body not locked in game');
    }
  } finally { await k.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
