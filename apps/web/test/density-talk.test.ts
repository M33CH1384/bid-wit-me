/**
 * @vitest-environment happy-dom
 *
 * Speech density, web layer (offlineTalk): the mix hierarchy's drop rule,
 * consultation right of way, decision protection, cross-speaker dedupe,
 * answer chains and thinking-time murmurs. The talkPrefs module is mocked
 * so clip durations are exact; the engine (@spades/bots) is the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_NAMES, personaForName, type TalkLine, type TalkTable } from '@spades/bots';
import { applyAction, makeRules, newGame } from '@spades/rules';

const dur = vi.hoisted(() => ({ value: 1000 as number | null }));
vi.mock('../src/talkPrefs', () => ({
  talkPrefs: { get: () => ({ botTalk: true, hideBotTalk: false, voices: true, voiceVolume: 0.6, aiVoices: true }) },
  spokenClipDurationMs: vi.fn(async () => dur.value),
}));
vi.mock('../src/decks', () => ({ getActiveDeck: () => 'classic' }));

const { offlineTalk, answerWaitMs } = await import('../src/offlineTalk');

const nameFor = (p: string) => BOT_NAMES.find((n) => personaForName(n) === p)!;
const names = ['You', nameFor('hype'), nameFor('mama'), nameFor('og')];
const mkTable = (profile?: TalkTable['profile']): TalkTable => ({
  seats: names.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['Us', 'Them'],
  ...(profile ? { profile } : {}),
});
const line = (seat: number, text: string): TalkLine => ({ seat, name: names[seat]!, text, persona: personaForName(names[seat]!) });

let got: TalkLine[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  dur.value = 1000;
  offlineTalk.newGame();
  got = [];
  offlineTalk.table = mkTable();
  offlineTalk.sink = (l) => { got.push(l); };
});
afterEach(() => {
  offlineTalk.sink = null;
  offlineTalk.table = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mix hierarchy: generic lines never replace a higher-priority line', () => {
  it('drops a generic line while a scripted line is mid-flight, allows the tail window', () => {
    const now = performance.now();
    offlineTalk.noteHighPriority(now, 10_000); // scripted line runs 10 s
    expect(offlineTalk.emit(line(1, 'chatter'))).toBe(false);
    expect(got).toHaveLength(0);
    // a line whose busy window ends inside the 3 s tail-overlap window may proceed
    offlineTalk.voiceBusyUntil = performance.now() + 2_000;
    expect(offlineTalk.emit(line(1, 'chatter'))).toBe(true);
    expect(got).toHaveLength(1);
  });
});

describe('cross-speaker dedupe', () => {
  it('the same text from a different mouth inside 60 s is suppressed; the same mouth may repeat', () => {
    expect(offlineTalk.emit(line(1, 'Identical sentence.'))).toBe(true);
    expect(offlineTalk.emit(line(3, 'Identical sentence.'))).toBe(false);
    expect(offlineTalk.emit(line(1, 'Identical sentence.'))).toBe(true);
    expect(got.map((l) => l.seat)).toEqual([1, 1]);
  });
});

describe('decision protection', () => {
  it('a generic line with a clip over 2.5 s never starts on the human’s clock; reactions are exempt', () => {
    offlineTalk.table = mkTable('lively');
    offlineTalk.humanDeciding = true;
    const long = line(1, 'A long one.');
    offlineTalk.durCache.set(offlineTalk.durKey(long), 4_000);
    expect(offlineTalk.emit(long)).toBe(false);
    expect(offlineTalk.emit(long, { humanReact: true })).toBe(true); // the human just played — a reaction belongs
    const short = line(3, 'Short pop.');
    offlineTalk.durCache.set(offlineTalk.durKey(short), 900);
    expect(offlineTalk.emit(short)).toBe(true);
    offlineTalk.humanDeciding = false;
    expect(offlineTalk.emit(long)).toBe(true);
  });
});

describe('consultation right of way', () => {
  const bidStep = () => {
    // hand 1 bids itself by house rule — turn the books-hand off so seat 1 really bids
    const st0 = newGame(makeRules('joker', { firstHandBidsItself: false }), 'density-consult', { dealer: 0 });
    const action = { type: 'bid', seat: 1, bid: 6 } as const;
    const st1 = applyAction(st0, action);
    offlineTalk.step(st0, action, st1);
  };

  it('generic bid talk fires normally with no consultation line up', () => {
    offlineTalk.table = mkTable('lively');
    bidStep();
    expect(got.length).toBeGreaterThan(0);
  });

  it('…and is dropped, not queued, inside the consultation window', () => {
    offlineTalk.table = mkTable('lively');
    offlineTalk.noteConsult(5_000);
    bidStep();
    expect(got).toHaveLength(0);
  });
});

describe('answer chains', () => {
  it('a generic line earns exactly one answer at a maxChain-1 class, then the chain dies', async () => {
    offlineTalk.table = mkTable('tense'); // answerP 0.30, maxChain 1; Math.random is 0, so the roll passes
    dur.value = 2000;
    expect(offlineTalk.emit(line(1, 'Opening line.'))).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toHaveLength(2);
    expect(got[1]!.seat).not.toBe(1); // somebody ELSE answers
    await vi.advanceTimersByTimeAsync(30_000);
    expect(got).toHaveLength(2); // no second link at this class
  });

  it('an answer never starts into a scripted line’s window', async () => {
    offlineTalk.table = mkTable('lively');
    dur.value = 1000;
    expect(offlineTalk.emit(line(1, 'Opening line.'))).toBe(true);
    offlineTalk.noteHighPriority(performance.now(), 60_000); // a long scripted sequence owns the room
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toHaveLength(1);
  });

  it('no answers at a standard table (profile-less regular flow is untouched)', async () => {
    expect(offlineTalk.emit(line(1, 'Opening line.'))).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(got).toHaveLength(1);
  });
});

describe('answer timing: the reply rides the tail (owner 2026-10-22 — the twins)', () => {
  /**
   * The answer used to fire at clip-end + 300–700 ms: the second
   * voice arrived after a beat of dead air, every time. Finishing
   * someone's sentence means entering AS their line lands — a line
   * with a real tail is answered into its last second (the arrival
   * goes through the voice engine's tail-only cross-talk policy);
   * shorter and text-only lines are answered at their end + 0–120 ms.
   */
  it('answerWaitMs: a long line is answered into its last second, whatever the roll', () => {
    expect(answerWaitMs(5000, 0)).toBe(4000);
    expect(answerWaitMs(5000, 0.99)).toBe(4000); // the ride ignores the roll — no post-end gap at all
    expect(answerWaitMs(2400, 0)).toBe(1400); // the shortest line with a tail worth riding
    for (const d of [2400, 4000, 8000]) expect(answerWaitMs(d, 1)).toBeLessThan(d); // rides in BEFORE the end
  });

  it('answerWaitMs: short and text-only lines land at their end + 0–120 ms — the old +300–700 is gone', () => {
    expect(answerWaitMs(2399, 0)).toBe(2399);
    expect(answerWaitMs(2399, 1)).toBe(2399 + 120);
    expect(answerWaitMs(1000, 1)).toBe(1120);
    expect(answerWaitMs(null, 0)).toBe(1400); // text-only: the legacy slot stands in for the length
    expect(answerWaitMs(null, 1)).toBe(1520);
    for (const d of [800, 1500, 2399]) expect(answerWaitMs(d, 1)).toBeLessThan(d + 300); // below the old minimum gap
  });

  it('a delivered line’s answer fires on its tail, not after a silent beat', async () => {
    offlineTalk.table = mkTable('tense'); // maxChain 1; Math.random is 0, so the roll passes
    dur.value = 5000;
    expect(offlineTalk.emit(line(1, 'Opening line.'))).toBe(true);
    await vi.advanceTimersByTimeAsync(3999);
    expect(got).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toHaveLength(2); // fired at clip-end − 1000 ms, inside the tail
  });

  it('a short line’s answer lands at its end, without the old 300–700 ms of dead air', async () => {
    offlineTalk.table = mkTable('tense');
    dur.value = 2000; // below the ride minimum: end + 0 ms (Math.random is 0)
    expect(offlineTalk.emit(line(1, 'Opening line.'))).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(got).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toHaveLength(2); // the old wait (2300–2700 ms) would still be silent here
  });
});

describe('thinking-time murmurs', () => {
  it('fires a short pop from a bot seat and reports the seat', async () => {
    offlineTalk.table = mkTable('slow');
    dur.value = 1500;
    const seat = await offlineTalk.murmur();
    expect(seat).not.toBe(false);
    expect(got).toHaveLength(1);
    expect(got[0]!.line!.split('.')[1]).toMatch(/^(prePlay|roast)$/); // recorded pools only — no new voice
  });

  it('drops when every draw runs long (> 2 s)', async () => {
    offlineTalk.table = mkTable('slow');
    dur.value = 2500;
    expect(await offlineTalk.murmur()).toBe(false);
    expect(got).toHaveLength(0);
  });

  it('never fires at a standard table (murmurMs 0)', async () => {
    expect(await offlineTalk.murmur()).toBe(false);
    expect(got).toHaveLength(0);
  });
});
