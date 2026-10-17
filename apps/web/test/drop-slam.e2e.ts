/** Drop flight at 390px in WebKit: a dragged card flies from the finger to its trick spot and never goes back to the hand. Slow drop vs flick. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';

const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
type W = { __bwmHandHits: HandHitCard[]; __bwmFly?: Record<string, { t: number; x: number; y: number }[]>; __bwmSlam?: { v: number; intensity: number } };

async function open(b: Browser): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(600);
  return page;
}

async function grip(page: Page): Promise<{ id: string; x: number; y: number; top: number }> {
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
  const top = Math.min(...hits.flatMap((h) => h.poly.map((p) => p.y)));
  const legal = await page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
  for (const id of legal) {
    const h = hits.find((c) => c.id === id)!;
    const ys = h.poly.map((p) => p.y), xs = h.poly.map((p) => p.x);
    for (let fy = 0.15; fy <= 0.5; fy += 0.05) for (let fx = 0.05; fx <= 0.95; fx += 0.05) {
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx;
      const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy;
      if (pickHandCard(x, y, hits) === id) return { id, x, y, top };
    }
  }
  throw new Error('no grip point');
}

/** steps × stepMs controls the release speed. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps: number, stepMs: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    if (stepMs) await page.waitForTimeout(stepMs);
  }
  await page.mouse.up();
}

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    for (const [name, steps, ms] of [['gentle', 30, 40], ['flick', 4, 0]] as const) {
      const page = await open(b);
      const g = await grip(page);
      const to = { x: 120, y: 330 };
      await dragTo(page, g, to, steps, ms);
      await page.waitForTimeout(90);
      await page.screenshot({ path: `${SHOTS}/drop-${name}-mid-390.png` });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${SHOTS}/drop-${name}-landed-390.png` });
      const { fly, slam } = await page.evaluate((id) => ({ fly: (window as unknown as W).__bwmFly?.[id] ?? [], slam: (window as unknown as W).__bwmSlam }), g.id);
      if (fly.length < 3) throw new Error(`${name}: no flight frames for ${g.id}`);
      const first = fly[0]!;
      // the lifted copy is centred 0.2 card-heights above the finger (card ≈ 96px tall here)
      const startOff = Math.hypot(first.x - to.x, first.y - (to.y - 19));
      const maxY = Math.max(...fly.map((f) => f.y));
      console.log(`${name}: ${g.id} slam v=${slam?.v.toFixed(2)} i=${slam?.intensity.toFixed(2)} frames=${fly.length} start (${first.x.toFixed(0)},${first.y.toFixed(0)}) off finger ${startOff.toFixed(0)}px, lowest y ${maxY.toFixed(0)} vs hand top ${g.top.toFixed(0)}`);
      if (startOff > 45) throw new Error(`${name}: flight did not start at the finger (${startOff.toFixed(0)}px off)`);
      if (maxY > g.top - 10) throw new Error(`${name}: card went back toward the hand (y ${maxY.toFixed(0)})`);
      for (let i = 1; i < fly.length; i++) if (fly[i]!.t < fly[i - 1]!.t) throw new Error(`${name}: flight restarted`);
      // Default save is Sitting + Turn Up OFF: even a fast flick lands gentle — release velocity
      // never creates a slam with the mode off (founder fix; velocity slam is Turn Up ON only).
      if (name === 'flick' && !(slam && slam.intensity === 0)) throw new Error('flick slammed with Turn Up OFF');
      if (name === 'gentle' && !(slam && slam.intensity < 0.2)) throw new Error('slow drop was not gentle');
      await page.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
