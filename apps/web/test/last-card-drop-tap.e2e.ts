/**
 * Owner device report, 2026-11-03: "I'm still having to wait to throw out
 * the last card but the bots can go out of order."
 *
 * Round 1 (399c52c735) proved the free drop at state level and exempted it
 * from the presentation gate OUT OF TURN — but the moment the turn pointer
 * reached the one-card human, highlightLegal collapsed his set until the
 * Scene certified the new turn (previous trick's rest + review hold +
 * sweep on the frame clock, ~1s after the state-side pause releases),
 * while bot drops — which never consult the gate — landed in state inside
 * that same window. Every human surface eats taps off that one `legal`
 * set, so his tap at trick open was discarded.
 *
 * These cases drive the REAL human path (canvas taps on the fan, through
 * HandPointer → onCard) at the exact frames of the report:
 *  A) Final trick, he is the LEADER: trick 12 completes, the pause
 *     releases (data-my-turn flips), presentation is still catching up —
 *     two taps on his last card must play it immediately, not after the
 *     sweep certifies. FAILS on the pre-fix gate, passes after.
 *  B) Final trick, out of turn INSIDE the collect/review pause: his own
 *     play completes trick 12 (so the game cannot run ahead behind the
 *     load gate), the pause opens, and his drop must land in the trick
 *     before the bot leader's card does. (Pinned working before and
 *     after — the out-of-turn half of the rule.)
 */
import { mkdirSync } from 'node:fs';
import { makeRules, newGame, viewFor, canRunIt, legalPlays, type Card, type GameState } from '@spades/rules';
import { DEFAULT_SETTINGS } from '../src/settings';
import { chromium, type Browser, type Page } from 'playwright-core';

const SHOTS = '/tmp/lastcard2-shots';
mkdirSync(SHOTS, { recursive: true });

function buildSave(opts: {
  seed: string;
  used: Card[];
  hands: Card[][];
  trickPlays: { seat: number; card: Card }[];
  leader: number;
  turn: number;
  speed?: string;
}): string {
  const rules = makeRules('joker');
  const dealt = newGame(rules, opts.seed, { dealer: 3 });
  const all = dealt.hands.flat();
  for (const c of opts.used) if (!all.includes(c)) throw new Error(`deck is missing ${c}`);
  const rest = all.filter((c) => !opts.used.includes(c));
  if (rest.length !== 44) throw new Error(`expected 44 filler cards, got ${rest.length}`);
  const tricks = Array.from({ length: 11 }, (_, t) => {
    const cards = rest.slice(t * 4, t * 4 + 4);
    return { leader: 0, winner: 1, plays: cards.map((card, seat) => ({ seat, card })) };
  });
  const st: GameState = {
    ...dealt,
    phase: 'playing',
    bids: [3, 3, 3, 3],
    hands: opts.hands,
    tricks,
    tricksWon: [3, 3, 3, 2],
    turn: opts.turn,
    trick: { leader: opts.leader, winner: null, plays: opts.trickPlays },
    spadesBroken: true,
    revealed: [true, true, true, true],
  };
  viewFor(st, 0);
  for (let seat = 1; seat < 4; seat++) if (canRunIt(st, seat)) throw new Error(`seat ${seat} can run it`);
  const save = {
    v: 1,
    savedAt: Date.now(),
    seed: st.seed,
    settings: { ...DEFAULT_SETTINGS, speed: opts.speed ?? 'normal', quality: 'low', botLevel: 'novice' },
    state: st,
    chat: [],
    names: ['You', 'Big Mike', 'Omar', 'Sven'],
    teamNames: ['YOU + OMAR', 'BIG WHISPERERS'],
  };
  return JSON.stringify(save);
}

/** Case A: he plays trick 12's last card (3S, trump, wins) and leads the final trick with AS. */
function fixtureLeader(): string {
  const used: Card[] = ['4C', '5C', '9C', '3S', 'AS', '2D', '3H', '6D'];
  const save = buildSave({
    seed: 'lastcard-leader',
    used,
    hands: [['3S', 'AS'], ['2D'], ['3H'], ['6D']],
    trickPlays: [
      { seat: 1, card: '4C' },
      { seat: 2, card: '5C' },
      { seat: 3, card: '9C' },
    ],
    leader: 1,
    turn: 0,
  });
  const st = JSON.parse(save).state as GameState;
  if (!legalPlays(st, 0).includes('3S')) throw new Error('3S must be playable in the fixture');
  return save;
}

/** Case B: trick 12 is Big Mike's KC (winning), Omar's 3C, Sven's 5C, and HIS 9D to complete it — so the game waits for him behind the load gate, and his completing play opens the final trick's pause while the table is interactive. Seat 1 leads the final trick; his remaining 4S is a drop. */
function fixtureOutOfTurn(): string {
  const used: Card[] = ['KC', '3C', '5C', '9D', '4S', '7D', '3H', '2D'];
  return buildSave({
    seed: 'lastcard-outofturn',
    used,
    hands: [['9D', '4S'], ['7D'], ['3H'], ['2D']],
    trickPlays: [
      { seat: 1, card: 'KC' },
      { seat: 2, card: '3C' },
      { seat: 3, card: '5C' },
    ],
    leader: 1,
    turn: 0,
    // Slow table: the pause (and the leader's pacing after it) stretch, so
    // the drop's out-of-order landing has margin on a starved test rig.
    speed: 'slow',
  });
}

interface Hit { id: string; order: number; poly: { x: number; y: number }[] }

function inside(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > y) !== (b.y > y)) {
      const t = (y - a.y) / (b.y - a.y);
      if (x < a.x + (b.x - a.x) * t) inn = !inn;
    }
  }
  return inn;
}

function topAt(hits: Hit[], x: number, y: number): string | null {
  let best: Hit | null = null;
  for (const c of hits) {
    if (!inside(x, y, c.poly)) continue;
    if (!best || c.order > best.order) best = c;
  }
  return best?.id ?? null;
}

function pointOf(hits: Hit[], id: string): { x: number; y: number } {
  const card = hits.find((c) => c.id === id);
  if (!card) throw new Error(`no drawn quad for ${id}`);
  const poly = card.poly;
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  if (topAt(hits, cx, cy) === id) return { x: cx, y: cy };
  const left = [...poly].sort((a, b) => a.x - b.x).slice(0, 2);
  const lx = (left[0]!.x + left[1]!.x) / 2;
  const ly = (left[0]!.y + left[1]!.y) / 2;
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const x = cx + (lx - cx) * t;
    const y = cy + (ly - cy) * t;
    if (topAt(hits, x, y) === id) return { x, y };
  }
  throw new Error(`no visible point for ${id}`);
}

const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

async function tap(page: Page, id: string): Promise<void> {
  const hits = await page.evaluate(() => (window as unknown as { __bwmHandHits?: Hit[] }).__bwmHandHits ?? []);
  const p = pointOf(hits, id);
  const box = await page.locator('.table-canvas canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

interface SavedTrick { tricks: number; plays: { seat: number; card: string }[]; done: { seat: number; card: string }[] | null; turn: number }

const savedTrick = (page: Page) => page.evaluate(() => {
  const g = JSON.parse(localStorage.getItem('bwm.game') ?? 'null');
  if (!g) return null;
  const doneTricks = g.state.tricks;
  return {
    tricks: doneTricks.length,
    plays: g.state.trick.plays,
    done: doneTricks.length ? doneTricks[doneTricks.length - 1].plays : null,
    turn: g.state.turn,
  };
}) as Promise<SavedTrick | null>;

/** The final trick's plays, whether it is still the live trick (12 done) or has completed into the piles (13 done). */
function finalPlays(s: SavedTrick): { seat: number; card: string }[] {
  return s.tricks >= 13 && s.done ? s.done : s.plays;
}

/** Node-side poll for a DOM attribute (in-page waitForFunction polling starves on a SwiftShader-bound main thread). */
async function waitPressed(page: Page, card: string, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    const pressed = await page.evaluate((id) => document.querySelector(`[data-testid="card-${id}"]`)?.getAttribute('aria-pressed') === 'true', card).catch(() => false);
    if (pressed) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await page.waitForTimeout(100);
  }
}

async function waitFor(page: Page, pred: (s: SavedTrick | null) => boolean, what: string, timeoutMs: number): Promise<SavedTrick> {
  const t0 = Date.now();
  for (;;) {
    const s = await savedTrick(page);
    if (pred(s)) return s!;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}; last save ${JSON.stringify(s)}`);
    await page.waitForTimeout(25);
  }
}

async function openTable(page: Page, save: string, base: string, firstCard: string): Promise<void> {
  await page.addInitScript((raw) => {
    localStorage.setItem('bwm.game', raw);
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
    localStorage.setItem('bwm.runItTip.v1', JSON.stringify({ shown: 9, used: true }));
  }, save);
  await page.goto(base);
  // The click can stall on a loaded rig; retry once before giving up.
  await page.getByTestId('resume').click().catch(async () => {
    await page.getByTestId('resume').click({ timeout: 30000 });
  });
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction((id) => {
    const screen = document.querySelector('.table-screen');
    const hits = (window as unknown as { __bwmHandHits?: { id: string }[] }).__bwmHandHits;
    return !!screen && !screen.hasAttribute('inert') && !!hits && hits.some((c) => c.id === id);
  }, firstCard, { timeout: 90000 });
}

async function caseLeader(browser: Browser, base: string): Promise<void> {
  const page = await browser.newPage(IPHONE);
  page.setDefaultTimeout(20000);
  try {
    await openTable(page, fixtureLeader(), base, '3S');
    // His trick-12 turn is a normal (presented) turn: wait for the card to
    // light, then select + play the 3S that wins the trick.
    await page.waitForFunction(() => document.querySelector('[data-testid="card-3S"]')?.getAttribute('data-legal') === 'true', null, { timeout: 20000 });
    await tap(page, '3S');
    if (!(await waitPressed(page, '3S', 4000))) throw new Error('3S did not select');
    // Tap again to play it — the play-armed flag rides a rAF, which crawls
    // on this rig, so tap until the play lands in state.
    {
      const deadline = Date.now() + 25000;
      let s: SavedTrick | null = null;
      while (Date.now() < deadline) {
        s = await savedTrick(page);
        if (s && s.tricks === 12) break;
        await tap(page, '3S').catch(() => undefined);
        await page.waitForTimeout(1300);
      }
      if (!s || s.tricks !== 12) throw new Error(`3S never played; last save ${JSON.stringify(s)}`);
    }
    // Trick 12 completes in state; the final trick is open under the pause.
    await waitFor(page, (s) => !!s && s.tricks === 12 && s.plays.length === 0, 'the final trick to open', 15000);
    // The pause is about to release: state-side it becomes his lead, while
    // presentation is still ~1s behind (rest + review hold + sweep on the
    // frame clock — the constants guarantee certification cannot arrive
    // sooner than ~1.1s of frame time after the flip). Arm an in-page
    // MutationObserver NOW (before the release) that samples the DOM
    // button's data-legal in the very commit that flips data-my-turn:
    // both attributes render in the same React commit, so the sample is
    // exact regardless of rig latency. On the pre-fix gate it reads
    // "false" in that commit and stays false until certification; with
    // the drop exemption it already reads "true".
    await page.evaluate(`(() => {
      const w = window;
      w.__bwmFlipSample = null;
      const screen = document.querySelector('.table-screen');
      if (!screen) return;
      const read = () => {
        if (w.__bwmFlipSample) return;
        if (screen.getAttribute('data-my-turn') === 'yes') {
          const btn = document.querySelector('[data-testid="card-AS"]');
          w.__bwmFlipSample = { asLegal: btn ? btn.getAttribute('data-legal') : null };
        }
      };
      new MutationObserver(read).observe(screen, { attributes: true, attributeFilter: ['data-my-turn'] });
      read();
    })()`);
    const flip = await (async () => {
      const t0 = Date.now();
      for (;;) {
        const s = await page.evaluate(() => (window as unknown as { __bwmFlipSample?: { asLegal: string | null } | null }).__bwmFlipSample ?? null).catch(() => null);
        if (s) return s;
        if (Date.now() - t0 > 20000) throw new Error('pause never released (data-my-turn never flipped)');
        await page.waitForTimeout(100);
      }
    })();
    if (flip.asLegal !== 'true') {
      await page.screenshot({ path: `${SHOTS}/leader-fail.png`, timeout: 5000 }).catch(() => undefined);
      throw new Error(`LEADER CASE: at the instant the final trick opened, his last card was NOT playable (data-legal=${flip.asLegal}) — the presentation gate still holds it until the sweep certifies`);
    }
    const t0 = Date.now();
    await tap(page, 'AS');
    // The first tap SELECTING is the human-path proof: onCard returns
    // before setSelected when the card is not in the gated legal set.
    if (!(await waitPressed(page, 'AS', 1500))) {
      const diag = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="card-AS"]');
        return { asLegal: btn?.getAttribute('data-legal'), asPressed: btn?.getAttribute('aria-pressed'), lastTap: (window as unknown as { __bwmLastTap?: string }).__bwmLastTap ?? '' };
      }).catch(() => null);
      await page.screenshot({ path: `${SHOTS}/leader-fail.png`, timeout: 5000 }).catch(() => undefined);
      throw new Error(`LEADER CASE: the tap at trick open did not even select his last card — the presentation gate still holds it (${JSON.stringify(diag)})`);
    }
    console.log(`leader case: AS selected ${Date.now() - t0}ms after the pause released`);
    // A real player taps again to throw it; the play-armed flag rides a
    // rAF, which crawls on this rig, so tap (spaced so a frame can tick
    // between taps and arm the play) until the play lands in state.
    let s: SavedTrick | null = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      s = await savedTrick(page);
      if (s && finalPlays(s).some((p) => p.seat === 0 && p.card === 'AS')) break;
      await tap(page, 'AS').catch(() => undefined);
      await page.waitForTimeout(1300);
    }
    if (!s || !finalPlays(s).some((p) => p.seat === 0 && p.card === 'AS')) {
      await page.screenshot({ path: `${SHOTS}/leader-fail.png`, timeout: 5000 }).catch(() => undefined);
      throw new Error(`LEADER CASE: selected but never played; last save ${JSON.stringify(s)}`);
    }
    console.log(`leader case passed: AS played ${Date.now() - t0}ms after the pause released; trick`, JSON.stringify(finalPlays(s)));
    await page.screenshot({ path: `${SHOTS}/leader-passed.png`, timeout: 5000 }).catch(() => undefined);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function caseOutOfTurn(browser: Browser, base: string): Promise<void> {
  const page = await browser.newPage(IPHONE);
  page.setDefaultTimeout(20000);
  try {
    await openTable(page, fixtureOutOfTurn(), base, '9D');
    // His completing play is a normal (presented) turn: light, select, play.
    await page.waitForFunction(() => document.querySelector('[data-testid="card-9D"]')?.getAttribute('data-legal') === 'true', null, { timeout: 20000 });
    await tap(page, '9D');
    if (!(await waitPressed(page, '9D', 4000))) throw new Error('9D did not select');
    {
      const deadline = Date.now() + 25000;
      let s: SavedTrick | null = null;
      while (Date.now() < deadline) {
        s = await savedTrick(page);
        if (s && s.tricks === 12) break;
        await tap(page, '9D').catch(() => undefined);
        await page.waitForTimeout(1300);
      }
      if (!s || s.tricks !== 12) throw new Error(`9D never played; last save ${JSON.stringify(s)}`);
    }
    // The final trick is now open under the finished-trick pause — the
    // collect/review window itself. His 4S is a free drop: not his turn.
    await waitFor(page, (s) => !!s && s.tricks === 12 && s.plays.length === 0, 'the final trick to open', 15000);
    const t0 = Date.now();
    await tap(page, '4S');
    if (!(await waitPressed(page, '4S', 4000))) {
      await page.screenshot({ path: `${SHOTS}/outofturn-fail.png`, timeout: 5000 }).catch(() => undefined);
      throw new Error('OUT-OF-TURN CASE: the tap inside the collect/review window did not select his last card');
    }
    // Tap again to throw it, ahead of the bot leader (whose lead cannot
    // arrive before the stretched pause ends plus its pacing draw). Taps
    // are spaced so a frame can tick between them and arm the play; the
    // deadline is generous because a starved rig's frames can be seconds
    // apart — what matters is that the play lands while the leader's card
    // is still in his hand, which the ordering assertion below checks.
    let s: SavedTrick | null = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      s = await savedTrick(page);
      if (s && finalPlays(s).some((p) => p.seat === 0 && p.card === '4S')) break;
      await tap(page, '4S').catch(() => undefined);
      await page.waitForTimeout(1300);
    }
    if (!s || !finalPlays(s).some((p) => p.seat === 0 && p.card === '4S')) {
      const diag = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="card-4S"]');
        return { asLegal: btn?.getAttribute('data-legal'), asPressed: btn?.getAttribute('aria-pressed'), lastTap: (window as unknown as { __bwmLastTap?: string }).__bwmLastTap ?? '' };
      }).catch(() => null);
      await page.screenshot({ path: `${SHOTS}/outofturn-fail.png`, timeout: 5000 }).catch(() => undefined);
      throw new Error(`OUT-OF-TURN CASE: drop did not land inside the collect/review window; last save ${JSON.stringify(s)}; diag ${JSON.stringify(diag)}`);
    }
    console.log(`out-of-turn case: 4S played ${Date.now() - t0}ms after the trick opened`);
    // The drop beat the bot leader: in the final trick's play order his
    // card precedes seat 1's (or seat 1 has not played at all).
    const order = finalPlays(s);
    const hisIdx = order.findIndex((p) => p.seat === 0 && p.card === '4S');
    const leadIdx = order.findIndex((p) => p.seat === 1);
    if (leadIdx !== -1 && leadIdx < hisIdx) throw new Error(`OUT-OF-TURN CASE: the leader played first (${JSON.stringify(order)}) — the drop was not out of order`);
    console.log(`out-of-turn case passed: 4S dropped during the pause, trick`, JSON.stringify(order));
    await page.screenshot({ path: `${SHOTS}/outofturn-passed.png`, timeout: 5000 }).catch(() => undefined);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const base = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
    ...(process.env.BWM_CHROME ? { executablePath: process.env.BWM_CHROME } : {}),
  });
  try {
    await caseLeader(browser, base);
    await caseOutOfTurn(browser, base);
  } finally {
    await browser.close().catch(() => undefined);
  }
  console.log('last-card drop tap: all cases passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
