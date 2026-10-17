/** Refresh at the table returns to the game at the exact state; refresh on setup stays on setup; a fresh tab shows Home + Resume; Deal me in asks first. */
import { webkit, type Page } from 'playwright-core';
type Snap = { hand: string[]; scores: unknown; trick: unknown; turn: unknown; handNo: number };
const snapSave = (page: Page) => page.evaluate(() => { const g = JSON.parse(localStorage.getItem('bwm.game') ?? 'null'); return g && { hand: [...g.state.hands[0]].sort(), scores: g.state.scores, trick: g.state.trick.plays, turn: g.state.turn, handNo: g.state.handNo }; }) as Promise<Snap | null>;
(async () => {
  const base = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
  const shots = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
  const browser = await webkit.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await ctx.addInitScript(() => { if (!localStorage.getItem('e2e.seeded')) { localStorage.clear(); localStorage.setItem('e2e.seeded', '1'); } localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); });
  try {
    await page.goto(base);
    await page.getByTestId('play-bots').click();
    const mode = page.locator('[data-testid^="mode-"]').first();
    if (await mode.isVisible().catch(() => false)) await mode.click();
    await page.getByTestId('start-bots').click();
    // let the deal land and the bots play a bit
    await page.waitForFunction(() => document.querySelector('.table-screen')?.getAttribute('data-dealing') === 'no', undefined, { timeout: 45000 }).catch(() => undefined);
    await page.waitForTimeout(5000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    const before = await snapSave(page);
    if (!before) throw new Error('no save while playing');
    // 1) refresh at the table: straight back into the game, same state
    await page.reload();
    await page.waitForSelector('[data-testid="hand"] [data-testid^="card-"]', { timeout: 45000 });
    if (await page.getByTestId('start-bots').isVisible().catch(() => false)) throw new Error('reload landed on bot setup');
    const dom = (await page.locator('[data-testid="hand"] [data-testid^="card-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)))).sort();
    if (JSON.stringify(dom) !== JSON.stringify(before.hand)) throw new Error(`resumed hand ${dom} vs ${before.hand}`);
    const after = await snapSave(page);
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`state changed on reload ${JSON.stringify(after)} vs ${JSON.stringify(before)}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/reload-in-game-390.png` });
    console.log(`refresh resumed hand ${before.handNo}: ${dom.length} cards, turn ${before.turn}`);
    // 2) a fresh open (new tab, no in-game marker) shows Home with Resume
    const tab = await ctx.newPage();
    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.goto(base);
    await tab.getByTestId('resume').waitFor({ state: 'visible' });
    await tab.screenshot({ path: `${shots}/fresh-open-home-resume-390.png` });
    // 3) refresh on bot setup stays on setup
    await tab.getByTestId('play-bots').click();
    const m2 = tab.locator('[data-testid^="mode-"]').first();
    if (await m2.isVisible().catch(() => false)) await m2.click();
    await tab.getByTestId('start-bots').waitFor({ state: 'visible' });
    await tab.reload();
    await tab.getByTestId('start-bots').waitFor({ state: 'visible' });
    await tab.screenshot({ path: `${shots}/reload-on-setup-390.png` });
    console.log('refresh on setup stayed on setup');
    // 4) Deal me in asks first; cancelling keeps the save
    tab.once('dialog', (d) => void d.dismiss());
    await tab.getByTestId('start-bots').click();
    await tab.waitForTimeout(800);
    if (await tab.locator('.table-screen').count()) throw new Error('Deal me in replaced the game without asking');
    if (JSON.stringify(await snapSave(tab)) !== JSON.stringify(before)) throw new Error('cancelled Deal me in changed the save');
    console.log('ok');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
