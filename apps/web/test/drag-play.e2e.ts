/** Drag-to-play at 390px in WebKit: a drag onto the felt plays, a drag that ends in the hand snaps back, a tap stays a tap. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';

const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });

async function open(b: Browser): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as { __bwmHandHits?: unknown[] }).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(600);
  return page;
}

/** A point on the card's own visible strip (the drawn layout decides). */
async function grip(page: Page): Promise<{ id: string; x: number; y: number }> {
  const hits = await page.evaluate(() => (window as unknown as { __bwmHandHits: HandHitCard[] }).__bwmHandHits);
  const legal = await page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
  for (const id of legal) {
    const h = hits.find((c) => c.id === id)!;
    const ys = h.poly.map((p) => p.y), xs = h.poly.map((p) => p.x);
    for (let fy = 0.15; fy <= 0.5; fy += 0.05) for (let fx = 0.05; fx <= 0.95; fx += 0.05) {
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx;
      const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy;
      if (pickHandCard(x, y, hits) === id) return { id, x, y };
    }
  }
  throw new Error('no grip point');
}
const trickCount = (p: Page) => p.getByTestId('hand').getAttribute('data-trick-count');

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, shot?: string): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    if (shot && i === 8) await page.screenshot({ path: shot });
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
}

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    // 1) drag onto the felt plays the card
    let page = await open(b);
    let g = await grip(page);
    await drag(page, g, { x: 195, y: 360 }, `${SHOTS}/drag-midway-390.png`);
    if ((await trickCount(page)) !== '1') throw new Error(`drag did not play ${g.id}: ${await page.evaluate(() => (window as unknown as { __bwmDrag?: string }).__bwmDrag)}`);
    if (await page.getByTestId(`card-${g.id}`).count()) throw new Error('played card still in hand');
    await page.screenshot({ path: `${SHOTS}/drag-played-390.png` });
    console.log(`drag played ${g.id}`);
    await page.close();
    // 2) a drag released inside the hand snaps back
    page = await open(b);
    g = await grip(page);
    await drag(page, g, { x: g.x + 40, y: g.y + 30 });
    const d = await page.evaluate(() => (window as unknown as { __bwmDrag?: string }).__bwmDrag);
    if (d !== `snap:${g.id}` || (await trickCount(page)) !== '0' || !(await page.getByTestId(`card-${g.id}`).count())) throw new Error(`cancel failed ${d}`);
    if (await page.locator('[data-testid="drag-ghost"]').count()) await page.waitForTimeout(300);
    console.log(`drag cancelled ${g.id}`);
    await page.close();
    // 3) a tap (under 10px of movement) only selects
    page = await open(b);
    const g2 = await grip(page);
    await page.mouse.move(g2.x, g2.y);
    await page.mouse.down();
    await page.mouse.move(g2.x + 4, g2.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const other = await page.getByTestId(`card-${g2.id}`).getAttribute('aria-pressed');
    if ((await trickCount(page)) !== '0') throw new Error('tap played');
    if (other !== 'true') throw new Error(`tap did not select ${g2.id}`);
    console.log(`tap selected ${g2.id}`);
    await page.close();
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
