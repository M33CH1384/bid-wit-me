/** Phase 4: loading screen names the unified room, stays >=3.0s, ambience bed starts before dismiss. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { HandHitCard } from '../src/three/handHit';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
type W = { __bwmHandHits: HandHitCard[]; __bwmLoading?: { shownAt: number; goneAt?: number; room?: string | null }; __bwmRoom?: { name: string; venue: string; bed: string; reverb?: string }; __bwmRoomPlaying?: { bed: string; at: number } };
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
    await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
    await page.getByTestId('resume').click();
    const roomEl = page.getByTestId('loading-room');
    await roomEl.waitFor({ timeout: 20000 });
    const roomText = (await roomEl.textContent())?.trim();
    console.log('loading room:', roomText);
    if (!roomText) throw new Error('loading screen shows no room name');
    await page.screenshot({ path: `${SHOTS}/loading-room-390.png` });
    await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
    await page.waitForFunction(() => !!(window as unknown as W).__bwmLoading?.goneAt, undefined, { timeout: 45000 });
    const L = await page.evaluate(() => (window as unknown as W).__bwmLoading!);
    const room = await page.evaluate(() => (window as unknown as W).__bwmRoom);
    const dur = (L.goneAt! - L.shownAt) / 1000;
    console.log(`loading shown ${dur.toFixed(2)}s, room probe:`, room);
    if (dur < 2.85) throw new Error(`loading screen only ${dur.toFixed(2)}s (< 3.0s minimum)`);
    if (!room?.name) throw new Error('no __bwmRoom probe');
    if (roomText !== room.name) throw new Error(`loading name '${roomText}' != room '${room.name}' (seen/heard/named must unify)`);
    const playing = await page.evaluate(() => (window as unknown as W).__bwmRoomPlaying);
    console.log('ambience bed probe:', playing, 'goneAt', L.goneAt);
    if (!playing || playing.bed !== room.bed) throw new Error(`room ambience bed did not start (probe ${JSON.stringify(playing)})`);
    if (playing.at > L.goneAt!) throw new Error('ambience started only after the loading screen lifted (must fade in under it)');
    console.log('spatial4 OK');
  } finally { await b.close(); }
})();
