/** SPADES BROKEN chip: only when the viewer's Tips are ON. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { HandHitCard } from '../src/three/handHit';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
type W = { __bwmHandHits: HandHitCard[] };
async function open(b: Browser, tipsOn: boolean): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript(([raw, tips]) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', tips); }, [save, JSON.stringify({ on: tipsOn, asked: true, counts: {} })] as const);
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(800);
  return page;
}
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const on = await open(b, true);
    const chip = on.getByTestId('spades-broken');
    await chip.waitFor({ timeout: 15000 });
    console.log('tips ON chip:', (await chip.textContent())?.trim());
    await on.screenshot({ path: `${process.env.BWM_SHOTS ?? '/opt/cursor/artifacts'}/spades-broken-tips-on-390.png` });
    await on.close();
    const off = await open(b, false);
    const count = await off.getByTestId('spades-broken').count();
    const anyBroken = await off.locator('text=SPADES BROKEN').count();
    console.log(`tips OFF: chip=${count} anyText=${anyBroken}`);
    if (count || anyBroken) throw new Error('broken indicator visible with Tips off');
    console.log('spades-broken OK');
  } finally { await b.close(); }
})();
