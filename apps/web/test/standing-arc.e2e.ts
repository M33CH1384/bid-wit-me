/** Standing max-slam flight (Turn up ON) must arc (rise then fall, never a beam) + plate View toggle at 390px. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
type W = { __bwmHandHits: HandHitCard[]; __bwmFly?: Record<string, { t: number; x: number; y: number }[]>; __bwmDrag?: string; __bwmCam?: { view: string; y: number } };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', view: 'standing', turnUp: true }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
async function open(b: Browser): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(700);
  return page;
}
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await open(b);
    // plate toggle visible under YOU plate, both views
    await page.getByTestId('view-toggle-plate').waitFor({ timeout: 15000 });
    await page.screenshot({ path: `${SHOTS}/view-standing-390.png` });
    await page.getByTestId('view-toggle-plate').click();
    await page.waitForFunction(() => (window as unknown as W).__bwmCam?.view === 'sitting', undefined, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/view-sitting-390.png` });
    await page.getByTestId('view-toggle-plate').click();
    await page.waitForFunction(() => (window as unknown as W).__bwmCam?.view === 'standing', undefined, { timeout: 15000 });
    await page.waitForTimeout(800);
    // grip a legal card and drag-play it (Standing + Turn up => max slam)
    const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
    const legal = await page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
    let g: { id: string; x: number; y: number } | null = null;
    for (const id of legal) { const h = hits.find((c) => c.id === id)!; const ys = h.poly.map((p) => p.y), xs = h.poly.map((p) => p.x);
      for (let fy = 0.15; fy <= 0.5 && !g; fy += 0.05) for (let fx = 0.05; fx <= 0.95 && !g; fx += 0.05) { const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx; const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy; if (pickHandCard(x, y, hits) === id) g = { id, x, y }; } }
    if (!g) throw new Error('no grip');
    const grip = g as { id: string; x: number; y: number };
    await page.mouse.move(grip.x, grip.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(grip.x + ((120 - grip.x) * i) / 10, grip.y + ((330 - grip.y) * i) / 10); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const fly = await page.evaluate((id) => (window as unknown as W).__bwmFly?.[id] ?? [], grip.id);
    console.log(`flight frames: ${fly.length}`);
    if (fly.length < 6) throw new Error(`only ${fly.length} flight frames`);
    const first = fly[0]!, last = fly[fly.length - 1]!;
    let maxRise = 0;
    for (const f of fly) { const lineY = first.y + (last.y - first.y) * ((f.x - first.x) / Math.max(1, last.x - first.x)); maxRise = Math.max(maxRise, lineY - f.y); }
    console.log(`max rise above start-end line: ${maxRise.toFixed(1)}px`);
    if (maxRise < 8) throw new Error(`flight did not arc (rise ${maxRise.toFixed(1)}px) — beam flight`);
    console.log('standing-arc OK');
  } finally { await b.close(); }
})();
