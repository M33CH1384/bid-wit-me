/**
 * Builds an offline save where it's your lead and 'Run it!' is guaranteed (for capture scripts / manual checks).
 * Usage: npx tsx scripts/runit-state.ts [mode=joker] [cards=3] > /tmp/runit-save.json
 */
import { applyAction, canRunIt, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, pickBotNames } from '@spades/bots';
import { DEFAULT_SETTINGS, settingsToRules } from '../apps/web/src/settings';

const mode = (process.argv[2] ?? 'joker') as typeof DEFAULT_SETTINGS.mode;
const want = Number(process.argv[3] ?? 3);
const settings = { ...DEFAULT_SETTINGS, mode, speed: 'normal' as const, quality: 'high' as const };
const rules = settingsToRules(settings);
for (let i = 0; i < 4000; i++) {
  const seed = `runit-${mode}-${i}`;
  let st = newGame(rules, seed);
  for (let guard = 0; guard < 3000 && st.phase !== 'gameOver'; guard++) {
    if (st.phase === 'handOver') { if (st.handNo >= 3) break; st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st);
    if (!t) break;
    if (t.seat === 0 && st.phase === 'playing' && st.hands[0]!.length === want && canRunIt(st, 0)) {
      process.stdout.write(JSON.stringify({ v: 1, savedAt: Date.now(), seed, settings, state: st, chat: [], names: ['You', ...pickBotNames(3, ['You'], seed)], teamNames: [null, 'Over The Top'] }));
      process.exit(0);
    }
    let a = chooseBotAction(viewFor(st, t.seat), 'normal')!;
    if (a.type === 'runIt') a = { type: 'play', seat: t.seat, card: viewFor(st, t.seat).legal[0]! };
    st = applyAction(st, a);
  }
}
console.error('no run-it spot found');
process.exit(1);
