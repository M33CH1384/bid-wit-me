import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { BOT_NAMES, COMMON, LINE_META, PERSONAS, botTalk, chooseBotAction, momentsFor, newTalkState, personaForName, prePlayLine, type TalkEvent, type TalkTable } from '../src';

const nameFor = (p: string) => BOT_NAMES.find((n) => personaForName(n) === p)!;
const table = (names: string[]): TalkTable => ({ seats: names.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['Us', 'Them'] });
/** a deterministic rnd: queued values first, then 0 */
const seq = (...vals: number[]) => { const q = [...vals]; return () => q.shift() ?? 0; };
/** botTalk rolls for a bot-actor setThem: mirror-check, seat pick, chance, roast-check, then pick's rolls */
const setThemRolls = () => seq(0.5, 0, 0, 0.99, 0, 0);

describe('contextual bot speech (fact-tagged lines)', () => {
  it('tags ~60 existing lines with facts, none of them prePlay (fact-blind pool stays blind)', () => {
    const tagged = Object.entries(LINE_META).filter(([, m]) => m.fact);
    expect(tagged.length).toBeGreaterThanOrEqual(60);
    const facts = new Set(tagged.map(([, m]) => m.fact));
    for (const f of ['close', 'aheadBig', 'behindBig', 'lateHand', 'deciding', 'bidderSelf', 'bidderPartner', 'bidderOpp']) expect(facts.has(f as never), f).toBe(true);
    const prePlayPool = [...(COMMON.prePlay ?? []), ...Object.values(PERSONAS).flatMap((p) => p.lines.prePlay ?? [])];
    // moment-fit (2026-10-22): the one sanctioned exception is an 'oppSet'
    // tag — prePlayLine supplies no fact snapshot, so the gate can never
    // verify it there and prePlay output stays fact-blind (proven in (d));
    // the tag only unlocks the line for snapshot-carrying trickPop draws.
    for (const l of prePlayPool) if (LINE_META[l]?.fact) expect(LINE_META[l]!.fact, l).toBe('oppSet');
  });

  it('(a) in a close late-hand setThem, the close-tagged line beats the generic first line', () => {
    const t = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    const base: TalkEvent = { kind: 'setThem', seat: 1, side: 1, them: 0, bid: 6, gap: 180 };
    // no facts on the event: claim-tagged lines are UNVERIFIABLE, so the
    // moment-fit gate sits them out — the bidderOpp opener ("you bid 6. you
    // took fewer.") can no longer fire blind; a claim-free line speaks
    const before = botTalk(newTalkState(), t, base, 100_000, setThemRolls())!;
    expect(before.text).not.toContain('you took fewer');
    // after: close + late + pressure, and the speaker held no contract (bidderSeat = speaker blocks bidderOpp lines)
    const ev: TalkEvent = { ...base, gapBucket: 'close', tricksLeft: 'late', pressure: true, bidderSeat: 1, bidderSide: 1 };
    const after = botTalk(newTalkState(), t, ev, 100_000, setThemRolls())!;
    expect(after.text).toContain('count again');
    expect(after.text).not.toBe(before.text);
  });

  it('(b) when no tagged line matches, it still speaks from the untagged pool (never silenced)', () => {
    const t = table(['You', nameFor('silent'), nameFor('mama'), nameFor('og')]);
    // the Silent Assassin's setThem pool has no fact-tagged lines at all
    const ev: TalkEvent = { kind: 'setThem', seat: 1, side: 1, them: 0, bid: 6, gapBucket: 'close', tricksLeft: 'late', pressure: true };
    const l = botTalk(newTalkState(), t, ev, 100_000, setThemRolls());
    expect(l).not.toBeNull();
    expect(['set.', 'down you go.', 'counted.']).toContain(l!.text);
    // and with no facts at all, a tagged persona still speaks too
    const t2 = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    expect(botTalk(newTalkState(), t2, { kind: 'setThem', seat: 1, side: 1, them: 0, bid: 6 }, 100_000, setThemRolls())).not.toBeNull();
  });

  it('(c) anti-repeat never serves the same line twice in a row, even inside the tagged set', () => {
    const t = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    const ev: TalkEvent = { kind: 'setThem', seat: 1, side: 1, them: 0, bid: 6, gap: 180, gapBucket: 'aheadBig', bidderSeat: 1, bidderSide: 1 };
    let st = newTalkState();
    const said: string[] = [];
    for (let i = 0; i < 2; i++) {
      const l = botTalk(st, t, ev, 100_000 + i * 100_000, setThemRolls())!;
      said.push(l.text);
      st = { ...st, lastAt: -1e12, seatAt: [] }; // clear cooldowns only; used/recent/last memory carries over
    }
    expect(said[0]).toContain('per my calculations');
    // moment-fit claim dedupe: the second fire may not repeat the CLAIM
    // either — every aheadBig line sits out while the facts stand still,
    // so the table hears a claim-free line instead of the scoreboard boast
    expect(said[1]).not.toContain('scoreboard');
    expect(said[1]).not.toBe(said[0]);
  });

  it('(d) prePlay stays fact-blind: no card/hand/facts in, only untagged generic lines out', () => {
    expect(prePlayLine.length).toBe(5); // (state, table, seat, now, rnd) — no card, no hand, no event facts
    const t = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    const pool = [...(COMMON.prePlay ?? []), ...(PERSONAS.professor.lines.prePlay ?? [])];
    let st = newTalkState(); let got = 0;
    for (let i = 0; i < 200; i++) {
      const l = prePlayLine(st, t, 1, i * 20_000, () => 0.01);
      if (l) { got++; expect(pool).toContain(l.text); expect(LINE_META[l.text]?.fact).toBeUndefined(); }
      st = { ...st, lastAt: -1e12, seatAt: [] };
    }
    expect(got).toBeGreaterThan(3);
  });

  it('momentsFor carries the facts: bidder + gap bucket on hand-end events, trick clock on plays', () => {
    const seen: TalkEvent[] = [];
    for (let g = 0; g < 12 && !seen.some((e) => e.kind === 'setThem'); g++) {
      let st: GameState = newGame(makeRules('joker'), `ctx-${g}`);
      for (let i = 0; i < 4000 && st.phase !== 'gameOver'; i++) {
        if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
        const turn = pendingTurn(st); if (!turn) break;
        const a = chooseBotAction(viewFor(st, turn.seat), 'pro')!;
        const next = applyAction(st, a);
        seen.push(...momentsFor(st, a, next));
        st = next;
      }
    }
    const setThem = seen.find((e) => e.kind === 'setThem')!;
    expect(setThem).toBeTruthy();
    expect(setThem.bidderSide).toBe(1 - (setThem.side ?? 0)); // the contract side is the side that got set
    expect(setThem.bidderSeat).toBeDefined();
    const made = seen.find((e) => e.kind === 'made');
    if (made) { expect(made.bidderSide).toBe(made.side); expect(made.bidderSeat).toBeDefined(); }
    const plays = seen.filter((e) => e.card);
    expect(plays.length).toBeGreaterThan(0);
    for (const e of plays) expect(['early', 'mid', 'late']).toContain(e.tricksLeft);
    const withBucket = seen.filter((e) => e.gapBucket);
    expect(withBucket.length).toBeGreaterThan(0);
    for (const e of withBucket) expect(['close', 'aheadBig', 'behindBig']).toContain(e.gapBucket);
  });
});
