/** Camera view at 390px WebKit: standing slow drag slams max; sitting V-gesture slams; sitting straight slow drag gentle. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
type W = { __bwmHandHits: HandHitCard[]; __bwmSlam?: { v: number; intensity: number }; __bwmCam?: { view: string; y: number; z: number } };
const saveFor = (view: string) => JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', view }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
async function open(b: Browser, view: string): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, saveFor(view));
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(900); // camera transition settles
  return page;
}
async function grip(page: Page) {
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
  const legal = await page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
  for (const id of legal) { const h = hits.find((c) => c.id === id)!; const ys = h.poly.map((p) => p.y), xs = h.poly.map((p) => p.x);
    for (let fy = 0.15; fy <= 0.5; fy += 0.05) for (let fx = 0.05; fx <= 0.95; fx += 0.05) { const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx; const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy; if (pickHandCard(x, y, hits) === id) return { id, x, y }; } }
  throw new Error('no grip');
}
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    // Standing: slow straight drag => max slam + camera probe
    let page = await open(b, 'standing');
    let cam = await page.evaluate(() => (window as unknown as W).__bwmCam); console.log('standing cam', cam);
    let g = await grip(page);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(g.x + ((120 - g.x) * i) / 30, g.y + ((330 - g.y) * i) / 30); await page.waitForTimeout(40); }
    await page.mouse.up(); await page.waitForTimeout(300);
    let slam = await page.evaluate(() => (window as unknown as W).__bwmSlam); console.log('standing slow drag slam', slam);
    if (!slam || slam.intensity !== 1) throw new Error(`standing slow drag intensity ${slam?.intensity}`);
    await page.close();
    // Sitting: camera lower; V gesture slams; straight slow drag gentle
    page = await open(b, 'sitting');
    cam = await page.evaluate(() => (window as unknown as W).__bwmCam); console.log('sitting cam', cam);
    await page.screenshot({ path: `${SHOTS}/camera-sitting-390.png` });
    g = await grip(page);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(g.x, g.y - 12 * i); await page.waitForTimeout(30); } // up leg ~72px
    for (let i = 1; i <= 6; i++) { await page.mouse.move(g.x, g.y - 72 + 12 * i); await page.waitForTimeout(30); } // down leg
    for (let i = 1; i <= 12; i++) { await page.mouse.move(g.x + ((120 - g.x) * i) / 12, (g.y + ((330 - g.y) * i) / 12)); await page.waitForTimeout(20); }
    await page.mouse.up(); await page.waitForTimeout(300);
    slam = await page.evaluate(() => (window as unknown as W).__bwmSlam); console.log('sitting V slam', slam);
    if (!slam || slam.intensity !== 1) throw new Error(`sitting V intensity ${slam?.intensity}`);
    await page.close();
    page = await open(b, 'sitting');
    g = await grip(page);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(g.x + ((120 - g.x) * i) / 30, g.y + ((330 - g.y) * i) / 30); await page.waitForTimeout(40); }
    await page.mouse.up(); await page.waitForTimeout(300);
    slam = await page.evaluate(() => (window as unknown as W).__bwmSlam); console.log('sitting straight slow slam', slam);
    if (!slam || slam.intensity >= 0.6) throw new Error(`sitting straight intensity ${slam?.intensity}`);
    await page.close();
    // Sitting fast straight flick (no V) => gentle, never a slam
    page = await open(b, 'sitting');
    g = await grip(page);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 4; i++) { await page.mouse.move(g.x + ((120 - g.x) * i) / 4, g.y + ((330 - g.y) * i) / 4); }
    await page.mouse.up(); await page.waitForTimeout(300);
    slam = await page.evaluate(() => (window as unknown as W).__bwmSlam); console.log('sitting FAST straight slam', slam);
    if (!slam || slam.intensity !== 0) throw new Error(`sitting fast straight intensity ${slam?.intensity}`);
    await page.close();
    // Landscape (844x390) sitting: camera probe + hand visible
    const lp = await b.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
    lp.setDefaultTimeout(30000);
    await lp.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, saveFor('sitting'));
    await lp.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
    await lp.getByTestId('resume').click();
    await lp.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length >= 10, undefined, { timeout: 45000 });
    await lp.waitForTimeout(900);
    cam = await lp.evaluate(() => (window as unknown as W).__bwmCam); console.log('landscape sitting cam', cam);
    if (!cam || cam.view !== 'sitting' || cam.y >= 3.1) throw new Error(`landscape sitting cam ${JSON.stringify(cam)}`);
    await lp.screenshot({ path: `${SHOTS}/camera-sitting-landscape.png` });
    console.log('camera-view OK');
  } finally { await b.close(); }
})();
