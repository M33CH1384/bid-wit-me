/** Game-over sheet in LANDSCAPE (owner, 2026-10-28: "I can't see the other
 *  teams score unless I scroll" — the story outro at phone landscape showed
 *  only the #1 standings row; row #2 sat under the sheet's inner scroll).
 *
 *  Seeds a nearly-finished offline game (parseSave refuses a gameOver
 *  save, so the harness snapshots a live engine game a few plies before
 *  the end and lets the app finish it: bots auto-play, the harness clicks
 *  the human's last legal card[s] and the recap's Continue). The sheet is
 *  the same .modal.gameover the story outro uses — the story variant only
 *  swaps the action row for Score pad + To the map, a shorter stack, so
 *  the offline sheet is the worst case. It then measures the sheet at
 *  932×430 and 844×390 plus a 390×844 portrait control: both standings
 *  rows must sit fully inside the sheet's visible box at scrollTop 0.
 *
 *  Env: BWM_URL BWM_SHOTS BWM_TAG(before|after) BWM_END(target|shotout)
 *  BWM_CHROME BWM_PROXY. In "before" mode it only logs the geometry (the
 *  defect); in "after" mode it asserts the fix. */
import { makeRules, newGame, applyAction, pendingTurn, viewFor, type GameState } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { chromium } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5187';
const SHOTS = process.env.BWM_SHOTS ?? '/tmp/bwm-shots';
const TAG = process.env.BWM_TAG ?? 'after';
const END = process.env.BWM_END ?? 'target';

const cardsLeft = (st: GameState) => st.hands.reduce((n, h) => n + h.length, 0);

/** Play engine games until MY side (0) wins one with the wanted ending;
 *  return the last resumable snapshot (≤5 cards left, phase 'playing'). */
function snapshotBeforeEnd(): GameState {
  for (let s = 0; s < 300; s++) {
    let st = newGame(makeRules('joker', { targetScore: 100 }), `gameover-fit-${END}-${s}`);
    let snap: GameState | null = null;
    for (let g = 0; g < 20000 && st.phase !== 'gameOver'; g++) {
      if (st.phase === 'playing' && cardsLeft(st) <= 4 && cardsLeft(st) > 0) snap = st;
      if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
      const t = pendingTurn(st);
      if (!t) break;
      // shotout: my side plays pro, the opponents novice — novice bidders
      // get set on hand 1 often enough that shot-out endings are findable.
      // target: everyone pro, matching the in-browser replay as closely as
      // possible; the winner must also clear the target by 20+ so the last
      // trick's replay variance cannot un-end the game.
      st = applyAction(st, chooseBotAction(viewFor(st, t.seat), END === 'shotout' && t.seat % 2 === 1 ? 'novice' : 'pro')!);
    }
    if (st.phase === 'gameOver' && snap && st.result?.winners.includes(0) && st.result.endReason.toLowerCase() === END
      && (END !== 'target' || st.result.finalScores[0]! >= 120)) return snap;
  }
  throw new Error(`no side-0 ${END} win found`);
}

function save(): string {
  const st = snapshotBeforeEnd();
  return JSON.stringify({
    v: 1, savedAt: Date.now(), seed: st.seed,
    settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: END === 'shotout' ? 'novice' : 'pro' },
    state: st, chat: [], names: ['You', 'Smoke', 'Dee', 'Redd'], teamNames: null,
  });
}

(async () => {
  const raw = save();
  const b = await chromium.launch({ headless: true, executablePath: process.env.BWM_CHROME || undefined, proxy: process.env.BWM_PROXY ? { server: process.env.BWM_PROXY } : undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--disable-features=LocalNetworkAccessChecks'] });
  try {
    const sizes = (process.env.BWM_SIZES ?? '932x430,844x390,390x844').split(',').map((s) => s.split('x').map(Number) as [number, number]);
    for (const [w, h] of sizes) {
      const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(process.env.BWM_DSF ?? 2) });
      page.setDefaultTimeout(30000);
      await page.addInitScript((r) => {
        localStorage.setItem('bwm.game', r);
        localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
      }, raw);
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('resume').click({ force: true, timeout: 60000 });
      // finish the game: bots auto-play; click the human's legal card when
      // one is offered, and the decided recap's Continue (talk-ready) when
      // the hand/game parks on it, until the game-over sheet presents.
      const sheet = page.locator('.modal.gameover');
      for (let i = 0; i < 120 && !(await sheet.isVisible().catch(() => false)); i++) {
        const ready = page.getByTestId('talk-ready');
        if (await ready.isVisible().catch(() => false)) { await ready.click({ force: true }).catch(() => {}); }
        else {
          const card = page.locator('[data-testid^="card-"][data-legal="true"]').first();
          // the card buttons are hidden mirrors of the 3D hand — a real
          // mouse click lands on the canvas; dispatch the click directly
          // (the same way scripts/e2e.mjs drives them).
          if (await card.count().catch(() => 0)) await card.dispatchEvent('click').catch(() => {});
          else {
            // a diverged replay can land on a fresh hand's bid wall — bid 4.
            const bid = page.locator('.bid-grid button', { hasText: /^4$/ }).first();
            if (await bid.isVisible().catch(() => false)) await bid.click({ force: true }).catch(() => {});
          }
        }
        await page.waitForTimeout(500);
      }
      await sheet.waitFor({ timeout: 15000 });
      await page.waitForTimeout(900);
      const m = await page.evaluate(`(() => {
        const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) }; };
        const modal = document.querySelector('.modal.gameover');
        const rows = [...document.querySelectorAll('.modal.gameover .placements li')].map(rect);
        const scroll = document.querySelector('[data-testid="gameover-scroll"]');
        const actions = document.querySelector('.modal.gameover .confirm-actions');
        const banner = document.querySelector('.modal.gameover .shot-out-banner');
        return {
          vh: window.innerHeight, vw: window.innerWidth,
          modal: rect(modal), rows, banner: rect(banner), actions: rect(actions),
          scroll: scroll ? { ...rect(scroll), scrollTop: scroll.scrollTop, scrollH: scroll.scrollHeight, clientH: scroll.clientHeight } : null,
          rowsInScroll: !!document.querySelector('[data-testid="gameover-scroll"] .placements'),
        };
      })()`);
      console.log(`gameover-fit ${END} ${w}x${h}:`, JSON.stringify(m));
      // screenshots are opt-in (BWM_SHOTS set): on SwiftShader capture rigs a
      // full-surface grab can stall on the live 3D table behind the sheet —
      // the geometry above is the assertion, the PNG is for the human eye.
      if (process.env.BWM_SHOTS) await page.screenshot({ path: `${SHOTS}/gameover-fit-${TAG}-${END}-${w}x${h}.png`, animations: 'disabled', timeout: 45000 }).catch((e) => console.log('screenshot failed (geometry above stands):', String(e).split('\n')[0]));
      if (TAG !== 'before') {
        if (!m.modal) throw new Error('no game-over sheet');
        if (m.rowsInScroll) throw new Error('standings still inside the scroll region');
        if (m.rows.length < 2) throw new Error(`standings rows missing: ${m.rows.length}`);
        for (const [i, r] of m.rows.entries()) {
          if (r.top < m.modal.top - 1 || r.bottom > m.modal.bottom + 1) throw new Error(`row ${i + 1} outside the sheet: ${JSON.stringify(r)} vs modal ${JSON.stringify(m.modal)}`);
          if (r.bottom > m.vh) throw new Error(`row ${i + 1} below the viewport fold`);
        }
        if (!m.actions || m.actions.bottom > m.modal.bottom + 1) throw new Error(`actions clipped: ${JSON.stringify(m.actions)}`);
        if (m.modal.bottom > m.vh) throw new Error(`sheet overflows viewport: bottom ${m.modal.bottom} > ${m.vh}`);
      }
      await page.close();
    }
    console.log('gameover-fit OK', TAG, END);
  } finally { await b.close(); }
})();
