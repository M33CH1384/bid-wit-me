/** Refresh mid bot game: Home with Resume (never the bot setup), and Resume restores the exact state. */
import { webkit, type Page } from 'playwright-core';
type Snap = { hand: string[]; scores: unknown; trick: unknown; turn: unknown; handNo: number };
const snapSave = (page: Page) => page.evaluate(() => { const g = JSON.parse(localStorage.getItem('bwm.game') ?? 'null'); return g && { hand: [...g.state.hands[0]].sort(), scores: g.state.scores, trick: g.state.trick.plays, turn: g.state.turn, handNo: g.state.handNo }; }) as Promise<Snap | null>;
(async () => {
  const base = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.clear(); } localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); });
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
    await page.reload();
    await page.getByTestId('resume').waitFor({ state: 'visible' });
    if (await page.getByTestId('start-bots').isVisible().catch(() => false)) throw new Error('reload landed on bot setup');
    const kept = await snapSave(page);
    if (JSON.stringify(kept) !== JSON.stringify(before)) throw new Error(`save changed on reload ${JSON.stringify(kept)} vs ${JSON.stringify(before)}`);
    await page.screenshot({ path: `${process.env.BWM_SHOTS ?? '/opt/cursor/artifacts'}/reload-home-resume-390.png` });
    // Deal me in must ask first; cancelling keeps the save
    await page.getByTestId('play-bots').click();
    if (await mode.isVisible().catch(() => false)) await mode.click();
    page.once('dialog', (d) => void d.dismiss());
    await page.getByTestId('start-bots').click();
    await page.waitForTimeout(800);
    if (await page.locator('.table-screen').count()) throw new Error('Deal me in replaced the game without asking');
    if (JSON.stringify(await snapSave(page)) !== JSON.stringify(before)) throw new Error('cancelled Deal me in changed the save');
    await page.goto(base);
    await page.getByTestId('resume').click();
    await page.waitForSelector('[data-testid="hand"]');
    const dom = (await page.locator('[data-testid="hand"] [data-testid^="card-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)))).sort();
    if (JSON.stringify(dom) !== JSON.stringify(before.hand)) throw new Error(`resumed hand ${dom} vs ${before.hand}`);
    console.log(`ok: resumed hand ${before.handNo} with ${dom.length} cards, trick ${JSON.stringify(before.trick)}, turn ${before.turn}`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
