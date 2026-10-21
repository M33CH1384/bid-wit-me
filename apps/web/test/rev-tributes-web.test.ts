import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, Card, GameState, Play } from '@spades/rules';

const store = new Map<string, string>();
const fakeStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
vi.stubGlobal('localStorage', fakeStorage);
vi.stubGlobal('sessionStorage', fakeStorage);

const { makeRules, newGame } = await import('@spades/rules');
const { REV_MALCOLM_CUT_LINES } = await import('@spades/bots');
const { offlineTalk } = await import('../src/offlineTalk');
const { setActiveDeck } = await import('../src/decks');
const { talkPrefs } = await import('../src/talkPrefs');

type Line = { seat: number; name: string; text: string; line?: string };
let lines: Line[] = [];

function playState(handNo = 1): GameState {
  const s = newGame(makeRules('joker'), 'rev');
  return { ...s, phase: 'playing', handNo };
}

function throwCard(before: GameState, seat: number, card: Card): [Action, GameState] {
  const action: Action = { type: 'play', seat, card };
  const trick = { leader: before.trick?.leader ?? seat, plays: [...(before.trick?.plays ?? []), { seat, card }], winner: null };
  return [action, { ...before, trick }];
}

function completeTrick(before: GameState, plays: Play[], winner: number): [Action, GameState] {
  const last = plays[plays.length - 1]!;
  return [
    { type: 'play', seat: last.seat, card: last.card },
    { ...before, trick: { leader: winner, plays: [], winner: null }, tricks: [...before.tricks, { leader: plays[0]!.seat, plays, winner }] },
  ];
}

function seat(names: string[], opts: { shop?: boolean; deck?: string } = {}) {
  offlineTalk.table = { seats: names.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['Us', 'Them'], intensity: 'cookout', jokers: false };
  offlineTalk.revShop = !!opts.shop;
  offlineTalk.newGame();
  setActiveDeck(opts.deck ?? 'revolutionaries');
}

beforeEach(() => {
  store.clear();
  lines = [];
  offlineTalk.sink = (l) => { lines.push(l as Line); };
  talkPrefs.set({ botTalk: true });
  vi.spyOn(Math, 'random').mockReturnValue(0); // every roll lands, June's share included
});

describe('Revolutionaries tributes through the offline talk driver', () => {
  it('with the deck equipped, the bot who threw the court speaks its tribute under a rev line id', () => {
    seat(['You', 'Ray', 'Jo', 'Cole']);
    const s = playState();
    const [a, after] = throwCard(s, 1, 'KS');
    offlineTalk.step(s, a, after);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.name).toBe('Ray');
    expect(lines[0]!.line).toBe('rev.tribute.0');
    expect(lines[0]!.text).toContain('Frederick Douglass');
  });

  it('a human’s court gets a witness: their bot partner speaks', () => {
    seat(['You', 'Ray', 'Jo', 'Cole']);
    const s = playState();
    const [a, after] = throwCard(s, 0, 'KD');
    offlineTalk.step(s, a, after);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.name).toBe('Jo'); // the partner across the table
    expect(lines[0]!.text).toContain('Marcus Garvey');
    expect(lines[0]!.line).toBe('rev.tribute.6');
  });

  it('any other deck stays silent — the tributes belong to the history deck alone', () => {
    seat(['You', 'Ray', 'Jo', 'Cole'], { deck: 'classic' });
    const s = playState();
    const [a, after] = throwCard(s, 1, 'KS');
    offlineTalk.step(s, a, after);
    expect(lines.filter((l) => l.line?.startsWith('rev.'))).toHaveLength(0);
    expect(lines.filter((l) => l.text.includes('Douglass'))).toHaveLength(0);
  });

  it('at the Barbershop, Coleman carries the tribute — as a story character, keyed by text, no catalog id', () => {
    seat(['You', 'June', 'Dee', 'Mr. Coleman'], { shop: true });
    const s = playState();
    const [a, after] = throwCard(s, 1, 'KS'); // June herself throws Douglass — Coleman still honours him
    offlineTalk.step(s, a, after);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.name).toBe('Mr. Coleman');
    expect(lines[0]!.line).toBeUndefined();
    expect(lines[0]!.text).toContain('Frederick Douglass');
  });

  it('at the Barbershop, June takes a figure she has her own line for (share roll landed)', () => {
    seat(['You', 'June', 'Dee', 'Mr. Coleman'], { shop: true });
    const s = playState();
    const [a, after] = throwCard(s, 3, 'QS');
    offlineTalk.step(s, a, after);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.name).toBe('June');
    expect(lines[0]!.line).toBeUndefined();
    expect(lines[0]!.text).toContain('not one left behind');
  });

  it('the Malcolm cut pre-empts the step and lands as the signature', () => {
    seat(['You', 'Ray', 'Jo', 'Cole']);
    const s = playState();
    const plays: Play[] = [
      { seat: 0, card: '5C' }, { seat: 1, card: 'KC' }, { seat: 2, card: '7S' }, { seat: 3, card: '9C' },
    ];
    const [a, after] = completeTrick(s, plays, 2);
    offlineTalk.step(s, a, after);
    const cut = lines.filter((l) => REV_MALCOLM_CUT_LINES.includes(l.text));
    expect(cut).toHaveLength(1);
    expect(cut[0]!.name).toBe('Ray'); // the bot who threw Malcolm speaks it
    expect(cut[0]!.line).toMatch(/^rev\.malcolm\./);
  });

  it('the talk toggle silences tributes like every other line', () => {
    seat(['You', 'Ray', 'Jo', 'Cole']);
    talkPrefs.set({ botTalk: false });
    const s = playState();
    const [a, after] = throwCard(s, 1, 'KS');
    offlineTalk.step(s, a, after);
    expect(lines).toHaveLength(0);
    talkPrefs.set({ botTalk: true });
  });
});
