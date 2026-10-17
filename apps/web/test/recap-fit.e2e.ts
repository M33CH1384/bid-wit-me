/** Hand Recap must fit one screenful at 390x844 and 393x852: TOP SCORES, both team
 *  sheets, Score pad, Continue and Leave game — Leave above the fold, no scrolling. */
import { makeRules, newGame, applyAction, pendingTurn, viewFor, type GameState } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5187';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const TAG = process.env.BWM_TAG ?? 'after';

function playedHand(): GameState {
  const rules = makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, 'recap-fit');
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st); if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  // normal mid-game hand recap: not decided, no sheets
  return { ...st, phase: 'handOver', result: undefined };
}
const save = () => JSON.stringify({ v: 1, savedAt: Date.now(), seed: 'recap-fit', settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: 'novice' }, state: playedHand(), chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    for (const [w, h] of [[390, 844], [393, 852]] as const) {
      const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      page.setDefaultTimeout(30000);
      await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save());
      await page.goto(URL);
      await page.getByTestId('resume').click();
      await page.getByTestId('recap-leave').waitFor({ timeout: 45000 });
      await page.waitForTimeout(600);
      const m = await page.evaluate(`(() => {
        const box = (id) => { const el = document.querySelector('[data-testid="' + id + '"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
        const body = document.querySelector('.tt-body');
        const headEl = document.querySelector('.tt-head'); const hr = headEl ? headEl.getBoundingClientRect() : null;
        return { leave: box('recap-leave'), ready: box('talk-ready'), top: box('recap-top-scores'), side0: box('recap-side-0'), side1: box('recap-side-1'), head: hr ? { top: Math.round(hr.top), bottom: Math.round(hr.bottom) } : null, bodyScroll: body ? { scrollH: body.scrollHeight, clientH: body.clientHeight } : null, vh: window.innerHeight };
      })()`);
      console.log(`recap-fit ${w}x${h}:`, JSON.stringify(m));
      if (TAG !== 'before') {
        if (!m.leave || m.leave.bottom > m.vh) throw new Error(`Leave game below fold at ${w}x${h}: ${JSON.stringify(m.leave)} vs vh ${m.vh}`);
        if (!m.ready || m.ready.bottom > m.vh) throw new Error(`Continue below fold at ${w}x${h}`);
        if (m.bodyScroll && m.bodyScroll.scrollH > m.bodyScroll.clientH + 1) throw new Error(`recap body still scrolls at ${w}x${h}: ${JSON.stringify(m.bodyScroll)}`);
      }
      await page.screenshot({ path: `${SHOTS}/recap-fit-${TAG}-${w}.png` });
      await page.close();
    }
    console.log('recap-fit OK', TAG);
  } finally { await b.close(); }
})();
