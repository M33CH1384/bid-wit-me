/**
 * E2E geometry: the OFFLINE game-over sheet (.modal.gameover) in LANDSCAPE.
 *
 * Defect (owner report on the story outro + the victory-placement probe,
 * 2026-10-28): in landscape the sheet's inner .scroll region measured
 * ~0px tall — the final standings lived behind an invisible sliver-scroll
 * and the stacked action column spilled past the sheet's bottom edge.
 * Portrait was fine.
 *
 * This drives REAL decided games (partnership AND cutthroat) to the
 * sheet and asserts, at scroll position 0: every standings row fully
 * inside the sheet and the viewport, the standings NOT inside the
 * scroll region, the actions fully inside the sheet, and the scroll
 * region honestly sized (clientHeight ≥ 100 — it was 0). The sibling
 * sharing the sheet's .scroll contract — the Score pad opened from the
 * sheet — is measured at the same size. Portrait is the control.
 *
 * A seeded game cannot be saved AT gameOver (parseSave refuses it), so
 * this snapshots a live engine game ≤5 cards before its end and lets
 * the app finish it in the browser.
 *
 * Run (dev server up + a proxy that maps a public-looking host to it —
 * headless Chromium blocks plain 127.0.0.1 in this environment):
 *   BWM_URL=http://bwm.cap BWM_PROXY=http://127.0.0.1:5321 \
 *   BWM_CHROME=/opt/meta-chromium/chrome BWM_SHOTS=/tmp/shots \
 *   pnpm exec tsx apps/web/test/gameover-scroll-fit.e2e.ts
 * BWM_TAG=before only logs (for the pre-fix baseline); BWM_MODES=joker
 * or cutthroat narrows the run.
 */
import { makeRules, newGame, applyAction, pendingTurn, viewFor, type GameState, type Mode } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { chromium } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL_ = process.env.BWM_URL ?? 'http://127.0.0.1:5187';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const TAG = process.env.BWM_TAG ?? 'after';
const CHROME = process.env.BWM_CHROME;
const ONLY = process.env.BWM_MODES;

function snapshotBeforeEnd(mode: Mode): GameState {
  const rules = makeRules(mode, { targetScore: 100 });
  for (let s = 0; s < 600; s++) {
    let st = newGame(rules, `gameover-scroll-${mode}-${s}`);
    let snap: GameState | null = null;
    for (let g = 0; g < 20000 && st.phase !== 'gameOver'; g++) {
      if (st.phase === 'playing') {
        const left = st.hands[0]!.length;
        if (left <= 5 && left > 0) snap = st;
      }
      if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
      const t = pendingTurn(st);
      if (!t) break;
      st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
    }
    if (st.phase === 'gameOver' && snap && st.result) {
      if (mode === 'joker' && !(st.result.winners.includes(0) && st.result.endReason === 'target')) continue;
      if (mode === 'cutthroat' && st.result.placements.length !== 4) continue;
      return snap;
    }
  }
  throw new Error(`no decided ${mode} game found`);
}

const NAMES: Record<string, string[]> = {
  joker: ['You', 'Ana', 'Sven', 'Yesenia'],
  cutthroat: ['You', 'Smoke', 'Dee', 'Redd'],
};
const saveCache = new Map<Mode, string>();
const save = (mode: Mode) => {
  const hit = saveCache.get(mode);
  if (hit) return hit;
  const raw = JSON.stringify({
    v: 1, savedAt: Date.now(), seed: `gameover-scroll-${mode}`,
    settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: 'novice' },
    state: snapshotBeforeEnd(mode), chat: [], names: NAMES[mode], teamNames: null,
  });
  saveCache.set(mode, raw);
  return raw;
};

const MEASURE = `(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), right: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) }; };
  const vw = window.innerWidth, vh = window.innerHeight;
  const modal = document.querySelector('.modal.gameover');
  if (!modal) return { modal: null, vw, vh };
  const mr = R(modal);
  const inside = (r) => r.top >= mr.top - 1 && r.bottom <= mr.bottom + 1 && r.top >= -1 && r.bottom <= vh + 1 && r.left >= -1 && r.right <= vw + 1;
  const scroll = document.querySelector('[data-testid="gameover-scroll"]');
  const rows = [...document.querySelectorAll('.modal.gameover .placements li')].map((el) => { const r = R(el); return { ...r, inside: inside(r) }; });
  const actions = document.querySelector('.modal.gameover .confirm-actions');
  const ar = actions ? R(actions) : null;
  return {
    modal: { ...mr, inside: mr.top >= -1 && mr.bottom <= vh + 1 && mr.left >= -1 && mr.right <= vw + 1 },
    rows, rowsInScroll: !!document.querySelector('[data-testid="gameover-scroll"] .placements'),
    scroll: scroll ? { clientH: scroll.clientHeight, scrollH: scroll.scrollHeight } : null,
    actions: ar ? { ...ar, inside: inside(ar) } : null,
    vw, vh,
  };
})()`;

/* One in-page driver tick: returns 'sheet' when the game-over sheet is
   up; otherwise clicks whatever the flow is waiting on (resume is
   handled by the caller). DOM clicks are used because synthetic CDP
   input stalls behind the software-GL renderer on a loaded box — this
   is a geometry test, not an input-fidelity test. */
const TICK = `(() => {
  const shown = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  if (shown(document.querySelector('.modal.gameover'))) return 'sheet';
  const ready = document.querySelector('[data-testid="talk-ready"]');
  if (shown(ready) && !ready.disabled) { ready.click(); return 'ready'; }
  const victory = document.querySelector('.victory-screen');
  if (shown(victory)) { (victory.querySelector('button') ?? victory).click(); return 'victory'; }
  const card = document.querySelector('[data-testid="hand"] button[data-legal="true"]:not([disabled])');
  if (card) {
    // tap-to-select arms on pointerup (Table.tsx); the NEXT tap plays.
    // A bare .click() fires no pointer events and would re-select forever.
    const r = card.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true };
    card.dispatchEvent(new PointerEvent('pointerdown', opts));
    card.dispatchEvent(new PointerEvent('pointerup', opts));
    card.click();
    return 'card';
  }
  return 'wait';
})()`;

async function playOut(page: import('playwright-core').Page) {
  // a cold dev server can take a while to transform the app graph
  await page.getByTestId('resume').waitFor({ timeout: 90000 });
  await page.evaluate(`document.querySelector('[data-testid="resume"]')?.click()`);
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(500);
    const did = await page.evaluate(TICK).catch(() => 'wait');
    if (did === 'sheet') return;
  }
  throw new Error('game-over sheet never appeared');
}

function assertFits(m: any, label: string, expectRows: number, isLandscape: boolean) {
  console.log(`gameover-scroll-fit ${label}:`, JSON.stringify(m));
  if (TAG === 'before') return;
  if (!m.modal) throw new Error(`${label}: no game-over modal`);
  if (!m.modal.inside) throw new Error(`${label}: sheet escapes the viewport ${JSON.stringify(m.modal)}`);
  if (m.rowsInScroll) throw new Error(`${label}: standings are inside the scroll region`);
  if (m.rows.length !== expectRows) throw new Error(`${label}: expected ${expectRows} standings rows, got ${m.rows.length}`);
  for (const [i, r] of m.rows.entries()) if (!r.inside) throw new Error(`${label}: standings row ${i} not fully visible ${JSON.stringify(r)}`);
  if (!m.actions?.inside) throw new Error(`${label}: actions not fully inside the sheet ${JSON.stringify(m.actions)}`);
  if (!m.scroll || m.scroll.clientH < 100) throw new Error(`${label}: scroll region is a sliver (${m.scroll?.clientH}px)`);
  if (isLandscape && m.scroll.clientH < 130) throw new Error(`${label}: landscape scroll window too short (${m.scroll.clientH}px)`);
}

(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--disable-features=LocalNetworkAccessChecks'],
    env,
  });
  try {
    const runs: { mode: Mode; w: number; h: number; rows: number }[] = [
      { mode: 'joker', w: 932, h: 430, rows: 2 },
      { mode: 'joker', w: 844, h: 390, rows: 2 },
      { mode: 'joker', w: 390, h: 844, rows: 2 },
      { mode: 'cutthroat', w: 932, h: 430, rows: 4 },
      { mode: 'cutthroat', w: 844, h: 390, rows: 4 },
    ];
    for (const run of runs) {
      if (ONLY && !ONLY.split(',').includes(run.mode)) continue;
      const label = `${run.mode}-${run.w}x${run.h}`;
      // one retry per size: the software-GL renderer can crash under
      // memory pressure on a loaded box; the seed is deterministic
      for (let attempt = 0; ; attempt++) {
        try { await runOne(browser, run, label); break; }
        catch (e) {
          const transient = (e as { name?: string })?.name === 'TimeoutError' || /crashed|Target closed/i.test(String(e));
          if (attempt < 2 && transient) { console.log(`${label}: transient failure, retrying (${String(e).slice(0, 80)})`); continue; }
          throw e;
        }
      }
    }
    console.log('gameover-scroll-fit OK', TAG);
  } finally { await browser.close(); }
})();

async function runOne(browser: import('playwright-core').Browser, run: { mode: Mode; w: number; h: number; rows: number }, label: string) {
      const ctx = await browser.newContext({
        viewport: { width: run.w, height: run.h }, deviceScaleFactor: Number(process.env.BWM_DSF ?? 2), isMobile: true, hasTouch: true, reducedMotion: 'reduce',
        ...(process.env.BWM_PROXY ? { proxy: { server: process.env.BWM_PROXY } } : {}),
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(30000);
      await page.addInitScript((raw: string) => {
        localStorage.setItem('bwm.game', raw);
        localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
      }, save(run.mode));
      await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await playOut(page);
      await page.waitForTimeout(900); // presented-gate confetti fires with the sheet
      const m = await page.evaluate(MEASURE);
      assertFits(m, label, run.rows, run.h < run.w);
      await page.screenshot({ path: `${SHOTS}/gameover-scroll-${TAG}-${label}.png` });

      // Sibling sharing the sheet pattern: the Score pad opened from it.
      if (run.mode === 'joker' && run.w === 844) {
        await page.evaluate(`document.querySelector('.modal.gameover .confirm-actions .quiet-row-btn')?.click()`);
        await page.waitForSelector('.modal.score-pad', { timeout: 10000 });
        await page.waitForTimeout(400);
        const pad = await page.evaluate(`(() => {
          const pad = document.querySelector('.modal.score-pad'); if (!pad) return null;
          const r = pad.getBoundingClientRect();
          const hands = document.querySelector('.modal.score-pad .pad-hands');
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), handsClientH: hands ? hands.clientHeight : null, vw: window.innerWidth, vh: window.innerHeight };
        })()`);
        console.log(`gameover-scroll-fit ${label} scorepad-sibling:`, JSON.stringify(pad));
        if (TAG !== 'before') {
          if (!pad || pad.top < -1 || pad.bottom > pad.vh + 1) throw new Error(`score pad escapes the viewport: ${JSON.stringify(pad)}`);
          if (pad.handsClientH !== null && pad.handsClientH < 100) throw new Error(`score pad hands region is a sliver: ${pad.handsClientH}px`);
        }
        await page.screenshot({ path: `${SHOTS}/gameover-scroll-${TAG}-${label}-scorepad.png` });
      }
      await ctx.close();
}
