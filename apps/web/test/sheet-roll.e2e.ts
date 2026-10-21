/** Elimination recap after the white-sheet retirement (owner, 2026-10-21):
 * a side that is OUT still gets its cover FACTS (data-sheet, time of death,
 * bullet holes) but NO shroud, NO caution tape, and NO set animation for a
 * player with no unlocks in a plain offline game — the retired pair never
 * renders again, and earned animations are the only covers. Runs at 390px
 * WebKit + desktop Chromium. Screenshots: set-cover-{390,desktop} in BWM_SHOTS. */
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
  // Shot on hands 2 and 3 in a row -> side 1 is OUT on hand 3 (cover: sheet).
  const history = [mk(1, []), mk(2, [1]), mk(3, [1])].map((h) => ({ ...h, sides: h.sides.map((s) => ({ ...s, totalScore: s.side === 0 ? 200 : 90 })) }));
  return { ...st, history, handNo: 3, phase: 'handOver', scores: [200, 90], result: undefined };
}
const save = () => JSON.stringify({ v: 1, savedAt: Date.now(), seed: 'sheet-roll', settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: stamped(), chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });

async function open(b: Browser, width: number, height: number): Promise<Page> {
  const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save());
  await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5186');
  await page.getByTestId('resume').click();
  try {
    await page.waitForSelector('[data-testid="recap-side-1"][data-sheet="yes"]', { state: 'attached', timeout: 45000 });
  } catch (e) {
    console.log('debug testids:', await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((x) => x.getAttribute('data-testid')).join(',')));
    await page.screenshot({ path: `${SHOTS}/set-cover-dbg.png` });
    throw e;
  }
  return page;
}

async function check(page: Page, tag: string) {
  const facts = await page.evaluate(() => {
    const side = document.querySelector('[data-testid="recap-side-1"]');
    return {
      sheet: side?.getAttribute('data-sheet'),
      tod: document.querySelector('[data-testid="time-of-death"]')?.textContent ?? null,
      shrouds: document.querySelectorAll('[data-testid^="recap-shroud-"]').length,
      tapes: document.querySelectorAll('[data-testid^="recap-tape-"]').length,
      setanims: document.querySelectorAll('[data-testid^="recap-setanim-"]').length,
      rims: document.querySelectorAll('[data-testid="police-rim"]').length,
    };
  });
  console.log(tag, facts);
  if (facts.sheet !== 'yes') throw new Error(`${tag}: side 1 should carry the sheet cover fact`);
  if (!facts.tod?.includes('Time of death')) throw new Error(`${tag}: time of death missing`);
  if (facts.shrouds || facts.tapes || facts.setanims || facts.rims) {
    throw new Error(`${tag}: retired/default visuals rendered (shroud ${facts.shrouds}, tape ${facts.tapes}, setanim ${facts.setanims}, rim ${facts.rims}) — no unlocks means NO set animation`);
  }
}

(async () => {
  const wk = await webkit.launch({ headless: true });
  try {
    const page = await open(wk, 390, 844);
    await check(page, '390');
    await page.screenshot({ path: `${SHOTS}/set-cover-390.png` });
    await page.close();
  } finally { await wk.close(); }
  const ch = await chromium.launch({ headless: true });
  try {
    const page = await open(ch, 1280, 800);
    await check(page, 'desktop');
    await page.screenshot({ path: `${SHOTS}/set-cover-desktop.png` });
    await page.close();
  } finally { await ch.close(); }
  console.log('set-cover (sheet retirement) OK');
})();
