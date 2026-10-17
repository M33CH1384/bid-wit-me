/** Classic Studio before/after at 390 (WebKit): saves the resumed classic table. BWM_VENUE_ASSETS=off skips nothing —
 *  the "before" is shot on master behaviour via BWM_SHOTS naming only; this file just captures the current build. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const TAG = process.env.BWM_TAG ?? 'after';

function save(): string {
  const dealt = newGame(makeRules('joker'), 'classic-shot', { dealer: 3 });
  const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'high', botLevel: 'novice', venue: 'classic' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: Number(process.env.BWM_W ?? 390), height: Number(process.env.BWM_H ?? 844) }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save());
    await page.goto(URL);
    await page.getByTestId('resume').click();
    await page.waitForFunction(() => ((window as unknown as { __bwmHandHits?: unknown[] }).__bwmHandHits ?? []).length >= 10, undefined, { timeout: 45000 });
    await page.waitForTimeout(Number(process.env.BWM_WAIT ?? 2500));
    const venue = await page.evaluate(() => (window as unknown as { __bwmVenue?: { studio?: boolean; props?: boolean } }).__bwmVenue);
    console.log('venue probe:', JSON.stringify(venue));
    if (TAG !== 'before' && (!venue?.studio || !venue?.props)) throw new Error(`classic studio did not dress the table: ${JSON.stringify(venue)}`);
    await page.screenshot({ path: `${SHOTS}/classic-studio-${TAG}-390.png` });
    console.log('classic-shot OK', TAG);
  } finally { await b.close(); }
})();
