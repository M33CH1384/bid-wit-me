/** Fan slide at 390px in WebKit: a tap mid-slide lands on the intended card; reduced motion snaps. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';

const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });

async function open(b: Browser, reduce = false): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as { __bwmHandHits?: unknown[] }).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(600);
  return page;
}

/** A point on the card's own visible strip (the drawn layout decides). */
async function grip(page: Page, skip: string[] = []): Promise<{ id: string; x: number; y: number }> {
  const hits = await page.evaluate(() => (window as unknown as { __bwmHandHits: HandHitCard[] }).__bwmHandHits);
  const legal = await page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
  for (const id of legal.filter((x) => !skip.includes(x))) {
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

const clipAt = (g: { x: number; y: number }) => ({ x: Math.max(0, g.x - 80), y: Math.max(0, g.y - 90), width: 160, height: 120 });
const shotDiff = async (page: Page, a: Buffer, g: { x: number; y: number }) => { const b = await page.screenshot({ clip: clipAt(g) }); return a.equals(b) ? 0 : 1; };

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await open(b);
    const a = await grip(page);
    await page.mouse.click(a.x, a.y);
    // The hit test is the target layout already: grab the next card from the published (final) quads mid-slide.
    await page.waitForTimeout(40);
    await page.screenshot({ path: `${SHOTS}/slide-mid-390.png` });
    const t = await grip(page, [a.id]);
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${SHOTS}/slide-retarget-mid-390.png` });
    await page.waitForTimeout(400);
    const pressed = await page.getByTestId(`card-${t.id}`).getAttribute('aria-pressed');
    if (pressed !== 'true' || (await trickCount(page)) !== '0') throw new Error(`mid-slide tap missed ${t.id}`);
    await page.screenshot({ path: `${SHOTS}/slide-settled-390.png` });
    console.log(`mid-slide tap selected ${t.id}`);
    await page.close();
    // reduced motion: the fan is already final right after the tap; normal motion is still sliding
    for (const reduce of [true, false]) {
      const p = await open(b, reduce);
      const g = await grip(p);
      await p.mouse.click(g.x, g.y);
      await p.waitForTimeout(400);
      const dur = await p.evaluate(() => (window as unknown as { __bwmSpreadS?: number }).__bwmSpreadS);
      const mq = await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      console.log(reduce ? 'reduced' : 'normal', 'matchMedia', mq, 'spread tween s', dur);
      if (reduce && dur !== 0) throw new Error('reduced motion did not snap');
      if (!reduce && !(typeof dur === 'number' && dur >= 0.15 && dur <= 0.2)) throw new Error('normal motion did not slide 150-200ms');
      await p.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
