/**
 * Dev helper: print a saved offline game (localStorage 'bwm.game') paused at a hand-over, for screenshots of
 * Table Talk. Usage: tsx scripts/gen-save.ts [minHands=3] [wantNegative=1] > /tmp/save.json
 */
import { applyAction, makeRules, newGame, pendingTurn, viewFor, createRng, type GameState } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
const minHands = +(process.argv[2] ?? 3);
const wantNeg = (process.argv[3] ?? '1') === '1';
for (let k = 0; k < 400; k++) {
  const seed = `talk-${k}`;
  const rules = makeRules('joker', { blindNil: { enabled: true, value: 200, minDeficit: 0 } } as never);
  let st: GameState = newGame(rules, seed);
  const rng = createRng(seed);
  let found: GameState | null = null;
  for (let g = 0; g < 4000 && st.phase !== 'gameOver'; g++) {
    if (st.phase === 'handOver') {
      const rec = st.history.at(-1)!;
      const ok = st.history.length >= minHands && (!wantNeg || (st.scores[0]! < 0 && rec.sides.some((s) => s.contractMade === false)));
      if (ok) { found = st; break; }
      st = applyAction(st, { type: 'nextHand' });
      continue;
    }
    const t = pendingTurn(st)!;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'normal', rng)!);
  }
  if (found) {
    const settings = { mode: 'joker', speed: 'normal', blindNil: 'off', quality: 'low', firstHandBidsItself: true, botLevel: 'normal', partnerships: true };
    process.stdout.write(JSON.stringify({ v: 1, savedAt: Date.now(), seed, settings, state: found, chat: [] }));
    process.exit(0);
  }
}
console.error('no seed found'); process.exit(1);
