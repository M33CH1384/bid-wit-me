/**
 * Offline saves for release-6 captures.
 *   bidme  : hand 3+, my turn to bid FIRST for my team (partner bot hasn't bid → partner talk + bot hint), opponents have bid
 *   bidwait: hand 3+, an opponent is bidding (BID ORDER strip in the middle), I haven't bid yet
 *   pad    : 4+ hands scored, mid-hand (score pad with history + the hand in progress)
 * Usage: npx tsx scripts/release6-state.ts bidme|bidwait|pad
 */
import { type GameState, applyAction, bidOrder, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, pickBotNames } from '@spades/bots';
import { DEFAULT_SETTINGS, settingsToRules } from '../apps/web/src/settings';

const what = process.argv[2] ?? 'bidme';
const settings = { ...DEFAULT_SETTINGS, mode: 'joker' as const, speed: 'normal' as const, quality: 'high' as const, targetScore: 500 as const };
const rules = settingsToRules(settings);
const out = (seed: string, st: GameState) => {
  process.stdout.write(JSON.stringify({ v: 1, savedAt: Date.now(), seed, settings, state: st, chat: [], names: ['You', ...pickBotNames(3, ['You'], seed)], teamNames: ['Homies', 'Set Squad'] }));
  process.exit(0);
};
for (let i = 0; i < 3000; i++) {
  const seed = `r6-${what}-${i}`;
  let st = newGame(rules, seed);
  for (let guard = 0; guard < 5000 && st.phase !== 'gameOver'; guard++) {
    if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st);
    if (!t) break;
    if (st.phase === 'bidding' && st.handNo >= 3) {
      const order = bidOrder(st.rules, st.dealer);
      if (what === 'bidme' && t.seat === 0 && st.revealed[0] && order.indexOf(0) < order.indexOf(2) && order[0] !== 0) out(seed, st);
      if (what === 'bidwait' && t.seat !== 0 && t.seat !== 2 && st.bids[0] === null && st.bids.some((b) => b !== null)) out(seed, st);
    }
    if (what === 'pad' && st.history.length >= 4 && st.phase === 'playing' && st.tricks.length === 5 && t.seat === 0) out(seed, st);
    let a = chooseBotAction(viewFor(st, t.seat), 'pro')!;
    if (a.type === 'runIt') a = { type: 'play', seat: t.seat, card: viewFor(st, t.seat).legal[0]! };
    st = applyAction(st, a);
  }
}
console.error('no spot found');
process.exit(1);
