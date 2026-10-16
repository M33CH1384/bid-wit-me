/**
 * Hand-cover bug (live, after #166): the hand showed one huge card with the rest hidden behind it.
 * WebKit 390: play cards by tap (two-tap) and by drag, select/raise a card, and after each step assert every hand card
 * keeps a visible strip (≥ MIN px wide) and stays at hand size (no table/flight scale leaking in).
 * Also reports the fan span (% of viewport), card px and the minimum strip.
 */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const MIN = Number(process.env.BWM_MIN_STRIP ?? 26);
type W = { __bwmHandHits: HandHitCard[] };
export const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '375', width: 375, height: 667 },
  { name: '430', width: 430, height: 932 },
  { name: '360', width: 360, height: 780 },
];

function save(seed: string, venue = 'classic'): string {
  const dealt = newGame(makeRules('joker'), seed, { dealer: 3 });
  const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: 'novice', venue }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}

/** Visible strip of each card: widest run of x (CSS px) along a few rows where that card is the top hit. */
export async function measure(page: Page): Promise<{ n: number; span: number; cardPx: number; minStrip: number; worst: string; sizes: number[]; strips: number[] }> {
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits ?? []);
  const vw = await page.evaluate(() => innerWidth);
  let minStrip = 1e9, worst = '';
  const xsAll = hits.flatMap((h) => h.poly.map((p) => p.x));
  const strips: number[] = [];
  const sizes = hits.map((h) => { const xs = h.poly.map((p) => p.x), ys = h.poly.map((p) => p.y); return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); });
  for (const h of hits) {
    const xs = h.poly.map((p) => p.x), ys = h.poly.map((p) => p.y);
    let best = 0;
    for (let fy = 0.08; fy <= 0.5; fy += 0.06) {
      const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy;
      let run = 0;
      for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
        if (x < 0 || x > vw) { run = 0; continue; }
        if (pickHandCard(x, y, hits) === h.id) { run++; best = Math.max(best, run); } else run = 0;
      }
    }
    strips.push(best);
    if (best < minStrip) { minStrip = best; worst = h.id; }
  }
  const cardPx = await page.evaluate(() => { const h = (window as unknown as W).__bwmHandHits?.[0]; if (!h) return 0; const [a, b] = [h.poly[0]!, h.poly[1]!]; return Math.round(Math.hypot(b.x - a.x, b.y - a.y)); });
  return { n: hits.length, strips, span: hits.length ? ((Math.min(vw, Math.max(...xsAll)) - Math.max(0, Math.min(...xsAll))) / vw) * 100 : 0, cardPx, minStrip: hits.length ? minStrip : 0, worst, sizes };
}

async function legal(page: Page): Promise<string[]> {
  return page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
}
async function point(page: Page, id: string): Promise<{ x: number; y: number }> {
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
  const h = hits.find((c) => c.id === id)!;
  const xs = h.poly.map((p) => p.x), ys = h.poly.map((p) => p.y);
  for (let fy = 0.1; fy <= 0.5; fy += 0.05) for (let fx = 0.05; fx <= 0.95; fx += 0.05) {
    const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx, y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy;
    if (pickHandCard(x, y, hits) === id) return { x, y };
  }
  throw new Error(`no visible point on ${id}`);
}
async function myTurn(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="hand"] [data-legal="true"]').length > 0, undefined, { timeout: 30000 });
  await page.waitForTimeout(500);
}

(async () => {
  const b = await webkit.launch({ headless: true });
  const fails: string[] = [];
  const check = async (page: Page, label: string, ref: number) => {
    const m = await measure(page);
    const sorted=[...m.sizes].sort((a,b)=>a-b); const median=sorted[Math.floor(sorted.length/2)]||ref; const big=Math.max(...m.sizes)/median; void ref;
    console.log(`${label}: ${m.n} cards, span ${m.span.toFixed(1)}%, card ${m.cardPx}px, strips ${m.strips.join(' ')} (${m.worst}), ×${big.toFixed(2)}`);
    if (m.minStrip < MIN) fails.push(`${label}: ${m.worst} strip ${m.minStrip}px < ${MIN}`);
    if (big > 1.25) fails.push(`${label}: one hand card is ×${big.toFixed(2)} the median hand card`);
    return m;
  };
  try {
    const H = Number(process.env.BWM_H ?? 844);
    for (const venue of ['classic', 'random']) {
      const page = await b.newPage({ viewport: { width: 390, height: H }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
      await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); }, save('hand-cover', venue));
      await page.goto(URL);
      await page.getByTestId('resume').click();
      await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
      await page.waitForTimeout(800);
      const m0 = await measure(page);
      const ref = Math.max(...m0.sizes);
      await check(page, `${venue} deal`, ref);
      const recheck = (l: string) => check(page, `${venue} ${l}`, ref);
      for (let round = 0; round < 4; round++) {
        await myTurn(page);
        const id = (await legal(page))[0]!;
        const p = await point(page, id);
        if (round % 2 === 0) {
          // two-tap: select (raised), check, then play
                    await page.mouse.click(p.x, p.y);
          await page.waitForTimeout(400);
          await recheck(`r${round} raised ${id}`);
          const p2 = await point(page, id);
          await page.mouse.click(p2.x, p2.y);
        } else {
          await page.mouse.move(p.x, p.y); await page.mouse.down();
          for (let i = 1; i <= 6; i++) await page.mouse.move(p.x, p.y - 60 * i);
          await page.mouse.up();
        }
        await page.waitForTimeout(700);
        await recheck(`r${round} after ${round % 2 ? 'drag' : 'tap'} ${id}`);
      }
      await page.screenshot({ path: `${SHOTS}/hand-cover-${venue}-390.png` });
      await page.close();
    }
    for (const sz of SIZES) {
      const page = await b.newPage({ viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: 2, hasTouch: true });
      await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); }, save('hand-cover'));
      await page.goto(URL);
      await page.getByTestId('resume').click();
      await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
      await page.waitForTimeout(800);
      const m = await measure(page);
      console.log(`SIZE ${sz.name} (${sz.width}x${sz.height}): span ${m.span.toFixed(1)}%, card ${m.cardPx}px, min strip ${m.minStrip}px (${m.worst})`);
      if (m.minStrip < MIN) fails.push(`size ${sz.name}: strip ${m.minStrip}px < ${MIN}`);
      if (m.span < 88 || m.span > 98) fails.push(`size ${sz.name}: span ${m.span.toFixed(1)}% outside 88-98%`);
      await page.screenshot({ path: `${SHOTS}/hand-size-${sz.name}.png` });
      await page.close();
    }
  } finally { await b.close(); }
  if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
