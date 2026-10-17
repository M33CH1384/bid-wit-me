import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
/** Sitting camera regression guard: the low over-the-table seated angle must keep the trick card
 * in front of you LARGE (it measured 56.8x49.9 CSS px before the rework, 70.6x59.9 after). */
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const leadCard = dealt.hands[0][0];
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 1, trick: { leader: 0, winner: null, plays: [{ seat: 0, card: leadCard }] }, spadesBroken: true, revealed: [true, true, true, true], hands: dealt.hands.map((h, i) => i === 0 ? h.filter((c) => c !== leadCard) : h) };
type W = { __bwmLayout?: { trickCards: Record<string, { x: number; y: number; w: number; h: number }> }; __bwmCam?: { view: string; y: number; z: number; x: number } };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', view: 'sitting' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
(async () => {
  const b: Browser = await webkit.launch({ headless: true });
  try {
    const page: Page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
    await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5185');
    await page.getByTestId('resume').click();
    await page.waitForFunction(() => Object.keys((window as unknown as W).__bwmLayout?.trickCards ?? {}).length >= 1, undefined, { timeout: 45000 });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => { const w = window as unknown as W; return { cam: w.__bwmCam, trick: w.__bwmLayout!.trickCards }; });
    console.log('cam', JSON.stringify(m.cam)); console.log('trickCards', JSON.stringify(m.trick));
    for (const [k, r] of Object.entries(m.trick)) console.log(`trick ${k}: w=${r.w.toFixed(1)} h=${r.h.toFixed(1)} (CSS px, viewport 390x844)`);
    const own = Object.values(m.trick)[0]!;
    if (own.h < 56 || own.w < 64) throw new Error(`sitting trick card too small: ${own.w.toFixed(1)}x${own.h.toFixed(1)} (before-rework was 56.8x49.9)`);
    await page.screenshot({ path: `${SHOTS}/${process.env.BWM_TAG ?? 'trick'}-sitting-390.png` });
    console.log('sitting-trick OK');
  } finally { await b.close(); }
})();
