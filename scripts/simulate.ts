/**
 * Headless bot-vs-bot simulation: plays full games in every mode and checks invariants.
 * Usage: pnpm simulate [gamesPerMode=25] [seedPrefix=sim]
 */
import { simulateGame } from '@spades/bots';
import { type Card, type GameState, type TableRules, buildDeck, deckForHand, handSize, makeRules, sideCount } from '@spades/rules';

const games = Number(process.argv[2] ?? 25);
const prefix = process.argv[3] ?? 'sim';

const modes: [string, TableRules][] = [
  ['Joker Spades 2v2', makeRules('joker')],
  ['Cutthroat 4p (joker deck)', makeRules('cutthroat', { playerCount: 4 })],
  ['Cutthroat 3p (joker deck)', makeRules('cutthroat', { playerCount: 3 })],
  ['Ace Down 2v2', makeRules('aceDown')],
  ['Joker 2v2 + house rules', makeRules('joker', { deuceOfSpadesHigh: true, minTeamBid: 4, blindNil: { onlyWhenBehindBy: null, exchangeCards: 2 }, firstLead: 'twoOfClubs', removedCards: ['2H', '3D'] as Card[], bagsPerPenalty: 5, bagPenalty: 50, tenForTwoHundred: true })],
  ['Cutthroat 3p standard deck', makeRules('cutthroat', { playerCount: 3, deck: 'standard52' })],
];

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Invariant failed: ${msg}`);
}

let failures = 0;
for (const [name, rules] of modes) {
  let hands = 0, contracts = 0, made = 0, nils = 0, nilsMade = 0, blind = 0, blindMade = 0, totalBags = 0, endFloor = 0;
  const wins = Array(sideCount(rules)).fill(0);
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    const seed = `${prefix}:${name}:${g}`;
    try {
      let actions = 0;
      const st: GameState = simulateGame(rules, seed, { onAction: () => void actions++ });
      // invariants
      check(st.phase === 'gameOver' && st.result !== null, 'game over with result');
      let score = Array(sideCount(rules)).fill(0);
      for (const h of st.history) {
        const deck = deckForHand(rules, seed, h.handNo);
        check(new Set(deck).size === buildDeck(rules).length, 'deck unique');
        check(h.tricksWon.reduce((a, b) => a + b, 0) === handSize(rules), 'tricks sum to hand size');
        h.sides.forEach((s, i) => {
          score[i] += s.points;
          check(s.totalScore === score[i], 'running totals add up');
          check(s.totalBags >= 0 && s.totalBags < rules.bagsPerPenalty, 'bag count in range');
          if (s.contract > 0) { contracts++; if (s.contractMade) made++; }
          for (const nr of s.nils) { if (nr.kind === 'blindNil') { blind++; if (nr.made) blindMade++; } else { nils++; if (nr.made) nilsMade++; } }
          totalBags += s.bagsAdded;
        });
        hands++;
      }
      check(JSON.stringify(score) === JSON.stringify(st.scores), 'final scores match history');
      if (st.result!.endReason === 'floor') endFloor++;
      st.result!.winners.forEach((w) => wins[w]++);
      void actions;
    } catch (e) {
      failures++;
      console.error(`✗ ${name} seed=${seed}:`, e);
    }
  }
  const ms = performance.now() - t0;
  console.log(
    `✓ ${name}: ${games} games, ${hands} hands (${(hands / games).toFixed(1)}/game), ` +
    `contracts made ${(100 * made / Math.max(1, contracts)).toFixed(0)}%, nil ${nilsMade}/${nils}, blind nil ${blindMade}/${blind}, ` +
    `bags/hand/side ${(totalBags / Math.max(1, hands) / sideCount(rules)).toFixed(2)}, floor endings ${endFloor}, ` +
    `wins by side [${wins.join(', ')}], ${(ms / games).toFixed(0)} ms/game`,
  );
}
if (failures) {
  console.error(`${failures} game(s) failed`);
  process.exit(1);
}
console.log('All simulated games completed without errors.');
