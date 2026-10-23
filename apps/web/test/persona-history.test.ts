/**
 * @vitest-environment happy-dom
 *
 * Persona memory, web layer: the persona-ledger writer (personaHistory.ts,
 * contract in personaLedger.ts) and the offlineTalk history beats that
 * cite it. The engine is the real @spades/bots; talkPrefs/decks are
 * mocked as in density-talk.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_NAMES, personaForName, type TalkLine, type TalkTable } from '@spades/bots';

vi.mock('../src/talkPrefs', () => ({
  talkPrefs: { get: () => ({ botTalk: true, hideBotTalk: false, voices: true, voiceVolume: 0.6, aiVoices: true }) },
  spokenClipDurationMs: vi.fn(async () => 1000),
}));
vi.mock('../src/decks', () => ({ getActiveDeck: () => 'classic' }));

const { loadPersonaLedger, personaHistView, recordPersonaResults, histViewsForSeats } = await import('../src/personaHistory');
const { PERSONA_LEDGER_KEY, parsePersonaLedger } = await import('../src/personaLedger');
const { offlineTalk } = await import('../src/offlineTalk');

const nameFor = (p: string) => BOT_NAMES.find((n) => personaForName(n) === p)!;

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('persona ledger writer', () => {
  it('folds completed-game results per persona, role-aware, in the ledger contract shape (viewer-side)', () => {
    const s = new MemStore();
    // the viewer loses to the professor, loses again while the professor's
    // partnership game (as the viewer's partner) is won, then beats him
    recordPersonaResults([{ persona: 'professor', role: 'opp', viewerWon: false }], s);
    recordPersonaResults([{ persona: 'professor', role: 'opp', viewerWon: false }, { persona: 'professor', role: 'partner', viewerWon: true }], s);
    const rec = loadPersonaLedger(s).personas.professor!;
    expect(rec.vs).toEqual({ games: 2, wins: 0, losses: 2, streak: -2 });
    expect(rec.together).toEqual({ games: 1, wins: 1, losses: 0, streak: 1 });
    recordPersonaResults([{ persona: 'professor', role: 'opp', viewerWon: true }], s);
    expect(loadPersonaLedger(s).personas.professor!.vs).toEqual({ games: 3, wins: 1, losses: 2, streak: 1 });
    // the versus screen's own reader sees exactly what the writer wrote
    expect(parsePersonaLedger(s.getItem(PERSONA_LEDGER_KEY))).toEqual(loadPersonaLedger(s));
    // and the speaker's-eye view inverts the vs split back: the professor
    // leads 2–1, but the viewer won the last meeting (his last = 'L')
    expect(personaHistView('professor', s)).toMatchObject({ g: 3, w: 2, l: 1, streak: -1, last: 'L', tg: 1, tw: 1, tl: 0 });
  });

  it('views: a persona with no record has none; the human seat never gets one', () => {
    const s = new MemStore();
    expect(personaHistView('petty', s)).toBeUndefined();
    recordPersonaResults([{ persona: 'petty', role: 'opp', viewerWon: false }], s);
    expect(personaHistView('petty', s)).toMatchObject({ g: 1, w: 1 }); // petty won it — the view is hers
    const seats = [{ name: 'You', bot: false }, { name: nameFor('petty'), bot: true }, { name: nameFor('og'), bot: true }];
    const views = histViewsForSeats(seats, s);
    expect(views[0]).toBeUndefined();
    expect(views[1]).toMatchObject({ g: 1, w: 1 });
    expect(views[2]).toBeUndefined(); // never met
  });

  it('corrupt or garbage storage reads as an empty record, never a crash', () => {
    const s = new MemStore();
    s.setItem(PERSONA_LEDGER_KEY, '{not json');
    expect(loadPersonaLedger(s).personas).toEqual({});
    s.setItem(PERSONA_LEDGER_KEY, JSON.stringify({ v: 1, personas: { professor: { vs: { games: 'x' } }, petty: { vs: { games: 1, wins: 0, losses: 1, streak: -1 } } } }));
    const led = loadPersonaLedger(s);
    expect(led.personas.professor).toBeUndefined();
    expect(led.personas.petty).toBeDefined();
  });
});

describe('offlineTalk history beats', () => {
  let got: TalkLine[];
  const names = ['You', nameFor('professor'), nameFor('coach'), nameFor('og')];
  const mkTable = (): TalkTable => ({ seats: names.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['Us', 'Them'] });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    localStorage.clear();
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

  it('a first meeting stays silent: no record, no beat', () => {
    offlineTalk.historyBeat('histSeries');
    offlineTalk.historyBeat('histTogether');
    offlineTalk.historyBeat('histFinale');
    expect(got).toHaveLength(0);
  });

  it('a returning opponent cites the real record, in the chat, as text (no clip id resolves)', () => {
    // the professor's record vs the player: 7–4 his way, built game by
    // game (viewerWon is the ledger's side of the story: he won 7 of 11)
    for (const viewerWon of [false, true, false, true, true, false, false, false, false, false, true]) {
      recordPersonaResults([{ persona: 'professor', role: 'opp', viewerWon }]);
    }
    offlineTalk.historyBeat('histSeries');
    expect(got).toHaveLength(1);
    expect(got[0]!.name).toBe(names[1]);
    expect(got[0]!.text).toContain('7–4');
    expect(got[0]!.line).toMatch(/^professor\.histSeries\./);
  });

  it('the partner beat cites the together record, not a vs record', () => {
    for (let i = 0; i < 4; i++) recordPersonaResults([{ persona: 'coach', role: 'partner', viewerWon: i !== 3 }]);
    offlineTalk.historyBeat('histTogether');
    expect(got).toHaveLength(1);
    expect(got[0]!.name).toBe(names[2]);
    // the deterministic draw takes the together line first: it cites the
    // games-together count from the same record (the {tw}–{tl} pair fill
    // is pinned in the bots truth-property tests)
    expect(got[0]!.text).toContain('4 games as partners');
    expect(got[0]!.line).toMatch(/^coach\.histTogether\./);
  });

  it('newGame moves gameSeq (a stale finale beat knows its match is gone)', () => {
    const seq = offlineTalk.gameSeq;
    offlineTalk.newGame();
    expect(offlineTalk.gameSeq).toBe(seq + 1);
  });
});
