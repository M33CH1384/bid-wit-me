/** Hand Recap review consolidation (owner 2026-10-26): after a Run It the
 * recap's ONE review entry is "Review the tricks" in the HEADER — the old
 * "Review last trick" pill (the Run It cleared-hands sheet) is removed and
 * must not come back (WebKit 390). */
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
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'normal', quality: 'low' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: ['YOU + OMAR', 'BIG WHISPERERS'] });
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
    // the recap arrives: its only review entry is the tricks pill
    const pill = p.getByTestId('recap-tricks-show');
    await pill.waitFor({ timeout: 30000 });
    const text = (await pill.textContent())?.trim();
    console.log(`pill text: "${text}"`);
    if (text !== 'Review the tricks ‹ ›') throw new Error(`pill reads "${text}"`);
    if (await p.getByTestId('talk-run-show').count()) throw new Error('the removed "Review last trick" pill is back');
    // the pill lives in the header — the top of the sheet — so it is
    // reachable with no scroll: its box sits inside the header's box
    const box = await pill.boundingBox();
    const headBox = await p.locator('.tt-head').boundingBox();
    if (!box || !headBox) throw new Error('no geometry for the pill or the header');
    if (box.y < headBox.y - 1 || box.y + box.height > headBox.y + headBox.height + 1) throw new Error('tricks pill is not inside the header');
    console.log(`pill in header: pill y ${Math.round(box.y)}–${Math.round(box.y + box.height)} of header ${Math.round(headBox.y)}–${Math.round(headBox.y + headBox.height)}`);
    await p.screenshot({ path: `${SHOTS}/recap-review-tricks-top-390.png` });
    await pill.click();
    await p.getByTestId('trick-browser').waitFor({ timeout: 10000 });
    console.log('trick browser opened from the header pill');
    await p.screenshot({ path: `${SHOTS}/recap-review-open-390.png` });
    await p.close();
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
