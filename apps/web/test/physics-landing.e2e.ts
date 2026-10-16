/**
 * Physics landing at 390px in WebKit. Tips OFF: thrown cards come to rest where the throw sends them, the same
 * on every run (seeded). Tips ON: the fixed per-seat spots. Saves resting-layout screenshots.
 */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';

const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
type Fly = Record<string, { t: number; x: number; y: number }[]>;
type W = { __bwmHandHits: HandHitCard[]; __bwmFly?: Fly; __bwmDrag?: string };

function saveFor(seed: string): string {
  const dealt = newGame(makeRules('joker'), seed, { dealer: 3 });
  const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'fast', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}

async function open(b: Browser, save: string, tips: boolean): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript(([raw, on]) => { localStorage.setItem('bwm.game', raw as string); localStorage.setItem('bwm.tips', JSON.stringify({ on, asked: true, counts: {}, skipped: false })); }, [save, tips] as const);
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(600);
  return page;
}

async function grip(page: Page): Promise<{ x: number; y: number }> {
  const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
  const legal = await page.locator('[data-testid="hand"] [data-legal="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
  for (const id of legal) {
    const h = hits.find((c) => c.id === id)!;
    const ys = h.poly.map((p) => p.y), xs = h.poly.map((p) => p.x);
    for (let fy = 0.15; fy <= 0.5; fy += 0.05) for (let fx = 0.05; fx <= 0.95; fx += 0.05) {
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * fx, y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fy;
      if (pickHandCard(x, y, hits) === id) return { x, y };
    }
  }
  throw new Error('no grip');
}

/** Throw the first legal card toward `to` (fast) and wait for the whole trick to rest. Returns resting screen spots. */
async function playTrick(page: Page, to: { x: number; y: number }, shot: string): Promise<Record<string, { x: number; y: number }>> {
  const g = await grip(page);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(g.x + ((to.x - g.x) * i) / 5, g.y + ((to.y - g.y) * i) / 5);
  await page.mouse.up();
  // Tips ON pops coach cards that hold the game; tap OK as they come.
  let dismissing = true;
  const dismiss = (async () => { while (dismissing) { const ok = page.getByRole('button', { name: 'OK', exact: true }); if (await ok.count().catch(() => 0)) await ok.first().click({ timeout: 1000 }).catch(() => {}); await page.waitForTimeout(250).catch(() => {}); } })();
  await page.waitForFunction(() => {
    const f = (window as unknown as W).__bwmFly ?? {};
    const done = Object.values(f).filter((s) => s.some((p) => p.t >= 1));
    return done.length >= 4;
  }, undefined, { timeout: 30000 }).catch(async (e) => {
    await page.screenshot({ path: shot.replace('.png', '-TIMEOUT.png') });
    console.log('fly', JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries((window as unknown as W).__bwmFly ?? {}).map(([k, v]) => [k, v.length])))), await page.evaluate(() => (window as unknown as W).__bwmDrag));
    throw e;
  });
  dismissing = false;
  await dismiss;
  await page.waitForTimeout(150);
  await page.screenshot({ path: shot });
  return page.evaluate(() => {
    const f = (window as unknown as W).__bwmFly ?? {};
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, s] of Object.entries(f)) { const firstRest = s.find((p) => p.t >= 1); if (firstRest) out[k] = { x: firstRest.x, y: firstRest.y }; }
    return out;
  });
}

const dist = (a: Record<string, { x: number; y: number }>, b: Record<string, { x: number; y: number }>) =>
  Math.max(...Object.keys(a).map((k) => (b[k] ? Math.hypot(a[k]!.x - b[k]!.x, a[k]!.y - b[k]!.y) : 999)));

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const save = saveFor('land-1');
    const flick = { x: 260, y: 300 };
    // Tips ON: fixed spots
    let p = await open(b, save, true);
    const fixed = await playTrick(p, flick, `${SHOTS}/land-tips-on-390.png`);
    await p.close();
    // Tips OFF: twice with the same seed and throw → identical
    p = await open(b, save, false);
    const a = await playTrick(p, flick, `${SHOTS}/land-tips-off-a-390.png`);
    await p.close();
    p = await open(b, save, false);
    const a2 = await playTrick(p, flick, `${SHOTS}/land-tips-off-a-repeat-390.png`);
    await p.close();
    const same = dist(a, a2), moved = dist(a, fixed);
    console.log(`tips on spots ${Object.keys(fixed).length}, tips off repeat drift ${same.toFixed(1)}px, off vs on max ${moved.toFixed(1)}px`);
    if (Object.keys(fixed).length < 4 || Object.keys(a).length < 4) throw new Error('trick did not finish');
    if (same > 1.5) throw new Error(`physics landing not deterministic (${same.toFixed(1)}px)`);
    if (moved < 3) throw new Error('Tips OFF landed exactly on the fixed spots');
    // a few more resting layouts (different seeds / throws)
    for (const [seed, to, name] of [['land-2', { x: 120, y: 320 }, 'b'], ['land-3', { x: 195, y: 260 }, 'c']] as const) {
      p = await open(b, saveFor(seed), false);
      await playTrick(p, to, `${SHOTS}/land-tips-off-${name}-390.png`);
      await p.close();
    }
    // Tips ON again with a different throw → still the fixed spots
    p = await open(b, save, true);
    const fixed2 = await playTrick(p, { x: 120, y: 320 }, `${SHOTS}/land-tips-on-other-throw-390.png`);
    await p.close();
    const fd = dist(fixed, fixed2);
    console.log(`tips on, different throw drift ${fd.toFixed(1)}px`);
    if (fd > 1.5) throw new Error('Tips ON spot moved with the throw');
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
