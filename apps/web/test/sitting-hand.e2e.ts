/** LIVE BUG: sitting camera cropped the hand. Assert all 13 hand cards + plate inside the viewport. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
type W = { __bwmHandHits: HandHitCard[]; __bwmCam?: { view: string; y: number; t?: number }; __bwmLayout?: { hand: { x: number; y: number; w: number; h: number }[] }; __bwmSafeBottom?: number };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', view: 'sitting' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
async function check(page: Page, w: number, h: number, shot: string, chrome = 84) {
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForFunction(() => ((window as unknown as W).__bwmLayout?.hand ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(1000);
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
  const cam = await page.evaluate(() => (window as unknown as W).__bwmCam);
  // LIVE camera rects (LayoutProbe projects with the actual sitting camera; __bwmHandHits used to
  // be recomputed with the standing camera, which is why this test passed while the phone failed).
  const live = await page.evaluate(() => (window as unknown as W).__bwmLayout!.hand);
  console.log(`${shot} cam`, cam, 'cards', hits.length, 'live', live.length);
  for (const r of live) {
    if (r.x < -1 || r.y < -1 || r.x + r.w > w + 1 || r.y + r.h > h - chrome + 1) throw new Error(`live hand rect ${JSON.stringify(r)} outside ${w}x${h} above chrome ${chrome} in ${shot}`);
  }
  for (const c of hits) for (const pt of c.poly) {
    if (pt.x < -1 || pt.x > w + 1 || pt.y < -1 || pt.y > h - chrome + 1) throw new Error(`${c.id} corner (${pt.x.toFixed(0)},${pt.y.toFixed(0)}) outside ${w}x${h} above chrome ${chrome} in ${shot}`);
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
  // Oct 17 beta regression: no seat plate/avatar may cover a hand card (the YOU plate sat on the fan in Sitting).
  for (const id of ['seat-0', 'seat-1', 'seat-2', 'seat-3']) {
    const pl = await page.getByTestId(id).boundingBox().catch(() => null);
    if (!pl) continue;
    for (const [i, r] of live.entries()) {
      const ox = Math.min(r.x + r.w, pl.x + pl.width) - Math.max(r.x, pl.x);
      const oy = Math.min(r.y + r.h, pl.y + pl.height) - Math.max(r.y, pl.y);
      if (ox > 6 && oy > 6) throw new Error(`${id} covers hand card ${i} by ${ox.toFixed(0)}x${oy.toFixed(0)}px in ${shot}`);
    }
  }
  await page.screenshot({ path: `${SHOTS}/${shot}` });
}
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const p1 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    p1.setDefaultTimeout(30000);
    await p1.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save); await p1.addInitScript(() => { (window as unknown as W).__bwmSafeBottom = 34; });
    await p1.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173'); await p1.getByTestId('resume').click();
    await check(p1, 390, 844, 'sitting-hand-portrait-390.png');
    // 393x852 (iPhone 14/15/16) at the same injected insets
    const p393 = await b.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
    p393.setDefaultTimeout(30000);
    await p393.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save); await p393.addInitScript(() => { (window as unknown as W).__bwmSafeBottom = 34; });
    await p393.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173'); await p393.getByTestId('resume').click();
    await check(p393, 393, 852, 'sitting-hand-portrait-393.png');
    // Toggle must ANIMATE (~0.7s), not snap: sample the live camera pose across frames.
    const y0 = (await p1.evaluate(() => (window as unknown as W).__bwmCam))!.y;
    await p1.getByTestId('view-toggle-plate').click();
    const samples = await p1.evaluate(async () => { const out: { at: number; y: number; t?: number }[] = []; const t0 = performance.now(); while (performance.now() - t0 < 1400) { const c = (window as unknown as W).__bwmCam; if (c) out.push({ at: performance.now() - t0, y: c.y, t: c.t }); await new Promise((r) => setTimeout(r, 30)); } return out; });
    const ys = samples.map((x) => x.y); const y1 = ys[ys.length - 1]!;
    const mid = ys.filter((y) => y > Math.min(y0, y1) + 0.15 && y < Math.max(y0, y1) - 0.15);
    const settle = samples.find((x) => (x.t ?? 0) >= 0.99)?.at ?? -1;
    console.log('toggle samples', { y0, y1, n: ys.length, mid: mid.length, settle });
    if (mid.length < 3) throw new Error(`toggle snapped: only ${mid.length} intermediate poses`);
    if (settle < 450 || settle > 950) throw new Error(`toggle duration ${settle}ms outside 0.5-0.9s`);
    const maxStep = Math.max(...ys.map((y, i) => (i ? Math.abs(y - ys[i - 1]!) : 0)));
    if (maxStep > Math.abs(y1 - y0) * 0.7) throw new Error(`toggle jumped ${maxStep} in one sample`);
    await p1.getByTestId('view-toggle-plate').click(); // back to sitting for the record
    const p2 = await b.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
    p2.setDefaultTimeout(30000);
    await p2.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save); await p2.addInitScript(() => { (window as unknown as W).__bwmSafeBottom = 34; });
    await p2.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173'); await p2.getByTestId('resume').click();
    await check(p2, 844, 390, 'sitting-hand-landscape.png', 34);
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
