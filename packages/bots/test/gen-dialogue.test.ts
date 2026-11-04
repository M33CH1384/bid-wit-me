/**
 * PROTOTYPE (proto/nemotron-dialogue): the generated-dialogue core —
 * payload privacy, response schema, the output fact-check (incl. the
 * adversarial lying-model set), and the mock model's consistency.
 */
import { describe, expect, it } from 'vitest';
import { type GameState, makeRules, newGame } from '@spades/rules';
import {
  GEN_PROTO_PERSONA, buildGenPayload, buildGenPrompt, factCheckLine, genRepeatsRecent,
  mockGenerate, personaForName, validateGenResponse, type GenPayload, type TalkTable,
} from '../src';

const table: TalkTable = {
  seats: [
    { bot: false, name: 'You' },
    { bot: true, name: 'Darius' },   // personaForName('Darius') === 'deacon'
    { bot: true, name: 'Moe' },
    { bot: true, name: 'Zuri' },
  ],
  partnerships: true,
  teamNames: ['Us', 'Them'],
};

/** a state whose last hand set side 1 (bid 7, took 4) while a nil on seat 3 busted with 2 books; scores 210 / 145 */
function riggedState(over: Partial<GameState> = {}): GameState {
  const base = newGame(makeRules('joker', {}), 'gen-rig');
  const hand = {
    handNo: 1, dealer: 0,
    bids: [4, 3, 'nil', 4] as GameState['history'][number]['bids'],
    tricksWon: [5, 4, 0, 2],
    sides: [
      { side: 0, seats: [0, 2], contract: 7, contractTricks: 5, tricks: 5, contractMade: true, contractPoints: 70, nils: [{ seat: 2, kind: 'nil', tricks: 0, made: true, points: 100 }], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 170, totalScore: 210, totalBags: 0 },
      { side: 1, seats: [1, 3], contract: 7, contractTricks: 4, tricks: 4, contractMade: false, contractPoints: -70, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: -70, totalScore: 145, totalBags: 0 },
    ],
  };
  return { ...base, handNo: 1, scores: [210, 145], history: [hand as GameState['history'][number]], ...over };
}

function setPayload(state = riggedState(), speakerSeat = 2): GenPayload {
  // speaker on side 0 (the beneficiary side); side 1 was set — the setThem voice
  return buildGenPayload({ state, table, speakerSeat, kind: 'set', lineKind: 'setThem', subjectSeat: 1, subjectSide: 1 });
}

describe('prototype persona', () => {
  it('the demo seat really carries the deacon persona', () => {
    expect(personaForName('Darius')).toBe(GEN_PROTO_PERSONA);
    expect(GEN_PROTO_PERSONA).toBe('deacon');
  });
});

describe('payload builder', () => {
  it('carries the public facts of the set', () => {
    const p = setPayload();
    expect(p.facts.contract).toEqual({ bid: 7, books: 4, made: false, side: 1 });
    expect(p.facts.scores).toEqual([210, 145]);
    expect(p.subject.relation).toBe('opponents');
    expect(p.speaker.side).toBe(0);
    expect(p.personaCard.persona).toBe('deacon');
    expect(p.facts.numbers).toEqual(expect.arrayContaining([7, 4, 210, 145, 500]));
  });

  it('PRIVACY: a state stuffed with hands/deck/cards yields a payload with no card or hand field anywhere', () => {
    const st = riggedState({
      hands: [['AS', 'KS', 'QS'], ['2S', '3S', '4S'], ['AH', 'KH', 'QH'], ['BJ', 'LJ', '9S']] as GameState['hands'],
      undealt: ['5C', '6C'] as GameState['undealt'],
      misdealReveal: { seat: 0, cards: ['AS', '2H', '3D'] } as GameState['misdealReveal'],
    });
    for (const kind of ['set', 'nilBust', 'matchEnd'] as const) {
      const p = buildGenPayload({ state: st, table, speakerSeat: 1, kind, lineKind: kind === 'set' ? 'setThem' : kind === 'nilBust' ? 'nilBust' : 'win', subjectSeat: 1, subjectSide: 1 });
      const s = JSON.stringify(p);
      for (const card of ['AS', 'KS', 'QS', '2S', 'AH', 'BJ', 'LJ', '9S', '5C']) expect(s).not.toContain(`"${card}"`);
      expect(s).not.toMatch(/"hands"|"hand"|"deck"|"undealt"|"trick"|"seed"|"misdealReveal"/);
      // the allowlist is structural: top-level + facts keys are exactly the documented set
      expect(Object.keys(p).sort()).toEqual(['event', 'facts', 'personaCard', 'recentLines', 'speaker', 'subject', 'v']);
      expect(Object.keys(p.facts).sort()).toEqual(expect.arrayContaining(['bids', 'handPoints', 'mode', 'numbers', 'scores', 'setsThisMatch', 'targetScore']));
    }
  });

  it('nil payload names the busted nil and its books', () => {
    const hand = {
      handNo: 2, dealer: 0, bids: [5, 'nil', 4, 3] as GameState['history'][number]['bids'], tricksWon: [6, 2, 4, 1],
      sides: [
        { side: 0, seats: [0, 2], contract: 9, contractTricks: 10, tricks: 10, contractMade: true, contractPoints: 90, nils: [], bagsAdded: 1, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 91, totalScore: 301, totalBags: 1 },
        { side: 1, seats: [1, 3], contract: 3, contractTricks: 3, tricks: 3, contractMade: true, contractPoints: 30, nils: [{ seat: 1, kind: 'nil', tricks: 2, made: false, points: -100 }], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: -70, totalScore: 75, totalBags: 0 },
      ],
    };
    const st = riggedState({ handNo: 2, scores: [301, 75], history: [hand as GameState['history'][number]] });
    const p = buildGenPayload({ state: st, table, speakerSeat: 3, kind: 'nilBust', lineKind: 'nilBust', subjectSeat: 1, subjectSide: 1 });
    expect(p.facts.nil).toEqual({ bidderName: 'Darius', blind: false, made: false, books: 2 });
  });

  it('match payload carries the result from the speaker\'s side', () => {
    const st = riggedState({ result: { endReason: 'target', finalScores: [512, 388], winners: [0], placements: [1, 2] } as GameState['result'] });
    const p = buildGenPayload({ state: st, table, speakerSeat: 1, kind: 'matchEnd', lineKind: 'lose', subjectSide: 0 });
    expect(p.facts.match).toEqual({ speakerSideWon: false, finalScores: [512, 388], endReason: 'target' });
  });
});

describe('response schema', () => {
  it('accepts a clean structured response', () => {
    const v = validateGenResponse('{"line":"pride cometh before the set.","emotion":"smug","animation":null}');
    expect(v.ok).toBe(true);
  });
  it('rejects bad emotion, unknown animation, extra keys, multiline, oversized', () => {
    expect(validateGenResponse('{"line":"ok line here","emotion":"furious","animation":null}')).toMatchObject({ ok: false, reason: 'emotion-not-allowlisted' });
    expect(validateGenResponse('{"line":"ok line here","emotion":"smug","animation":"backflip"}')).toMatchObject({ ok: false, reason: 'animation-not-allowlisted' });
    expect(validateGenResponse('{"line":"ok line here","emotion":"smug","animation":null,"extra":1}')).toMatchObject({ ok: false });
    expect(validateGenResponse('{"line":"two\\nlines","emotion":"smug","animation":null}')).toMatchObject({ ok: false, reason: 'line-multiline' });
    expect(validateGenResponse('{"line":"' + 'x'.repeat(200) + '","emotion":"smug","animation":null}')).toMatchObject({ ok: false, reason: 'line-length' });
    expect(validateGenResponse('not json')).toMatchObject({ ok: false, reason: 'unparseable-json' });
  });
});

describe('fact-check: honest lines pass', () => {
  const p = setPayload();
  it('fact-true lines pass', () => {
    expect(factCheckLine('y\'all promised 7 and gathered 4. pride cometh before the set.', p).ok).toBe(true);
    expect(factCheckLine('seven bid, four books — the math preached itself.', p).ok).toBe(true);
    expect(factCheckLine('the hand is written; the next one is unwritten.', p).ok).toBe(true);
    expect(factCheckLine('one more hand, children. we rise.', p).ok).toBe(true); // flavour number, no claim noun
  });
});

describe('fact-check: the lying model (adversarial)', () => {
  const p = setPayload(); // truth: side 1 bid 7, took 4, got set; scores 210 / 145
  const lies: [string, string][] = [
    ['y\'all promised 8 and gathered 4.', 'wrong bid count'],
    ['bid 7 and took 6 books. close one.', 'wrong book count'],
    ['up 300 now — running away with it.', 'invented score gap'],
    ['that ace of spades did the damage.', 'invented card'],
    ['your king of hearts never had a chance.', 'invented card 2'],
    ['the big joker sealed it.', 'invented joker'],
    ['you made your bid, respect.', 'claims the set side made its contract'],
    ['made the nil too — clean sweep.', 'claims a made nil that never happened'],
    ['i saw your hand the whole way.', 'hidden-info claim'],
    ['you were holding nothing but trouble.', 'hidden-info claim 2'],
    ['we got set and i love it.', 'wrong-side set claim (speaker\'s side set the subject)'],
    ['thirteen books! a full sweep!', 'wrong book count as words'],
  ];
  for (const [line, why] of lies) {
    it(`rejects: ${why}`, () => {
      const r = factCheckLine(line, p);
      expect(r.ok, `${why} — "${line}"`).toBe(false);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  }
  it('rejects the wrong winner at match end', () => {
    const st = riggedState({ result: { endReason: 'target', finalScores: [512, 388], winners: [0], placements: [1, 2] } as GameState['result'] });
    const lost = buildGenPayload({ state: st, table, speakerSeat: 1, kind: 'matchEnd', lineKind: 'lose', subjectSide: 0 });
    expect(factCheckLine('we won and it feels ordained. 512 to 388.', lost).ok).toBe(false);
    expect(factCheckLine('you lost, plain and simple.', lost).ok).toBe(false);
    expect(factCheckLine('512 to 388. the Lord works in mysterious ways; so does that deck.', lost).ok).toBe(true);
    const won = buildGenPayload({ state: st, table, speakerSeat: 2, kind: 'matchEnd', lineKind: 'win', subjectSide: 1 });
    expect(factCheckLine('congrats — you won this one.', won).ok).toBe(false);
    expect(factCheckLine('we lost with grace.', won).ok).toBe(false);
  });
  it('rejects a made-nil claim over a busted nil', () => {
    const p2 = buildGenPayload({ state: riggedState(), table, speakerSeat: 1, kind: 'nilBust', lineKind: 'nilBust', subjectSeat: 2, subjectSide: 0 });
    // riggedState's nil (seat 2) MADE it in the record; use the hand-2 fixture semantics instead:
    void p2;
    const hand = {
      handNo: 2, dealer: 0, bids: [5, 'nil', 4, 3] as GameState['history'][number]['bids'], tricksWon: [6, 2, 4, 1],
      sides: [
        { side: 0, seats: [0, 2], contract: 9, contractTricks: 10, tricks: 10, contractMade: true, contractPoints: 90, nils: [], bagsAdded: 1, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 91, totalScore: 301, totalBags: 1 },
        { side: 1, seats: [1, 3], contract: 3, contractTricks: 3, tricks: 3, contractMade: true, contractPoints: 30, nils: [{ seat: 1, kind: 'nil', tricks: 2, made: false, points: -100 }], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: -70, totalScore: 75, totalBags: 0 },
      ],
    };
    const st = riggedState({ handNo: 2, scores: [301, 75], history: [hand as GameState['history'][number]] });
    const p3 = buildGenPayload({ state: st, table, speakerSeat: 3, kind: 'nilBust', lineKind: 'nilBust', subjectSeat: 1, subjectSide: 1 });
    expect(factCheckLine('made the nil — beautiful.', p3).ok).toBe(false);
    expect(factCheckLine('took no books at all on that nil.', p3).ok).toBe(false);
    expect(factCheckLine('a nil with 2 books on it — the deck has a sense of humor, Darius.', p3).ok).toBe(true);
  });
});

describe('mock model', () => {
  it('is deterministic per event and always passes the fact-check', () => {
    const p = setPayload();
    const a = mockGenerate(p); const b = mockGenerate(p);
    expect(a).toEqual(b);
    expect(factCheckLine(a.line, p).ok).toBe(true);
    expect(a.line).toContain('7');
  });
  it('varies across different events and stays in register', () => {
    const lines = new Set<string>();
    for (let h = 1; h <= 6; h++) {
      const st = riggedState({ handNo: h });
      const p = setPayload(st);
      const r = mockGenerate(p);
      lines.add(r.line);
      expect(factCheckLine(r.line, p).ok).toBe(true);
      // deacon register: no streamer slang, no caps-lock persona traits, no profanity
      expect(r.line).not.toMatch(/\b(chat|viral|clip it|stream)\b/i);
      expect(r.line).not.toMatch(/\b(shit|damn|hell|ass)\b/i);
      expect(r.line).not.toBe(r.line.toUpperCase());
    }
    expect(lines.size).toBeGreaterThan(1);
  });
  it('match-end mock lines cite the real final score and pass', () => {
    const st = riggedState({ result: { endReason: 'target', finalScores: [512, 388], winners: [0], placements: [1, 2] } as GameState['result'] });
    const p = buildGenPayload({ state: st, table, speakerSeat: 1, kind: 'matchEnd', lineKind: 'lose', subjectSide: 0 });
    const r = mockGenerate(p);
    expect(r.line).toContain('512');
    expect(factCheckLine(r.line, p).ok).toBe(true);
  });
  it('REGRESSION (demo catch): a negative final score is cited as itself, never floored to 0', () => {
    // a shot-out/floor ending: 110 to -40. The mock once rendered the -40
    // as "0" via a Math.max seed — the fact-checker caught it in the demo.
    const st = riggedState({ result: { endReason: 'floor', finalScores: [110, -40], winners: [0], placements: [1, 2] } as GameState['result'] });
    const p = buildGenPayload({ state: st, table, speakerSeat: 2, kind: 'matchEnd', lineKind: 'win', subjectSide: 1 });
    const r = mockGenerate(p);
    expect(r.line).toContain('-40');
    expect(r.line).not.toContain(' to 0');
    expect(factCheckLine(r.line, p).ok).toBe(true);
  });
  it('dedupe: a repeated phrase is detected', () => {
    expect(genRepeatsRecent('pride cometh before the set.', ['Pride cometh before the set!'])).toBe(true);
    expect(genRepeatsRecent('a fresh word entirely.', ['Pride cometh before the set!'])).toBe(false);
  });
  it('the prompt carries the fences (facts only, JSON only, allowlists)', () => {
    const { system, user } = buildGenPrompt(setPayload());
    expect(system).toContain('never invent cards');
    expect(system).toContain('emotion');
    expect(user).toContain('"contract"');
    expect(user).not.toContain('"hands"');
  });
});

describe('fact-check: spelled-out numbers (hardening, round-2 blind spot)', () => {
  // the tuned model spells scores in words; before this pass a word-spelled
  // lie's numbers passed untouched and a word-spelled truth couldn't count.
  const wonState = riggedState({ result: { endReason: 'target', finalScores: [512, 388], winners: [0], placements: [1, 2] } as GameState['result'] });
  const won = buildGenPayload({ state: wonState, table, speakerSeat: 2, kind: 'matchEnd', lineKind: 'win', subjectSide: 1 });

  it('REPLAY (round-2 fallback case): the composed-word true score passes', () => {
    expect(factCheckLine('the final word: five hundred twelve to three hundred eighty eight.', won).ok).toBe(true);
    expect(factCheckLine('five hundred and twelve to three hundred and eighty eight — it is finished.', won).ok).toBe(true);
  });
  it('REPLAY (round-2 fallback case): the digit-by-digit true score passes', () => {
    expect(factCheckLine('five one two to three eight eight. every book accounted for.', won).ok).toBe(true);
  });
  it('composed small numbers pass when they are the facts', () => {
    const st = riggedState({ scores: [112, 98], result: { endReason: 'target', finalScores: [112, 98], winners: [0], placements: [1, 2] } as GameState['result'] });
    const p = buildGenPayload({ state: st, table, speakerSeat: 2, kind: 'matchEnd', lineKind: 'win', subjectSide: 1 });
    expect(factCheckLine('one hundred twelve to ninety eight. it is finished.', p).ok).toBe(true);
    expect(factCheckLine('one hundred twelve to ninety nine. it is finished.', p).ok).toBe(false);
  });
  it('composed words for the set facts pass on the set payload', () => {
    const p = setPayload(); // truth: bid 7, books 4, scores 210 / 145
    expect(factCheckLine('two hundred ten to one hundred forty five, and the gap is the sermon.', p).ok).toBe(true);
  });
  it('a word-spelled lie dies on its numbers: nine hundred to twelve', () => {
    const r = factCheckLine('the score was nine hundred to twelve, and the whole table knew it.', won);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('number-not-in-facts:900');
    expect(r.reasons).toContain('number-not-in-facts:12');
  });
  it('a digit-by-digit lie dies on its numbers', () => {
    const r = factCheckLine('five one three to three eight eight — not even close, children.', won);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('number-not-in-facts:513');
  });
  it('word-spelled book counts go through the books role check', () => {
    const p = setPayload(); // books facts: 5, 4
    const r = factCheckLine('y\'all gathered twenty four books, somehow.', p);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('books-claim-false:24');
  });
  it('a word-spelled wrong bid dies on the bid role check', () => {
    const p = setPayload(); // bids made: 4, 3, 4 and the contract's 7
    const r = factCheckLine('a nine bid was a promise nobody could keep.', p);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('bid-claim-false:9');
  });
  it('flavour number words still pass unheld', () => {
    const p = setPayload();
    expect(factCheckLine('two hands from now, we answer.', p).ok).toBe(true);
    expect(factCheckLine('one more hand, children. we rise.', p).ok).toBe(true);
  });
});
