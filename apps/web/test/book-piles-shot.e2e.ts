/** Book piles on the rim: staged table after several completed tricks, shot at
 *  phone portrait + desktop, Sitting + Standing (BWM_VIEW / BWM_W / BWM_H). */
import { applyAction, legalPlays, makeRules, newGame, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const VIEW = (process.env.BWM_VIEW ?? 'sitting') as 'sitting' | 'standing';
const W = Number(process.env.BWM_W ?? 390), H = Number(process.env.BWM_H ?? 844);

function save(): string {
  let st: GameState = newGame(makeRules('joker'), 'book-piles-shot', { dealer: 3 });
  for (let guard = 0; guard < 800 && st.tricks.length < 5; guard++) {
    if (st.phase === 'bidding') { st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 }); continue; }
    if (st.phase !== 'playing') break;
    const seat = st.turn!;
    st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
  }
  if (st.tricks.length < 5) throw new Error(`staging failed: only ${st.tricks.length} tricks completed`);
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'high', botLevel: 'novice', venue: 'classic', view: VIEW }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save());
    await page.goto(URL);
    await page.getByTestId('resume').click();
    await page.waitForFunction(() => ((window as unknown as { __bwmHandHits?: unknown[] }).__bwmHandHits ?? []).length >= 5, undefined, { timeout: 45000 });
    await page.waitForTimeout(2500);
    const path = `${SHOTS}/book-piles-${VIEW}-${W}.png`;
    await page.screenshot({ path });
    console.log('book-piles shot OK', VIEW, W, '->', path);
  } finally { await b.close(); }
})();
