/** Plays N bot-only joker games with the real engine and prints a Series JSON (for screenshots / fixtures). */
import { type Series, addSeriesGame, applyAction, makeRules, newGame, pendingTurn, seriesSides, summarizeGame, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
const n = Number(process.argv[2] ?? 3);
const names = ['You', 'Keisha', 'Marcus', 'Dre'];
const sideNames = ['Spade Gods 🔥', 'Book Bandits'];
let s: Series | null = null;
for (let g = 0; g < n; g++) {
  let st = newGame(makeRules('joker', { targetScore: 300 }), `sx${process.env.S ?? 8}-${g}`);
  for (let i = 0; i < 20000 && st.phase !== 'gameOver'; i++) {
    if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st)!;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat))!);
  }
  void names;
  const sides = seriesSides(st, ['you', 'bot:1', 'bot:2', 'bot:3'], sideNames);
  s = addSeriesGame(s, 'joker', sides, summarizeGame(st, sideNames, (s?.games.length ?? 0) + 1, Date.now() - (n - g) * 600_000));
}
process.stdout.write(JSON.stringify(s));
