/**
 * Offline save for the hand-end check (e2e): hand 2, last trick, both Jokers about to meet, my team bid 10 (Wheels).
 * Seat 1 led the Little Joker, seats 2 and 3 followed; I (seat 0) hold only the Big Joker. Playing it nukes the trick,
 * my team takes its 10th book (Wheels made) and the hand ends → the scorecard / Table Talk must wait for both effects.
 * Usage: npx tsx scripts/handend-state.ts
 */
import { type Card, type GameState, type Trick, applyAction, buildDeck, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, pickBotNames } from '@spades/bots';
import { DEFAULT_SETTINGS, settingsToRules } from '../apps/web/src/settings';

const settings = { ...DEFAULT_SETTINGS, mode: 'joker' as const, speed: 'normal' as const, quality: 'low' as const, targetScore: 500 as const };
const rules = settingsToRules(settings);
const seed = 'handend-1';
let st: GameState = newGame(rules, seed, { dealer: 0 });
// hand 1 (books bid themselves) played out by bots, so the score pad has a real first hand
while (st.phase !== 'handOver') {
  const t = pendingTurn(st)!;
  let a = chooseBotAction(viewFor(st, t.seat), 'pro')!;
  if (a.type === 'runIt') a = { type: 'play', seat: t.seat, card: viewFor(st, t.seat).legal[0]! };
  st = applyAction(st, a);
}
st = applyAction(st, { type: 'nextHand' }); // hand 2, dealer 1
const n = 4;
const last: Card[] = ['LJ', 'AS', 'KS'];
const deck = buildDeck(rules).filter((c) => c !== 'BJ' && !last.includes(c));
// 12 finished tricks: my team wins 9 (me 5, partner 4), seat 1 wins 3 (incl. the 12th, so it leads the last trick)
// → the 13th (the nuke) makes it 10 = Wheels
const winners = [0, 0, 0, 0, 0, 2, 2, 2, 2, 1, 1, 1];
let lead = (st.dealer + 1) % n;
const tricks: Trick[] = winners.map((w) => {
  const plays = Array.from({ length: n }, (_, k) => ({ seat: (lead + k) % n, card: deck.shift()! }));
  const t: Trick = { leader: lead, plays, winner: w };
  lead = w;
  return t;
});
const state: GameState = {
  ...st,
  phase: 'playing', bids: [6, 2, 4, 1], revealed: [true, true, true, true], exchange: [],
  hands: [['BJ'], [], [], []],
  tricks, tricksWon: [5, 3, 4, 0], spadesBroken: true,
  trick: { leader: 1, plays: [{ seat: 1, card: 'LJ' }, { seat: 2, card: 'AS' }, { seat: 3, card: 'KS' }], winner: null },
  turn: 0,
};
process.stdout.write(JSON.stringify({ v: 1, savedAt: Date.now(), seed, settings, state, chat: [], names: ['You', ...pickBotNames(3, ['You'], seed)], teamNames: ['Homies', 'Set Squad'] }));
