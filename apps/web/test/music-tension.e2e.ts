/** Phase 6: tension probe follows the score (calm save vs match-point save). */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { HandHitCard } from '../src/three/handHit';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
type W = { __bwmHandHits: HandHitCard[]; __bwmTension?: { level: number } };
function saveFor(scores: [number, number]): string {
  const st: GameState = { ...dealt, scores, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}
async function level(b: Browser, scores: [number, number]): Promise<number> {
  const page: Page = await b.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, saveFor(scores));
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => (window as unknown as W).__bwmTension?.level ?? -1);
  await page.close();
  return t;
}
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const calm = await level(b, [20, 10]);
    const hot = await level(b, [495, 480]);
    console.log(`tension calm=${calm.toFixed(2)} hot=${hot.toFixed(2)}`);
    if (!(hot > calm + 0.3)) throw new Error('tension did not rise with the score');
    console.log('music-tension OK');
  } finally { await b.close(); }
})();
