/** White sheet roll-down at 390px WebKit + desktop Chromium viewport: the sheet must unfurl
 * DOWN from its own scorecard's top edge (top anchored, height growing), never slide from
 * the top of the screen. Screenshots: sheet-roll-{before,mid,after} in BWM_SHOTS. */
import { makeRules, newGame, applyAction, pendingTurn, viewFor, type GameState } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { webkit, chromium, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';

function playedHand(): GameState {
  const rules = makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, 'sheet-roll');
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st); if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}
function stamped(): GameState {
  const st = playedHand();
  const last = st.history.at(-1)!;
  const mk = (handNo: number, shotSides: number[]) => ({
    ...last, handNo,
    bids: last.bids.map(() => 4),
    sides: last.sides.map((s) => ({ ...s, contract: 4, contractMade: shotSides.includes(s.side) ? (false as const) : (true as const), contractTricks: shotSides.includes(s.side) ? 1 : 4 })),
  });
  // Shot on hands 2 and 3 in a row -> side 1 is OUT on hand 3; its sheet covers the scorecard.
  const history = [mk(1, []), mk(2, [1]), mk(3, [1])].map((h) => ({ ...h, sides: h.sides.map((s) => ({ ...s, totalScore: s.side === 0 ? 200 : 90 })) }));
  return { ...st, history, handNo: 3, phase: 'handOver', scores: [200, 90], result: undefined };
}
const save = () => JSON.stringify({ v: 1, savedAt: Date.now(), seed: 'sheet-roll', settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: stamped(), chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });

async function open(b: Browser, width: number, height: number, tag: string): Promise<Page> {
  const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save());
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5186');
  await page.getByTestId('resume').click();
  try {
    await page.waitForSelector('[data-testid="recap-shroud-1"]', { state: 'attached', timeout: 45000 });
  } catch (e) {
    console.log('debug testids:', await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((x) => x.getAttribute('data-testid')).join(',')));
    await page.screenshot({ path: `${SHOTS}/sheet-dbg2.png` });
    throw e;
  }
  return page;
}
type Box = { top: number; height: number; cardTop: number };
async function sample(page: Page, ms: number): Promise<Box[]> {
  return page.evaluate(async (dur) => {
    const out: { top: number; height: number; cardTop: number }[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < dur) {
      const el = document.querySelector('[data-testid="recap-shroud-1"]');
      const card = document.querySelector('[data-testid="recap-side-1"]');
      if (el && card) { const r = el.getBoundingClientRect(); const cr = card.getBoundingClientRect(); out.push({ top: r.top, height: r.height, cardTop: cr.top }); }
      await new Promise((r) => setTimeout(r, 60));
    }
    return out;
  }, ms);
}
function checkRoll(boxes: Box[], tag: string) {
  if (boxes.length < 8) throw new Error(`${tag}: too few samples ${boxes.length}`);
  const hs = boxes.map((b) => b.height);
  const grown = Math.max(...hs) - Math.min(...hs);
  const tops = boxes.map((b) => b.top - b.cardTop);
  const topDrift = Math.max(...tops) - Math.min(...tops);
  console.log(`${tag}: heights ${hs.map((h) => h.toFixed(0)).join('->')} topOffset drift ${topDrift.toFixed(1)}px`);
  if (grown < 60) throw new Error(`${tag}: sheet did not unfurl downward (height growth ${grown.toFixed(0)}px)`);
  if (topDrift > 6) throw new Error(`${tag}: sheet top not anchored to its scorecard (drift ${topDrift.toFixed(1)}px)`);
}
(async () => {
  const wk = await webkit.launch({ headless: true });
  try {
    const page = await open(wk, 390, 844, '390');
    const style = await page.evaluate(() => { const el = document.querySelector('[data-testid="recap-shroud-1"]')!; const cs = getComputedStyle(el); return { origin: cs.transformOrigin, anim: cs.animationName }; });
    console.log('390 shroud style', style);
    if (style.anim !== 'sheet-roll') throw new Error(`expected sheet-roll animation, got ${style.anim}`);
    const boxes = await sample(page, 1500); // sample FIRST: the 620ms roll waits for nobody
    checkRoll(boxes, '390');
    await page.screenshot({ path: `${SHOTS}/sheet-roll-after-390.png` });
    await page.close();
    const mid = await open(wk, 390, 844, '390-mid');
    await mid.waitForTimeout(720); // inside the roll (400ms wait + ~320ms of unfurl)
    await mid.screenshot({ path: `${SHOTS}/sheet-roll-mid-390.png` });
    await mid.close();
  } finally { await wk.close(); }
  const ch = await chromium.launch({ headless: true });
  try {
    const page = await open(ch, 1280, 800, 'desktop');
    const boxes = await sample(page, 1500);
    checkRoll(boxes, 'desktop');
    await page.screenshot({ path: `${SHOTS}/sheet-roll-after-desktop.png` });
    await page.close();
  } finally { await ch.close(); }
  console.log('sheet-roll OK');
})();
