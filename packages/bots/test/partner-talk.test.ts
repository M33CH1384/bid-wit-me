import { describe, expect, it } from 'vitest';
import { applyAction, createRng, makeRules, newGame, viewFor } from '@spades/rules';
import { PARTNER_TALK_PRESETS, applyHint, botHint, chooseBid, estimateTricks, parseHint } from '../src';

describe('partner talk (bidding)', () => {
  it('every preset parses to a books hint', () => {
    expect(PARTNER_TALK_PRESETS).toEqual(['I got about 2', '3-ish', '4+', "I'm weak", 'I can go Nil', 'Strong in spades']);
    expect(parseHint('I got about 2')).toEqual({ low: 1, high: 2 });
    expect(parseHint('3-ish')).toEqual({ low: 2, high: 3 });
    expect(parseHint('4+')).toEqual({ low: 4, high: 6 });
    expect(parseHint("I'm weak")).toEqual({ low: 0, high: 1 });
    expect(parseHint('I can go Nil')).toMatchObject({ nil: true });
    expect(parseHint('Strong in spades')).toMatchObject({ spades: true });
    expect(parseHint('gg')).toBeNull();
  });
  it("a bot's hint is vague and follows its real estimate", () => {
    const r = makeRules('joker', { firstHandBidsItself: false });
    for (let i = 0; i < 60; i++) {
      const st = newGame(r, `hint-${i}`);
      const v = viewFor(st, 0);
      const est = estimateTricks(v.hand!, v);
      const h = botHint(v.hand!, v);
      expect(h).toMatch(/^(I got about \d+|I'm weak this hand|I might go Nil|Strong in spades, about \d+|I got \d+ or more)$/);
      const n = /(\d+)/.exec(h)?.[1];
      if (n) expect(Math.abs(Number(n) - est)).toBeLessThanOrEqual(1.5);
    }
  });
  it('a bot bidding while its partner has only hinted keeps the team total on the table', () => {
    const r = makeRules('joker', { firstHandBidsItself: false });
    const st = newGame(r, 'hint-total');
    const v = viewFor(st, st.turn!);
    expect(applyHint(8, { low: 6, high: 8 }, v)).toBeLessThanOrEqual(6);
    expect(applyHint(3, { low: 0, high: 0, nil: true }, v)).toBe(4);
    expect(applyHint(3, null, v)).toBe(3);
    // a strong-partner hint never raises the bot's own number
    const a = chooseBid(v, 'pro', createRng('x'));
    const b = chooseBid(v, 'pro', createRng('x'), { low: 5, high: 7 });
    if (typeof a === 'number' && typeof b === 'number') expect(b).toBeLessThanOrEqual(a);
    // no Nil stacked on a partner who says they can go Nil
    expect(chooseBid(v, 'pro', createRng('x'), { low: 0, high: 0, nil: true })).not.toBe('nil');
    void applyAction;
  });
});
