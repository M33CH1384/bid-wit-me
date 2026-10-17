/** Turn up toggle at 390px: visible under the YOU plate, OFF by default, flips ON and persists. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
type W = { __bwmHandHits?: unknown[] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', view: 'standing' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
async function open(b: Browser): Promise<Page> {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  return page;
}
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await open(b);
    const toggle = page.getByTestId('turnup-toggle-plate');
    await toggle.waitFor({ timeout: 15000 });
    const offText = await toggle.innerText();
    if ((await toggle.getAttribute('aria-pressed')) !== 'false' || !/Off/i.test(offText)) throw new Error(`turn-up should start OFF, got pressed=${await toggle.getAttribute('aria-pressed')} text=${offText}`);
    await page.screenshot({ path: `${SHOTS}/turnup-off-390.png` });
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="turnup-toggle-plate"]')?.getAttribute('aria-pressed') === 'true', undefined, { timeout: 10000 });
    const onText = await page.getByTestId('turnup-toggle-plate').innerText();
    if (!/On/i.test(onText)) throw new Error(`turn-up ON label missing: ${onText}`);
    await page.screenshot({ path: `${SHOTS}/turnup-on-390.png` });
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('spades.settings.v2') ?? '{}') as { turnUp?: boolean });
    if (persisted.turnUp !== true) throw new Error(`turn-up did not persist to settings: ${JSON.stringify(persisted)}`);
    // flip back off: same single setting, both directions
    await page.getByTestId('turnup-toggle-plate').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="turnup-toggle-plate"]')?.getAttribute('aria-pressed') === 'false', undefined, { timeout: 10000 });
    const off2 = await page.evaluate(() => JSON.parse(localStorage.getItem('spades.settings.v2') ?? '{}') as { turnUp?: boolean });
    if (off2.turnUp !== false) throw new Error(`turn-up OFF did not persist: ${JSON.stringify(off2)}`);
    console.log('turn-up OK');
    await page.close();
  } finally { await b.close(); }
})();
