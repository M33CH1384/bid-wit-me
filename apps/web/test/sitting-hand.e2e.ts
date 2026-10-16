/** LIVE BUG: sitting camera cropped the hand. Assert all 13 hand cards + plate inside the viewport. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
type W = { __bwmHandHits: HandHitCard[]; __bwmCam?: { view: string; y: number } };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', view: 'sitting' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
async function check(page: Page, w: number, h: number, shot: string) {
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(1000);
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
  const cam = await page.evaluate(() => (window as unknown as W).__bwmCam);
  console.log(`${shot} cam`, cam, 'cards', hits.length);
  for (const c of hits) for (const pt of c.poly) {
    if (pt.x < -1 || pt.x > w + 1 || pt.y < -1 || pt.y > h + 1) throw new Error(`${c.id} corner (${pt.x.toFixed(0)},${pt.y.toFixed(0)}) outside ${w}x${h} in ${shot}`);
  }
  // visible strip per card: widest run of x on a scan row where that card is the top hit (hand-cover method)
  let minStrip = Infinity;
  for (const c of hits) {
    const xs = c.poly.map((pt) => pt.x), ys = c.poly.map((pt) => pt.y);
    let best = 0;
    for (let fy = 0.08; fy <= 0.5; fy += 0.06) {
      const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy;
      let run = 0;
      for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
        if (x < 0 || x > w) { run = 0; continue; }
        if (pickHandCard(x, y, hits) === c.id) { run++; best = Math.max(best, run); } else run = 0;
      }
    }
    minStrip = Math.min(minStrip, best);
  }
  console.log(`${shot} min strip ${minStrip.toFixed(1)}px`);
  if (minStrip < 20) throw new Error(`min strip ${minStrip.toFixed(1)}px too small`);
  const plate = await page.getByTestId('seat-0').boundingBox();
  if (!plate || plate.y < 0 || plate.y + plate.height > h) throw new Error(`YOU plate not fully visible: ${JSON.stringify(plate)}`);
  await page.screenshot({ path: `${SHOTS}/${shot}` });
}
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const p1 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    p1.setDefaultTimeout(30000);
    await p1.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
    await p1.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173'); await p1.getByTestId('resume').click();
    await check(p1, 390, 844, 'sitting-hand-portrait-390.png');
    const p2 = await b.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
    p2.setDefaultTimeout(30000);
    await p2.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
    await p2.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173'); await p2.getByTestId('resume').click();
    await check(p2, 844, 390, 'sitting-hand-landscape.png');
    // side-by-side: standing for contrast
    const p3 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    p3.setDefaultTimeout(30000);
    await p3.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save.replace('"sitting"', '"standing"'));
    await p3.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173'); await p3.getByTestId('resume').click();
    await p3.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
    await p3.waitForTimeout(1000);
    await p3.screenshot({ path: `${SHOTS}/standing-portrait-390.png` });
    console.log('sitting-hand OK');
  } finally { await b.close(); }
})();
