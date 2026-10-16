/**
 * 'Run it!' drop and scatter (WebKit 390): the claimer's cards are thrown down one by one, scatter on the felt
 * (Tips on or off), settle, then the tornado takes them. Same seed → same pile. Reduced motion: a tidy row.
 * Screenshots: mid-drop, settled, tornado.
 */
import { makeRules, newGame, canRunIt, type Card, type GameState } from '@spades/rules';
import { webkit, type Browser } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const MINE: Card[] = ['BJ', 'LJ', '2S', 'AS']; // Run it! allows up to 4 cards

function fixture(): string {
  const rules = makeRules('joker');
  const dealt = newGame(rules, 'runit-scatter', { dealer: 3 });
  const all = dealt.hands.flat();
  for (const c of MINE) if (!all.includes(c)) throw new Error(`deck is missing ${c}`);
  const rest = all.filter((c) => !MINE.includes(c));
  const played = rest.slice(0, 36), others = rest.slice(36);
  const hands: Card[][] = [MINE, others.slice(0, 4), others.slice(4, 8), others.slice(8, 12)];
  const tricks = Array.from({ length: 9 }, (_, t) => ({ leader: 0, winner: 1, plays: played.slice(t * 4, t * 4 + 4).map((card, seat) => ({ seat, card })) }));
  const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], hands, tricks, tricksWon: [3, 3, 2, 1], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  if (!canRunIt(st, 0)) throw new Error('fixture: seat 0 cannot run');
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'normal', quality: 'low' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: ['YOU + OMAR', 'BIG WHISPERERS'] });
}

type Drop = { dx: number; dz: number; spin: number; delay: number };
type Probe = { cards: string[]; drops: Drop[] | null; reduced: boolean; slams?: number; atTable?: boolean; rest?: Record<string, { y: number; tilt: number }> };

async function run(b: Browser, opts: { tips: boolean; reduced?: boolean; shots?: string }): Promise<Probe> {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  const raw = fixture();
  await p.addInitScript(() => { (window as unknown as { __bwmRestProbe: boolean }).__bwmRestProbe = true; });
  await p.goto(URL);
  await p.evaluate(({ raw, tips }) => {
    localStorage.setItem('bwm.game', raw);
    localStorage.setItem('bwm.runItTip.v1', JSON.stringify({ shown: 9, used: true }));
    localStorage.setItem('bwm.tips', JSON.stringify({ on: tips, asked: true }));
  }, { raw, tips: opts.tips });
  await p.reload();
  await p.getByTestId('resume').click();
  await p.getByTestId('run-it').waitFor({ timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.mouse.click(195, 300); // a gesture so audio unlocks
  const snd = () => p.evaluate(() => { const s = (window as unknown as { __bwmSound: { played: Record<string, number>; atTable: boolean } }).__bwmSound; return { play: s.played.play ?? 0, runSlam: s.played.runSlam ?? 0, atTable: s.atTable }; });
  const s0 = await snd();
  await p.getByTestId('run-it').click();
  // zoom 1.5s, then the drop (≤1.1s + 0.42s flight), a beat, then the tornado at +1.75s
  await p.waitForTimeout(1500 + 250);
  if (opts.shots) await p.screenshot({ path: `${SHOTS}/runit-${opts.shots}-mid-drop-390.png` });
  await p.waitForTimeout(750);
  if (opts.shots) await p.screenshot({ path: `${SHOTS}/runit-${opts.shots}-settled-390.png` });
  const rest = await p.evaluate(() => (window as unknown as { __bwmRest?: Record<string, { y: number; tilt: number }> }).__bwmRest ?? {});
  await p.waitForTimeout(1300);
  if (opts.shots) await p.screenshot({ path: `${SHOTS}/runit-${opts.shots}-tornado-390.png` });
  const s1 = await snd();
  const probe = await p.evaluate(() => (window as unknown as { __bwmRunDrop?: Probe }).__bwmRunDrop ?? null);
  if (probe) { probe.rest = rest; probe.slams = s1.play - s0.play; probe.atTable = s1.atTable; }
  await ctx.close();
  if (!probe) throw new Error('no run drop probe: the slam never rendered');
  return probe;
}

(async () => {
  const b = await webkit.launch({ headless: true });
  const fails: string[] = [];
  try {
    const a = await run(b, { tips: false, shots: 'tips-off' });
    const again = await run(b, { tips: false });
    const on = await run(b, { tips: true, shots: 'tips-on' });
    const red = await run(b, { tips: false, reduced: true, shots: 'reduced' });
    const d = a.drops ?? [];
    const spins = d.map((x) => Math.abs(x.spin));
    const zs = d.map((x) => x.dz);
    console.log(`cards ${a.cards.join(' ')}; max spin ${Math.max(...spins).toFixed(2)} rad, z spread ${(Math.max(...zs) - Math.min(...zs)).toFixed(2)}, last drop at ${d.at(-1)?.delay.toFixed(2)}s`);
    if (d.length !== a.cards.length || d.length < 2) fails.push(`expected a drop per card, got ${d.length}/${a.cards.length}`);
    if (Math.max(...spins) < 0.2) fails.push('cards were not rotated: not a scatter');
    if (Math.max(...zs) - Math.min(...zs) < 0.1) fails.push('cards landed in a row: not a scatter');
    if (!d.every((x, i) => i === 0 || x.delay > d[i - 1]!.delay)) fails.push('drop is not staggered');
    if (JSON.stringify(a.drops) !== JSON.stringify(again.drops)) fails.push('same seed gave a different pile');
    if (JSON.stringify(a.drops) !== JSON.stringify(on.drops)) fails.push('Tips on did not scatter the same way');
    console.log(`repeat identical=${JSON.stringify(a.drops) === JSON.stringify(again.drops)} tips-on identical=${JSON.stringify(a.drops) === JSON.stringify(on.drops)} reduced drops=${red.drops === null ? 'none (tidy row)' : 'SCATTERED'}`);
    const settled = a.cards.map((c) => a.rest?.[c]).filter(Boolean) as { y: number; tilt: number }[];
    const tilt = Math.max(...settled.map((r) => r.tilt)), ys = settled.map((r) => r.y);
    console.log(`run drop settled ${settled.length}/${a.cards.length}: max tilt ${tilt.toFixed(2)}°, height ${Math.min(...ys).toFixed(4)}..${Math.max(...ys).toFixed(4)}`);
    if (settled.length !== a.cards.length) fails.push('not every run card settled before the tornado');
    if (tilt > 0.5) fails.push(`a run card is tilted ${tilt.toFixed(1)}°`);
    if (Math.max(...ys) > 0.006 + 8 * 0.003 + 0.001 || Math.min(...ys) < 0.005) fails.push('a run card is not at felt height');
    if (red.drops !== null) fails.push('reduced motion still scattered');
    console.log(`slam sounds at the table: ${a.slams} (atTable=${a.atTable})`);
    if (!a.atTable || (a.slams ?? 0) < 2) fails.push('the Run it slam sounds did not play at the table');
  } finally { await b.close(); }
  if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
