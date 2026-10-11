/**
 * Offline saves for release-5 captures.
 *   notice  : a new hand where one side got shot last hand (ON NOTICE chip), your turn to bid
 *   shotout : your last card of the hand that shoots a side out of the game (play it → SHOT OUT game over)
 * Usage: npx tsx scripts/release5-state.ts notice|shotout
 */
import { type GameState, applyAction, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, pickBotNames } from '@spades/bots';
import { DEFAULT_SETTINGS, settingsToRules } from '../apps/web/src/settings';

const what = process.argv[2] ?? 'notice';
const settings = { ...DEFAULT_SETTINGS, mode: 'joker' as const, speed: 'normal' as const, quality: 'high' as const };
const rules = settingsToRules(settings);
const out = (seed: string, st: GameState) => {
  process.stdout.write(JSON.stringify({ v: 1, savedAt: Date.now(), seed, settings, state: st, chat: [], names: ['You', ...pickBotNames(3, ['You'], seed)], teamNames: [null, 'Over The Top'] }));
  process.exit(0);
};
for (let i = 0; i < 3000; i++) {
  const seed = `r5-${what}-${i}`;
  let st = newGame(rules, seed);
  for (let guard = 0; guard < 4000 && st.phase !== 'gameOver'; guard++) {
    if (st.phase === 'handOver') {
      st = applyAction(st, { type: 'nextHand' });
      const h = st.history.at(-1)!;
      if (what === 'notice' && h.handNo >= 2 && h.sides.some((s) => s.shot) && st.phase === 'bidding' && st.turn === 0) out(seed, st);
      continue;
    }
    const t = pendingTurn(st);
    if (!t) break;
    let a = chooseBotAction(viewFor(st, t.seat), 'pro')!;
    if (a.type === 'runIt') a = { type: 'play', seat: t.seat, card: viewFor(st, t.seat).legal[0]! };
    const next = applyAction(st, a);
    if (what === 'shotout' && t.seat === 0 && a.type === 'play' && next.phase === 'gameOver' && next.result?.endReason === 'shotOut' && st.hands[0]!.length === 1) out(seed, st);
    st = next;
  }
}
console.error('no spot found');
process.exit(1);
