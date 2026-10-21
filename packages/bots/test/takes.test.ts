import { describe, expect, it } from 'vitest';
import { spokenBidTake, spokenTake } from '../src/index';

// Every expectation here was verified against the shipped sprites: re-baking the line
// with this take reproduces the shipped clip's duration to the millisecond.
describe('spoken takes (the generic reads baked into the sprites)', () => {
  it('drops a trailing vocative', () => {
    expect(spokenTake('fresh cut. no charge, {them}.', 'barber')).toBe('fresh cut. no charge.');
    expect(spokenTake('who let you behind my chair, {them}?', 'barber')).toBe('who let you behind my chair?');
  });
  it('drops an opener vocative', () => {
    expect(spokenTake('ok {opp}, you live this hand.', 'barber')).toBe('ok, you live this hand.');
  });
  it('a subject {opp} becomes "y\'all"', () => {
    expect(spokenTake('SET! {opp} going backwards 📉', 'conspiracy')).toBe("SET! y'all going backwards");
  });
  it('{bid} as a plain reference becomes "it"', () => {
    expect(spokenTake('we said {bid}, we got {bid}. accountants.', 'professor')).toBe('we said it, we got it. accountants.');
    expect(spokenTake('{bid} total? that\'s a wish.', 'professor')).toBe('that total? that\'s a wish.');
  });
  it('{card} becomes "that card" and never doubles', () => {
    expect(spokenTake("that {card} said 'mine.'", 'hustler')).toBe("that card said 'mine.'");
  });
  it('caps personas read lowercased, punctuation runs collapsed', () => {
    expect(spokenTake('RUN IT!!! ALL OF EM!!!', 'hype')).toBe('run it! all of um!');
    expect(spokenTake("LET'S GOOOO!", 'hype')).toBe("let's go!");
  });
  it('bid-number lines have per-number takes instead', () => {
    expect(spokenTake('You bid {bid} for THAT?!', 'og')).toBeUndefined();
    expect(spokenBidTake('You bid {bid} for THAT?!', 7)).toBe('You bid 7 for THAT?!');
    expect(spokenBidTake("{bid}? that's a lot of books.", 13)).toBe("13? that's a lot of books.");
  });
  it('the pronunciation dictionary runs inside takes too', () => {
    expect(spokenTake("chile, you won't believe what I heard.", 'storyteller')).toBe("chyle, you won't believe what I heard.");
    expect(spokenTake("mm. I'm telling the whole family, {them}.", 'storyteller')).toBe("hmm. I'm telling the whole family.");
  });
});
