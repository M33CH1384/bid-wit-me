import { describe, expect, it } from 'vitest';
import { type Card, type GameState, type TableRules, buildDeck, createRng, makeRules, newGame, viewFor, applyAction, pendingTurn } from '@spades/rules';
import { NOVICE_BLUNDER_RATE, chooseBotAction, choosePlay, seatSkill, simulateGame, skillOf } from '../src';

const joker = makeRules('joker');

function fill(rules: TableRules, partial: Card[][]): Card[][] {
  const used = new Set(partial.flat());
  const rest = buildDeck(rules).filter((c) => !used.has(c));
  const size = partial.map((h) => h.length).reduce((a, b) => Math.max(a, b), 0);
  return partial.map((h) => { const o = [...h]; while (o.length < size) o.push(rest.shift()!); return o; });
}
/** a mid-hand position: seat `turn` to play onto `plays` */
function at(hands: Card[][], plays: { seat: number; card: Card }[], turn: number, bids: number[] = [4, 4, 4, 4]): GameState {
  const st = newGame({ ...joker, firstHandBidsItself: false }, 'skill');
  const leader = plays.length ? plays[0]!.seat : turn;
  return { ...st, phase: 'playing', handNo: 2, bids, revealed: [true, true, true, true], dealer: (leader + 3) % 4, turn, hands, spadesBroken: true, tricksWon: [0, 0, 0, 0], trick: { leader, plays, winner: null }, tricks: [] };
}
const noHearts = (cs: Card[]) => cs.filter((c) => !c.endsWith('H'));

describe('bot play: cheapest winners, no wasted Jokers', () => {
  it('a cut uses the LOWEST winning trump (3♠, not the Big Joker)', () => {
    // seat 1 is out of hearts, holds BJ + 3♠; seat 0 led the A♥
    const me: Card[] = ['BJ', '3S', '4C', '5C', '6C', '7C', '8C', '3D', '4D', '5D', '6D', '7D', '8D'];
    const hands = fill(joker, [['AH', 'KH', 'QH', 'JH', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', '9D', 'TD', 'JD'], me, [], []]);
    hands[0] = hands[0]!.filter((c) => c !== 'AH');
    for (const skill of ['regular', 'pro', 'shark'] as const) {
      const st = at(hands, [{ seat: 0, card: 'AH' }], 1);
      expect(choosePlay(viewFor(st, 1), skill, createRng(1))).toBe('3S');
    }
  });
  it('over-trumping an opponent: the cheapest trump that beats theirs', () => {
    const me: Card[] = ['BJ', 'LJ', '7S', '9S', '4C', '5C', '6C', '7C', '3D', '4D', '5D', '6D'];
    const hands = fill(joker, [['AH', 'KH', 'QH', 'JH', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', '9D', 'TD'], ['5S', '3H', '4H', '5H', '6H', '7H', '8H', '9H', 'TH', '2C', '3C', '8C'], me, []]);
    const st = at(hands.map((h) => h.slice(0, 12)), [{ seat: 0, card: 'AH' }, { seat: 1, card: '6S' }], 2);
    st.hands[0] = st.hands[0]!.filter((c) => c !== 'AH');
    st.hands[2] = me;
    const c = choosePlay(viewFor(st, 2), 'pro', createRng(1));
    expect(c).toBe('7S');
  });
  it('never over-trumps a partner who is winning with a trump', () => {
    const me: Card[] = ['BJ', '5S', '4C', '5C', '6C', '7C', '3D', '4D', '5D', '6D', '7D', '8D'];
    const hands = fill(joker, [[], [], [], me]).map((h) => h.slice(0, 12));
    hands[3] = me;
    const st = at(hands, [{ seat: 0, card: '5H' }, { seat: 1, card: '4S' }, { seat: 2, card: '6H' }], 3);
    for (const skill of ['regular', 'pro', 'shark'] as const) {
      const c = choosePlay(viewFor(st, 3), skill, createRng(2));
      expect(['BJ', '5S']).not.toContain(c);
    }
  });
  it('following suit wins with the cheapest sure winner', () => {
    // last to play: K♥ beats the Q♥ on top; A♥ would waste the ace
    const me: Card[] = ['AH', 'KH', '3C', '4C', '5C', '6C', '7C', '3D', '4D', '5D', '6D', '7D'];
    const hands = fill(joker, [[], [], [], me]).map((h) => h.slice(0, 12)); hands[3] = me;
    const st = at(hands, [{ seat: 0, card: 'QH' }, { seat: 1, card: '5H' }, { seat: 2, card: '6H' }], 3);
    expect(choosePlay(viewFor(st, 3), 'pro', createRng(3))).toBe('KH');
  });
});

describe('skill levels', () => {
  it('legacy names map: easy → novice, normal → pro', () => {
    expect(skillOf('easy')).toBe('novice');
    expect(skillOf('normal')).toBe('pro');
  });
  it('Mixed: stable per game + seat, weighted, and a persona floor raises it', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) { const s = seatSkill('mixed', `g${i}`, i % 4); counts[s] = (counts[s] ?? 0) + 1; }
    expect(counts.novice! / 2000).toBeGreaterThan(0.12); expect(counts.novice! / 2000).toBeLessThan(0.28);
    expect(counts.shark! / 2000).toBeGreaterThan(0.08);
    expect(seatSkill('mixed', 'abc', 2)).toBe(seatSkill('mixed', 'abc', 2));
    expect(seatSkill('novice', 'abc', 2, 'pro')).toBe('pro');
    expect(seatSkill('shark', 'abc', 2, 'pro')).toBe('shark');
  });
  it('Novice makes sloppy plays at roughly its set rate (and every move is legal)', () => {
    let choices = 0, differs = 0;
    for (let g = 0; g < 30; g++) {
      let st = newGame({ ...joker, firstHandBidsItself: false }, `nov${g}`);
      for (let guard = 0; guard < 400 && st.phase !== 'handOver' && st.phase !== 'gameOver'; guard++) {
        const t = pendingTurn(st)!;
        const v = viewFor(st, t.seat);
        if (st.phase === 'playing' && v.legal.length > 1) {
          choices++;
          const rng = `${g}:${guard}`;
          if (choosePlay(v, 'novice', createRng(rng)) !== choosePlay(v, 'regular', createRng(rng))) differs++;
        }
        let a = chooseBotAction(v, 'novice', createRng(`${g}:${guard}`))!;
        if (a.type === 'runIt') a = { type: 'play', seat: t.seat, card: v.legal[0]! };
        st = applyAction(st, a); // throws on an illegal move
      }
    }
    const rate = differs / choices;
    expect(rate).toBeGreaterThan(NOVICE_BLUNDER_RATE * 0.35);
    expect(rate).toBeLessThan(NOVICE_BLUNDER_RATE + 0.1);
  });
  it('Pro beats Novice by a clear margin over 200 games', () => {
    let pro = 0;
    const r = makeRules('joker', { targetScore: 250 });
    for (let i = 0; i < 200; i++) {
      const levels = i % 2 ? ['pro', 'novice', 'pro', 'novice'] : ['novice', 'pro', 'novice', 'pro'];
      const st = simulateGame(r, `pvn${i}`, { levels: levels as never });
      const proSide = i % 2 ? 0 : 1;
      if (st.result!.winners.includes(proSide)) pro++;
    }
    expect(pro / 200).toBeGreaterThan(0.62);
  }, 120_000);
});
