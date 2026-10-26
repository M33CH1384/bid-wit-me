/** Hand Recap Leave flow: leaving from the recap offers the Save & quit /
 * Leave choice, and Quit drops the save (WebKit 390). */
import { makeRules, newGame, canRunIt, type Card, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const MINE: Card[] = ['BJ', 'LJ', '2S', 'AS'];

function fixture(): string {
  const rules = makeRules('joker');
  const dealt = newGame(rules, 'review-label', { dealer: 3 });
  const all = dealt.hands.flat();
  const rest = all.filter((c) => !MINE.includes(c));
  const played = rest.slice(0, 36), others = rest.slice(36);
  const hands: Card[][] = [MINE, others.slice(0, 4), others.slice(4, 8), others.slice(8, 12)];
  const tricks = Array.from({ length: 9 }, (_, t) => ({ leader: 0, winner: 1, plays: played.slice(t * 4, t * 4 + 4).map((card, seat) => ({ seat, card })) }));
  const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], hands, tricks, tricksWon: [3, 3, 2, 1], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  if (!canRunIt(st, 0)) throw new Error('fixture cannot run');
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'normal', quality: 'low', shotOut: false, firstHandBidsItself: false }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: ['YOU + OMAR', 'BIG WHISPERERS'] });
}

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const raw = fixture();
    await p.goto(URL);
    await p.evaluate((r) => { localStorage.setItem('bwm.game', r); localStorage.setItem('bwm.runItTip.v1', JSON.stringify({ shown: 9, used: true })); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); }, raw);
    await p.reload();
    await p.getByTestId('resume').click();
    await p.getByTestId('run-it').waitFor({ timeout: 45000 });
    await p.mouse.click(195, 300);
    await p.getByTestId('run-it').click();
    const leaveBtn = p.getByTestId('recap-leave');
    await leaveBtn.waitFor({ timeout: 30000 });
    await p.screenshot({ path: `${SHOTS}/recap-leave-game-390.png` });
    await leaveBtn.click();
    await p.getByTestId('confirm-leave').waitFor({ timeout: 15000 });
    await p.getByTestId('save-quit').waitFor({ timeout: 15000 });
    console.log('leave choice shown (Save & quit + Leave)');
    // this fixture ends the game on the run, so take the Quit path: game gone, back Home
    await p.getByTestId('confirm-leave').getByRole('button', { name: 'Leave', exact: true }).click();
    await p.waitForTimeout(1200);
    const stillSaved = await p.evaluate(() => !!localStorage.getItem('bwm.game'));
    console.log('after Quit: save kept =', stillSaved);
    if (stillSaved) throw new Error('quit game kept its save');
    await p.getByText('PLAY VS BOTS').waitFor({ timeout: 15000 });
    console.log('leave-game OK');
  } finally { await b.close(); }
})();
