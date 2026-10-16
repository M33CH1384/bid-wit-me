/**
 * Stuck-card regression (WebKit 390): drag your last card of a hand, let the next hand deal. When that same card
 * is dealt to you again it must be in your hand, not drawn on the table. (The "just played" card was kept forever
 * offline, so a re-dealt copy was shown on the felt until a tap re-rendered the hand.)
 */
import { applyAction, makeRules, newGame, type Card, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';

const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
type W = { __bwmHandHits: HandHitCard[] };
const tryPlay = (s: GameState): GameState => { for (const c of s.hands[s.turn]!) { try { return applyAction(s, { type: 'play', seat: s.turn as 0, card: c }); } catch { /* illegal */ } } throw new Error('no legal'); };

/** A last-trick state where you play your final card and the next deal gives it back to you. */
function findState(): { st: GameState; card: Card } {
  for (let k = 0; k < 400; k++) {
    const d = newGame(makeRules('joker'), `stuck-${k}`, { dealer: 3 });
    let s: GameState = { ...d, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
    let guard = 0;
    while (s.phase === 'playing' && !(s.turn === 0 && s.hands[0]!.length === 1) && guard++ < 80) s = tryPlay(s);
    if (s.phase !== 'playing') continue;
    const card = s.hands[0]![0]! as Card;
    let e = s; guard = 0;
    while (e.phase === 'playing' && guard++ < 8) e = tryPlay(e);
    if (e.phase !== 'handOver') continue;
    e = applyAction(e, { type: 'nextHand' });
    if (e.hands[0]?.includes(card)) return { st: s, card };
  }
  throw new Error('no seed');
}

(async () => {
  const { st, card } = findState();
  const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'fast', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
    await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
    await page.getByTestId('resume').click();
    await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 1, undefined, { timeout: 45000 });
    await page.waitForTimeout(500);
    const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
    const h = hits[0]!;
    const xs = h.poly.map((p) => p.x), ys = h.poly.map((p) => p.y);
    const g = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.3 };
    if (pickHandCard(g.x, g.y, hits) !== card) throw new Error('grip missed');
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(g.x, g.y - (g.y - 330) * (i / 8));
    await page.mouse.up();
    console.log(`dragged last card ${card}`);
    // hand recap → next hand
    for (let i = 0; i < 60; i++) {
      const next = page.getByRole('button', { name: /next hand|deal|continue/i });
      if (await next.count()) { await next.first().click().catch(() => {}); }
      const n = await page.evaluate(() => ((window as unknown as W).__bwmHandHits ?? []).length);
      if (n >= 12) break;
      await page.waitForTimeout(500);
    }
    await page.waitForFunction(() => document.querySelector('.table-screen')?.getAttribute('data-dealing') === 'no' && ((window as unknown as W).__bwmHandHits ?? []).length >= 12, undefined, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/stuck-card-next-deal-390.png` });
    const trickCount = await page.getByTestId('hand').getAttribute('data-trick-count');
    const inHand = await page.getByTestId(`card-${card}`).count();
    const hitIds = await page.evaluate(() => (window as unknown as W).__bwmHandHits.map((x) => x.id));
    console.log(`next deal: trick-count=${trickCount} ${card} in hand DOM=${inHand} in 3D hand=${hitIds.includes(card)} cards=${hitIds.length}`);
    if (trickCount !== '0') throw new Error(`a card is on the table after the deal (trick-count ${trickCount})`);
    if (!inHand || !hitIds.includes(card)) throw new Error(`${card} was dealt to you but is not in your hand`);
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
