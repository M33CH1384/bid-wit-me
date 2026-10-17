/**
 * Deal time at 390px. A fresh game starts with an empty hand, your cards fly in face down
 * from the deck, and nobody acts (YOUR TURN, timer, bot lead) until the deal settles.
 * Hand 2 deals the same way with nothing left over from hand 1. A resumed hand shows at once.
 */
import { applyAction, makeRules, newGame, pendingTurn, viewFor, type GameState } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { webkit, chromium, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const IPHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};
type Deal = { handNo: number; held: boolean; dealing: boolean; hand: number; flying: number; hits: number };
type Sample = { t: number; deal: Deal | null; dealing: string | null; myTurn: string | null; trick: string | null; dom: number };

function wrap(st: GameState, speed = 'normal'): string {
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed, quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sunny'], teamNames: null });
}
function midHand(): string {
  let st = newGame(makeRules('joker'), 'deal-resume', { dealer: 3 });
  for (let i = 0; i < 400 && st.phase !== 'playing'; i++) { const t = pendingTurn(st)!; st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'novice')!); }
  return wrap(st);
}
function handOver(): string {
  let st = newGame(makeRules('joker'), 'deal-hand2', { dealer: 3 });
  for (let i = 0; i < 400 && st.phase !== 'handOver'; i++) { const t = pendingTurn(st)!; st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'novice')!); }
  if (st.phase !== 'handOver') throw new Error(`could not finish hand 1 (${st.phase})`);
  return wrap(st);
}

async function sample(page: Page, t0: number): Promise<Sample> {
  const s = await page.evaluate(() => {
    const el = document.querySelector('.table-screen');
    return {
      deal: (window as unknown as { __bwmDeal?: Deal }).__bwmDeal ?? null,
      dealing: el?.getAttribute('data-dealing') ?? null,
      myTurn: el?.getAttribute('data-my-turn') ?? null,
      trick: document.querySelector('[data-testid="hand"]')?.getAttribute('data-trick-count') ?? null,
      dom: document.querySelectorAll('[data-testid^="card-"]').length,
    };
  });
  return { t: Date.now() - t0, ...s };
}

/** Records the whole deal of `handNo`, with a mid-flight and a settled screenshot. */
async function watchDeal(page: Page, handNo: number, shot: string): Promise<Sample[]> {
  const t0 = Date.now();
  const out: Sample[] = [];
  let sawDeal = 0;
  let midShot = false;
  while (Date.now() - t0 < 60000) {
    const s = await sample(page, t0);
    out.push(s);
    if (s.deal?.handNo === handNo && s.dealing === 'yes' && !s.deal.held) {
      if (!sawDeal) sawDeal = Date.now();
      if (!midShot && Date.now() - sawDeal > 1300) { midShot = true; await page.screenshot({ path: `${SHOTS}/${shot}-midflight-390.png` }); }
    }
    if (sawDeal && s.dealing === 'no' && s.deal?.hits === 13) break;
    await page.waitForTimeout(40);
  }
  if (!sawDeal) throw new Error(`hand ${handNo}: never saw the deal`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${shot}-settled-390.png` });
  out.push(await sample(page, t0));
  const during = out.filter((s) => s.dealing === 'yes' && s.deal?.handNo === handNo);
  const bad = during.find((s) => s.myTurn === 'yes' || (s.deal?.hits ?? 0) > 0 || (s.trick ?? '0') !== '0');
  if (bad) throw new Error(`hand ${handNo}: acted during the deal ${JSON.stringify(bad)}`);
  if (!during.some((s) => s.deal!.flying === 13)) throw new Error(`hand ${handNo}: cards did not fly in ${JSON.stringify(during[0])}`);
  const held = out.filter((s) => s.deal?.handNo === handNo && s.deal.held);
  if (held.some((s) => s.deal!.hand !== 0)) throw new Error(`hand ${handNo}: hand drawn before the deal`);
  const end = out[out.length - 1]!;
  if (end.deal?.hits !== 13 || end.deal.flying !== 0) throw new Error(`hand ${handNo}: settled ${JSON.stringify(end)}`);
  const dealt = await page.evaluate((h) => (window as unknown as { __bwmDealt?: Record<number, string[]> }).__bwmDealt?.[h] ?? [], handNo);
  const opp = dealt.filter((k) => /-b\d-/.test(k)).length;
  const prev = dealt.filter((k) => !k.startsWith(`${handNo}-`)).length;
  if (opp !== 39 || prev) throw new Error(`hand ${handNo}: dealt keys opp=${opp} stale=${prev}`);
  console.log(`hand ${handNo} ok: ${during.length} deal samples, settled hits ${end.deal.hits}, dom ${end.dom}`);
  return out;
}

async function prep(browser: Browser, save: string | null): Promise<Page> {
  const page = await browser.newPage(IPHONE);
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      if (raw) localStorage.setItem('bwm.game', raw);
    }
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
    localStorage.setItem('bwm.runItTip.v1', JSON.stringify({ shown: 9, used: true }));
  }, save);
  return page;
}

async function run(browser: Browser, base: string): Promise<void> {
  // 1) fresh game, hand 1
  {
    const page = await prep(browser, null);
    await page.goto(base);
    await page.getByTestId('play').click();
    await page.getByTestId('door-team').click();
    const mode = page.locator('[data-testid^="mode-"]').first();
    await mode.click();
    await page.getByTestId('play-bots').click();
    if (await mode.isVisible().catch(() => false)) await mode.click();
    await page.getByTestId('start-bots').click();
    await watchDeal(page, 1, 'deal-fresh');
    await page.close();
  }
  // 2) resumed mid-hand: the hand is on screen at once, no deal
  {
    const page = await prep(browser, midHand());
    await page.goto(base);
    await page.getByTestId('resume').click();
    const t0 = Date.now();
    await page.waitForFunction(() => ((window as unknown as { __bwmDeal?: Deal }).__bwmDeal?.hits ?? 0) > 0, undefined, { timeout: 45000 });
    const s = await sample(page, t0);
    if (s.deal!.flying !== 0 || s.dealing !== 'no') throw new Error(`resume dealt again ${JSON.stringify(s)}`);
    console.log(`resume ok: hand ${s.deal!.hits} cards in ${s.t}ms`);
    await page.close();
  }
  // 3) hand 2 deals like hand 1, nothing stale
  {
    const page = await prep(browser, handOver());
    await page.goto(base);
    await page.getByTestId('resume').click();
    await page.getByTestId('talk-ready').click();
    await watchDeal(page, 2, 'deal-hand2');
    await page.close();
  }
}

async function main(): Promise<void> {
  const base = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
  const browser = process.env.BWM_BROWSER === 'chromium' ? await chromium.launch({ headless: true }) : await webkit.launch({ headless: true });
  try { console.log('browser', browser.browserType().name()); await run(browser, base); } finally { await browser.close(); }
}
main().catch((err) => { console.error(err); process.exit(1); });
