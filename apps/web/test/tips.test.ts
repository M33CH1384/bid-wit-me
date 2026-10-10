import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, legalPlays, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { tipsFor } from '../src/Coach';
import { TERM_ORDER, glossary, parseTerms, plainText } from '../src/glossary';

const RULES = { joker: makeRules('joker', { firstHandBidsItself: false }), aceDown: makeRules('aceDown', { firstHandBidsItself: false }), cutthroat: makeRules('cutthroat', { playerCount: 4, deck: 'standard52' }) };
function states(rules: ReturnType<typeof makeRules>): GameState[] {
  let st = newGame(rules, 'tips'); const out = [st];
  for (let i = 0; i < 90 && st.phase !== 'gameOver'; i++) {
    const t = pendingTurn(st);
    st = t ? applyAction(st, chooseBotAction(viewFor(st, t.seat))!) : applyAction(st, { type: 'nextHand' });
    out.push(st);
  }
  return out;
}
const sentences = (t: string) => plainText(t).replace(/…/g, '').split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;

describe('tips for brand-new players', () => {
  for (const [mode, rules] of Object.entries(RULES)) {
    it(`${mode}: short (≤3 sentences), only known terms, no empty text`, () => {
      for (const st of states(rules)) {
        const me = 0;
        const ctx = { st, view: viewFor(st, me), hand: st.hands[me]!, legal: st.phase === 'playing' && st.turn === me ? legalPlays(st, me) : [], myTurn: st.turn === me, me, partnerName: 'Keisha', pause: false, names: ['You', 'Zuri', 'Keisha', 'Kenji'] };
        for (const t of tipsFor(ctx)) {
          if (t.basics || !t.when(ctx)) continue;
          expect(t.text.length, t.id).toBeGreaterThan(10);
          expect(sentences(t.text), `${t.id}: ${t.text}`).toBeLessThanOrEqual(3);
          for (const p of parseTerms(t.text)) if (typeof p !== 'string') expect(TERM_ORDER).toContain(p.key);
          expect(t.text).not.toMatch(/\{[^}]*$/);
        }
      }
    });
  }
  it('the glossary is mode-aware: Jokers/2s only where they exist', () => {
    const j = glossary(RULES.joker), a = glossary(RULES.aceDown);
    expect(j.trump.def).toMatch(/Joker/);
    expect(j.high.def).toMatch(/2 is the lowest/);
    expect(a.trump.def).not.toMatch(/Joker/);
    expect(glossary(RULES.cutthroat).partner.def).toMatch(/no partners/);
    for (const k of TERM_ORDER) expect(j[k].def.length).toBeGreaterThan(20);
  });
  it('cut tip names the led suit and marks the led card, your trumps and throwaways', () => {
    for (const st of states(RULES.joker)) {
      if (st.phase !== 'playing' || st.turn !== 0 || !st.trick.plays.length) continue;
      const ctx = { st, view: viewFor(st, 0), hand: st.hands[0]!, legal: legalPlays(st, 0), myTurn: true, me: 0, partnerName: 'Keisha', pause: false, names: ['You', 'A', 'B', 'C'] };
      const cut = tipsFor(ctx).find((t) => t.id === 'cut')!;
      if (!cut.when(ctx)) continue;
      expect(cut.text).toMatch(/(Hearts ♥|Diamonds ♦|Clubs ♣) was \{led\|lead\} and you have no (hearts|diamonds|clubs)/);
      expect(cut.marks!.trick![0]).toMatchObject({ card: st.trick.plays[0]!.card, tag: 'LED' });
      expect(cut.marks!.hand!.some((m) => m.kind === 'trump')).toBe(true);
      return;
    }
  });
  it('parses term markup', () => {
    expect(parseTerms('win {books|book} and {trumps|trump} or {bid}')).toEqual(['win ', { text: 'books', key: 'book' }, ' and ', { text: 'trumps', key: 'trump' }, ' or ', { text: 'bid', key: 'bid' }]);
  });
});
