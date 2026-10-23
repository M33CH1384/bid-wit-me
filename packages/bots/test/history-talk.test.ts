import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES, HISTORY_BANKS, LINE_META, PERSONAS, TEXT_ONLY_KINDS,
  type HistReq, type HistView, type PersonaId, type TalkTable,
  histOk, histViewFromLedger, historyTalk,
  lineById, newTalkState, personaForName, poolFor, speakableLines, voiceGender,
} from '../src/index';

const IDS = Object.keys(PERSONAS) as PersonaId[];
const nameFor = (id: PersonaId, g?: 'f' | 'm'): string => BOT_NAMES.find((n) => personaForName(n) === id && (!g || voiceGender(n) === g))!;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const view = (p: Partial<HistView>): HistView => ({ g: 0, w: 0, l: 0, streak: 0, last: null, tg: 0, tw: 0, tl: 0, ...p });
/** a partnership table: human 0, opponent 1, partner 2, opponent 3 */
const table = (opp: PersonaId, partner: PersonaId, opp2: PersonaId = 'og'): TalkTable => ({
  seats: [{ name: 'You', bot: false }, { name: nameFor(opp), bot: true }, { name: nameFor(partner), bot: true }, { name: nameFor(opp2), bot: true }],
  partnerships: true, teamNames: ['Us', 'Them'],
});

/** every line a beat can produce over many fresh states (fresh state per call: the per-match caps don't starve the sample) */
function collect(t: TalkTable, kind: 'histSeries' | 'histTogether' | 'histFinale', hist: (HistView | undefined)[], n = 240): { seat: number; text: string; line?: string; persona: PersonaId }[] {
  const out: { seat: number; text: string; line?: string; persona: PersonaId }[] = [];
  const rnd = mulberry(1234);
  for (let i = 0; i < n; i++) {
    const l = historyTalk(newTalkState(), t, kind, { kind, hist }, 1_000_000 + i * 10_000, rnd);
    if (l) out.push({ seat: l.seat, text: l.text, line: l.line, persona: l.persona });
  }
  return out;
}

describe('ledger → speaker view conversion (histViewFromLedger)', () => {
  // The stored ledger is viewer-side (personaLedger.ts contract); the view
  // a persona speaks from inverts the vs split and only the vs split.
  it('the vs split inverts: persona wins are the viewer\u2019s losses, the streak flips, last follows the streak sign', () => {
    // viewer leads 4–3 and won the last two
    expect(histViewFromLedger({ games: 7, wins: 4, losses: 3, streak: 2 }, null))
      .toEqual({ g: 7, w: 3, l: 4, streak: -2, last: 'L', tg: 0, tw: 0, tl: 0 });
    // viewer trails 2–5 and lost the last three
    expect(histViewFromLedger({ games: 7, wins: 2, losses: 5, streak: -3 }, null))
      .toMatchObject({ g: 7, w: 5, l: 2, streak: 3, last: 'W' });
  });
  it('the together split does NOT invert: partners shared the viewer\u2019s side', () => {
    const v = histViewFromLedger(null, { games: 5, wins: 3, losses: 2, streak: 1 });
    expect(v).toMatchObject({ tg: 5, tw: 3, tl: 2, g: 0 });
  });
  it('role separation survives conversion: a vs-only record has no together numbers, and vice versa', () => {
    expect(histViewFromLedger({ games: 3, wins: 1, losses: 2, streak: -1 }, null)).toMatchObject({ tg: 0, tw: 0, tl: 0 });
    expect(histViewFromLedger(null, { games: 3, wins: 2, losses: 1, streak: 2 })).toMatchObject({ g: 0, w: 0, l: 0 });
  });
  it('no record converts to an empty view; a zero streak with games played yields last = null (never a guess)', () => {
    expect(histViewFromLedger(null, null)).toEqual({ g: 0, w: 0, l: 0, streak: 0, last: null, tg: 0, tw: 0, tl: 0 });
    expect(histViewFromLedger({ games: 2, wins: 1, losses: 1, streak: 0 }, null).last).toBeNull();
    expect(histViewFromLedger(undefined, undefined).last).toBeNull();
  });
});

describe('history gates (histOk)', () => {
  it('series talk needs 3+ meetings and the cited lead to be real', () => {
    expect(histOk('ahead', view({ g: 2, w: 2, l: 0 }))).toBe(false); // 2–0 is not a series yet
    expect(histOk('ahead', view({ g: 3, w: 2, l: 1 }))).toBe(true);
    expect(histOk('ahead', view({ g: 5, w: 2, l: 3 }))).toBe(false);
    expect(histOk('behind', view({ g: 5, w: 2, l: 3 }))).toBe(true);
    expect(histOk('behind', view({ g: 5, w: 3, l: 2 }))).toBe(false);
    expect(histOk('even', view({ g: 2, w: 1, l: 1 }))).toBe(false); // 1–1 is two games, not a saga
    expect(histOk('even', view({ g: 4, w: 2, l: 2 }))).toBe(true);
  });
  it('streak talk needs 2+ either way; last-meeting talk needs a last meeting', () => {
    expect(histOk('streak', view({ streak: 1 }))).toBe(false);
    expect(histOk('streak', view({ streak: 2 }))).toBe(true);
    expect(histOk('streakVs', view({ streak: -2 }))).toBe(true);
    expect(histOk('streakVs', view({ streak: 2 }))).toBe(false);
    expect(histOk('aheadStreak', view({ g: 3, w: 2, l: 1, streak: 1 }))).toBe(false);
    expect(histOk('aheadStreak', view({ g: 6, w: 4, l: 2, streak: 2 }))).toBe(true);
    expect(histOk('lastW', view({ last: 'W' }))).toBe(true);
    expect(histOk('lastW', view({ last: null }))).toBe(false);
    expect(histOk('lastL', view({ last: 'W' }))).toBe(false);
  });
  it('partner talk needs games together; no view at all passes nothing', () => {
    expect(histOk('tog', view({ tg: 1, tw: 1, tl: 0 }))).toBe(false);
    expect(histOk('tog', view({ tg: 2, tw: 1, tl: 1 }))).toBe(true);
    expect(histOk('togAhead', view({ tg: 3, tw: 2, tl: 1 }))).toBe(true);
    expect(histOk('togBehind', view({ tg: 3, tw: 1, tl: 2 }))).toBe(true);
    for (const req of ['ahead', 'behind', 'even', 'streak', 'streakVs', 'aheadStreak', 'lastW', 'lastL', 'tog', 'togAhead', 'togBehind'] as HistReq[]) {
      expect(histOk(req, undefined), req).toBe(false);
    }
  });
});

describe('history banks: coverage and corpus hygiene', () => {
  const fam = (id: PersonaId, kind: string, req: HistReq) =>
    ((PERSONAS[id].lines as Partial<Record<string, string[]>>)[kind] ?? []).filter((raw) => LINE_META[raw]?.hist === req);

  it('every persona but the Silent Assassin covers the families (he is exempt by design, not by omission)', () => {
    for (const id of IDS) {
      if (id === 'silent') continue;
      expect(fam(id, 'histSeries', 'ahead').length, `${id} ahead`).toBeGreaterThanOrEqual(2);
      expect(fam(id, 'histSeries', 'behind').length, `${id} behind`).toBeGreaterThanOrEqual(2);
      expect(fam(id, 'histSeries', 'even').length, `${id} even`).toBeGreaterThanOrEqual(1);
      expect(fam(id, 'histSeries', 'streak').length, `${id} streak`).toBeGreaterThanOrEqual(1);
      expect(fam(id, 'histSeries', 'streakVs').length, `${id} streakVs`).toBeGreaterThanOrEqual(1);
      expect(fam(id, 'histSeries', 'aheadStreak').length, `${id} aheadStreak`).toBeGreaterThanOrEqual(1);
      expect(fam(id, 'histSeries', 'lastW').length, `${id} lastW`).toBeGreaterThanOrEqual(1);
      expect(fam(id, 'histSeries', 'lastL').length, `${id} lastL`).toBeGreaterThanOrEqual(1);
      for (const req of ['ahead', 'behind', 'streak', 'streakVs', 'lastW', 'lastL'] as HistReq[]) {
        expect(fam(id, 'histFinale', req).length, `${id} finale/${req}`).toBeGreaterThanOrEqual(1);
      }
      expect(fam(id, 'histTogether', 'tog').length, `${id} tog`).toBeGreaterThanOrEqual(1);
      expect(fam(id, 'histTogether', 'togAhead').length, `${id} togAhead`).toBeGreaterThanOrEqual(1);
      expect(fam(id, 'histTogether', 'togBehind').length, `${id} togBehind`).toBeGreaterThanOrEqual(1);
    }
    const silentTotal = (['histSeries', 'histTogether', 'histFinale'] as const).reduce((n, k) => n + (PERSONAS.silent.lines[k]?.length ?? 0), 0);
    expect(silentTotal).toBeGreaterThan(0);
    expect(silentTotal).toBeLessThanOrEqual(3);
  });

  it('both framings exist per persona: the record-holder presses it, the one behind talks comeback, never surrender', () => {
    for (const id of IDS) {
      if (id === 'silent') continue;
      const behindTexts = [...fam(id, 'histSeries', 'behind'), ...fam(id, 'histFinale', 'behind')].join(' ').toLowerCase();
      expect(behindTexts).not.toMatch(/you'?re (just )?better|i give up|can'?t beat you/);
    }
  });

  it('every history line carries a hist requirement, its raw is unique in the persona, and its id round-trips', () => {
    for (const id of IDS) {
      const speakable = speakableLines(id);
      for (const kind of TEXT_ONLY_KINDS) {
        for (const raw of PERSONAS[id].lines[kind] ?? []) {
          expect(LINE_META[raw]?.hist, `${id}.${kind}: ${raw}`).toBeDefined();
          const hits = speakable.filter((l) => l.raw === raw);
          expect(hits).toHaveLength(1);
          expect(lineById(hits[0]!.id)).toBe(raw);
        }
      }
    }
  });

  it('the banks are in the bake corpus: speakableLines enumerates the history kinds as text-only kinds', () => {
    expect(TEXT_ONLY_KINDS).toEqual(['histSeries', 'histTogether', 'histFinale']);
    const ids = speakableLines('professor').map((l) => l.id);
    expect(ids.some((i) => i.startsWith('professor.histSeries.'))).toBe(true);
    expect(ids.some((i) => i.startsWith('professor.histTogether.'))).toBe(true);
    expect(ids.some((i) => i.startsWith('professor.histFinale.'))).toBe(true);
  });

  it('bank data matches the flattened pools (HISTORY_BANKS is the source)', () => {
    for (const [id, kinds] of Object.entries(HISTORY_BANKS) as [PersonaId, typeof HISTORY_BANKS[PersonaId]][]) {
      for (const [kind, bank] of Object.entries(kinds ?? {})) {
        for (const raws of Object.values(bank ?? {})) {
          for (const raw of raws ?? []) expect(PERSONAS[id].lines[kind as 'histSeries']).toContain(raw);
        }
      }
    }
  });
});

describe('historyTalk: the truth property', () => {
  it('a first meeting is silent: no record, no history talk, for every persona and beat', () => {
    for (const id of IDS) {
      const t = table(id, 'coach');
      for (const kind of ['histSeries', 'histTogether', 'histFinale'] as const) {
        expect(collect(t, kind, [undefined, undefined, undefined, undefined], 40), `${id}/${kind}`).toHaveLength(0);
      }
    }
  });

  it('every line that fires cites numbers that are true for ITS speaker', () => {
    // professor leads 7–4, on a 3-streak, won last; partner (coach) is 5 together, 4–1
    const t = table('professor', 'coach');
    const hist: (HistView | undefined)[] = [undefined, view({ g: 11, w: 7, l: 4, streak: 3, last: 'W' }), view({ tg: 5, tw: 4, tl: 1 }), undefined];
    const said = collect(t, 'histSeries', hist, 300);
    expect(said.length).toBeGreaterThan(20);
    for (const l of said) {
      expect(l.seat).toBe(1); // only the professor's record supports series talk here
      const raw = lineById(l.line!)!;
      const req = LINE_META[raw]?.hist!;
      expect(histOk(req, hist[1]), raw).toBe(true);
      if (raw.includes('{hw}–{hl}')) expect(l.text).toContain('7–4');
      if (raw.includes('{hl}–{hw}')) expect(l.text).toContain('4–7');
      if (raw.includes('{streak}')) expect(l.text).toContain('3');
    }
    const partnerLines = collect(t, 'histTogether', hist, 300);
    expect(partnerLines.length).toBeGreaterThan(5);
    for (const l of partnerLines) {
      expect(l.seat).toBe(2);
      const raw = lineById(l.line!)!;
      expect(histOk(LINE_META[raw]?.hist!, hist[2]), raw).toBe(true);
      if (raw.includes('{tw}')) expect(l.text).toContain('4–1');
    }
  });

  it('minimums bite: a 1–0 record can only ever produce last-meeting talk, never "I own you"', () => {
    const t = table('petty', 'coach');
    const hist: (HistView | undefined)[] = [undefined, view({ g: 1, w: 1, l: 0, streak: 1, last: 'W' }), undefined, undefined];
    const said = collect(t, 'histSeries', hist, 300);
    expect(said.length).toBeGreaterThan(0); // the lastW line may fire
    for (const l of said) {
      const req = LINE_META[lineById(l.line!)!]?.hist;
      expect(req).toBe('lastW');
    }
    // and a 2–0 record still cannot cite a series (needs 3) or a streak (his is +2: streak family only)
    const hist2: (HistView | undefined)[] = [undefined, view({ g: 2, w: 2, l: 0, streak: 2, last: 'W' }), undefined, undefined];
    for (const l of collect(t, 'histSeries', hist2, 300)) {
      expect(['streak', 'lastW']).toContain(LINE_META[lineById(l.line!)!]?.hist);
    }
  });

  it('behind is a framing, not a silence: a persona down in the series still talks, competitively', () => {
    const t = table('sorelose', 'coach');
    const hist: (HistView | undefined)[] = [undefined, view({ g: 9, w: 3, l: 6, streak: -3, last: 'L' }), undefined, undefined];
    const said = collect(t, 'histSeries', hist, 300);
    expect(said.length).toBeGreaterThan(10);
    const reqs = new Set(said.map((l) => LINE_META[lineById(l.line!)!]!.hist));
    expect(reqs.has('behind') || reqs.has('streakVs') || reqs.has('lastL')).toBe(true);
    for (const l of said) {
      const raw = lineById(l.line!)!;
      if (raw.includes('{hw}–{hl}')) expect(l.text).toContain('3–6'); // his wins cited from his side: 3–6, he's behind
      if (raw.includes('{hl}–{hw}')) expect(l.text).toContain('6–3'); // the same truth, player's lead first
    }
  });

  it('a partner never cites a vs record that does not exist, and an opponent never cites the together record', () => {
    const t = table('professor', 'petty');
    // partner (petty) has a huge VS record but has never partnered the player; opponent has only together games
    const hist: (HistView | undefined)[] = [undefined, view({ tg: 9, tw: 8, tl: 1 }), view({ g: 12, w: 9, l: 3, streak: 4, last: 'W' }), undefined];
    expect(collect(t, 'histTogether', hist, 120)).toHaveLength(0);
    expect(collect(t, 'histSeries', hist, 120)).toHaveLength(0);
  });

  it('caps: at most 3 history lines per match, at most one per seat', () => {
    const t = table('professor', 'coach', 'petty');
    const rich = view({ g: 12, w: 8, l: 4, streak: 3, last: 'W', tg: 6, tw: 5, tl: 1 });
    const hist: (HistView | undefined)[] = [undefined, rich, rich, rich];
    const st = newTalkState();
    const rnd = mulberry(7);
    const seats: number[] = [];
    let now = 1_000_000;
    for (const kind of ['histSeries', 'histTogether', 'histFinale', 'histSeries', 'histTogether', 'histFinale'] as const) {
      now += 60_000;
      const l = historyTalk(st, t, kind, { kind, hist }, now, rnd);
      if (l) seats.push(l.seat);
    }
    expect(seats.length).toBeLessThanOrEqual(3);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it('the Hustler cites the record as himself, never through the newbie act', () => {
    const t = table('hustler', 'coach');
    const hist: (HistView | undefined)[] = [undefined, view({ g: 8, w: 6, l: 2, streak: 2, last: 'W' }), undefined, undefined];
    const said = collect(t, 'histSeries', hist, 120);
    expect(said.length).toBeGreaterThan(0);
    for (const l of said) {
      expect(l.persona).toBe('hustler');
      expect(l.line).toMatch(/^hustler\.histSeries\./);
    }
  });

  it('cutthroat: opponents can cite the record; there is no partner beat', () => {
    const t: TalkTable = {
      seats: [{ name: 'You', bot: false }, { name: nameFor('og'), bot: true }, { name: nameFor('petty'), bot: true }, { name: nameFor('coach'), bot: true }],
      partnerships: false, teamNames: [],
    };
    const hist: (HistView | undefined)[] = [undefined, view({ g: 6, w: 4, l: 2, streak: 2, last: 'W' }), undefined, undefined];
    expect(collect(t, 'histSeries', hist, 120).length).toBeGreaterThan(0);
    expect(collect(t, 'histTogether', hist, 120)).toHaveLength(0);
  });

  it('the finale cites the record the just-finished game wrote (tonight framing, fresh numbers)', () => {
    const t = table('professor', 'coach');
    // the game that just ended made it 7–4 with a 5-streak
    const hist: (HistView | undefined)[] = [undefined, view({ g: 11, w: 7, l: 4, streak: 5, last: 'W' }), undefined, undefined];
    const said = collect(t, 'histFinale', hist, 300);
    expect(said.length).toBeGreaterThan(10);
    for (const l of said) {
      const raw = lineById(l.line!)!;
      expect(histOk(LINE_META[raw]?.hist!, hist[1]), raw).toBe(true);
      if (raw.includes('{hw}–{hl}')) expect(l.text).toContain('7–4');
      if (raw.includes('{hl}–{hw}')) expect(l.text).toContain('4–7');
      if (raw.includes('{streak}')) expect(l.text).toContain('5');
    }
  });

  it('poolFor serves the history pools per gender (mama/papa variants stay in their own voices)', () => {
    const f = poolFor('mama', 'histSeries', 'cookout', 'f');
    const m = poolFor('mama', 'histSeries', 'cookout', 'm');
    expect(f.some((l) => l.includes("mama's up"))).toBe(true);
    expect(f.some((l) => l.includes("papa's up"))).toBe(false);
    expect(m.some((l) => l.includes("papa's up"))).toBe(true);
    expect(m.some((l) => l.includes("mama's up"))).toBe(false);
  });
});
