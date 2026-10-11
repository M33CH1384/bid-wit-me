/**
 * Builds an offline save where it's your turn and you can drop the second Joker onto a trick that already holds the
 * other one (a nuke), for capture scripts / regression checks.
 * Usage: npx tsx scripts/nuke-state.ts [order=lb|bl] [where=mid|last] > /tmp/nuke-save.json
 *   lb: a bot already played the Little Joker, you hold the Big Joker (Little then Big)
 *   bl: a bot already played the Big Joker, you hold the Little Joker (Big then Little)
 *   mid: the trick is in the middle of the hand (2+ tricks to go after it); last: the hand's last trick
 * Prints the card you should play on the last line of stderr.
 */
import { applyAction, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, pickBotNames } from '@spades/bots';
import { DEFAULT_SETTINGS, settingsToRules } from '../apps/web/src/settings';

const order = process.argv[2] ?? 'lb';
const where = process.argv[3] ?? 'mid';
const mine = order === 'lb' ? 'BJ' : 'LJ';
const theirs = order === 'lb' ? 'LJ' : 'BJ';
const settings = { ...DEFAULT_SETTINGS, mode: 'joker' as const, speed: 'normal' as const, quality: 'high' as const };
const rules = settingsToRules(settings);
for (let i = 0; i < 20000; i++) {
  const seed = `nuke-${order}-${where}-${i}`;
  let st = newGame(rules, seed);
  for (let guard = 0; guard < 3000 && st.phase !== 'gameOver'; guard++) {
    if (st.phase === 'handOver') { if (st.handNo >= 4) break; st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st);
    if (!t) break;
    const left = st.hands[0]!.length;
    const okWhere = where === 'mid' ? left >= 3 && left <= 11 : left === 1;
    if (t.seat === 0 && st.phase === 'playing' && okWhere && st.trick.plays.some((p) => p.card === theirs) && viewFor(st, 0).legal.includes(mine)) {
      process.stdout.write(JSON.stringify({ v: 1, savedAt: Date.now(), seed, settings, state: st, chat: [], names: ['You', ...pickBotNames(3, ['You'], seed)] }));
      console.error(mine);
      process.exit(0);
    }
    let a = chooseBotAction(viewFor(st, t.seat), 'normal')!;
    if (a.type === 'runIt') a = { type: 'play', seat: t.seat, card: viewFor(st, t.seat).legal[0]! };
    // bots holding the other Joker drop it whenever it's legal (more nuke spots)
    if (t.seat !== 0 && a.type === 'play' && viewFor(st, t.seat).legal.includes(theirs)) a = { ...a, card: theirs };
    st = applyAction(st, a);
  }
}
console.error('no nuke spot found');
process.exit(1);
