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

const { offlineTalk } = await import('../src/offlineTalk');

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
