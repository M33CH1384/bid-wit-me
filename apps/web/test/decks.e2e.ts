/** Deck picker integration: each Desi deck renders its court art in the hand (390px screenshots per deck). */
import { makeRules, newGame, type Card, type GameState } from '@spades/rules';
import { webkit, type Browser } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { DECKS } from '../src/decks';
import type { HandHitCard } from '../src/three/handHit';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const COURTS = ['KS', 'QS', 'JS', 'KH', 'QH', 'JH', 'KD', 'QD', 'JD', 'KC', 'QC', 'JC', 'BJ'] as Card[];
type W = { __bwmHandHits: HandHitCard[]; __bwmDeck?: string };
function saveFor(deck: string): string {
  const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
  const rest = dealt.hands.flat().filter((c) => !COURTS.includes(c));
  const hands = [COURTS, rest.slice(0, 13), rest.slice(13, 26), rest.slice(26, 39)] as Card[][];
  const st: GameState = { ...dealt, hands, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', deck }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}
(async () => {
  const b: Browser = await webkit.launch({ headless: true });
  try {
    for (const d of DECKS) {
      const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      page.setDefaultTimeout(30000);
      const artReqs: string[] = [];
      page.on('request', (r) => { if (r.url().includes(`/assets/decks/${d.id}/`)) artReqs.push(r.url()); });
      await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, saveFor(d.id));
      await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
      await page.getByTestId('resume').click();
      await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
      await page.waitForTimeout(1500);
      const active = await page.evaluate(() => (window as unknown as W).__bwmDeck);
      if (active !== d.id) throw new Error(`${d.id}: active deck probe is ${active}`);
      if (!artReqs.length) throw new Error(`${d.id}: no deck art requested`);
      await page.screenshot({ path: `${SHOTS}/deck-${d.id}-390.png` });
      console.log(`${d.id} (${d.name}): ${artReqs.length} art files, screenshot saved`);
      await page.close();
    }
    console.log('decks OK');
  } finally { await b.close(); }
})();
