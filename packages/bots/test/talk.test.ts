import { describe, expect, it } from 'vitest';
import { BOT_NAMES, COMMON, LINE_META, PACK_OWNERS, PERSONAS, TALK, botTalk, leanBid, maskMild, newTalkState, personaForName, personaTag, poolFor, prePlayLine, type PersonaId, type TalkTable } from '../src';

const rng = (seed = 1) => { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; }; };
const nameFor = (p: string) => BOT_NAMES.find((n) => personaForName(n) === p)!;
const table = (names: string[], bots = [false, true, true, true]): TalkTable => ({ seats: names.map((name, i) => ({ name, bot: bots[i]! })), partnerships: true, teamNames: ['Us', 'Them'] });

describe('bot trash talk', () => {
  it('has a big line pool and every persona is reachable from the name pool', () => {
    const count = Object.values(COMMON).flat().length + Object.values(PERSONAS).flatMap((p) => Object.values(p.lines).flat()).length;
    expect(count).toBeGreaterThanOrEqual(150);
    for (const id of Object.keys(PERSONAS)) expect(nameFor(id), id).toBeTruthy();
    const hustlers = BOT_NAMES.filter((n) => personaForName(n) === 'hustler').length / BOT_NAMES.length;
    expect(hustlers).toBeGreaterThan(0.03); expect(hustlers).toBeLessThan(0.4);
  });
  it('persona is fixed per name; the Hustler wears a fake tag until revealed', () => {
    const h = nameFor('hustler');
    expect(personaForName(h)).toBe(personaForName(h));
    expect(personaTag(h, false)).toBe('Newbie');
    expect(personaTag(h, true)).toBe('The Hustler');
  });
  it('cooldowns: never two lines inside the global gap; a bot rests between lines', () => {
    const t = table(['You', nameFor('hype'), nameFor('mama'), nameFor('og')]);
    const st = newTalkState();
    const always = () => 0; // always passes the chance roll
    const a = botTalk(st, t, { kind: 'cut', seat: 1 }, 10_000, always);
    expect(a).not.toBeNull();
    expect(botTalk(st, t, { kind: 'cut', seat: 3 }, 10_000 + TALK.globalGapMs - 1, always)).toBeNull();
    expect(botTalk(st, t, { kind: 'cut', seat: 1 }, 10_000 + TALK.globalGapMs + 1, always)).toBeNull(); // seat 1 resting
    expect(botTalk(st, t, { kind: 'cut', seat: 3 }, 10_000 + TALK.globalGapMs + 1, always)).not.toBeNull();
  });
  it('pre-play lines cannot depend on the card (the API never sees it) and are generic', () => {
    const t = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    const a = prePlayLine(newTalkState(), t, 1, 50_000, rng(7));
    const b = prePlayLine(newTalkState(), t, 1, 50_000, rng(7));
    expect(prePlayLine.length).toBe(5); // (state, table, seat, now, rnd): no card, no hand
    expect(a).toEqual(b);
    const pool = [...(COMMON.prePlay ?? []), ...(PERSONAS.professor.lines.prePlay ?? [])];
    let st = newTalkState(); let got = 0;
    for (let i = 0; i < 400; i++) { const l = prePlayLine(st, t, 1, i * 20_000, rng(i + 3)); if (l) { got++; expect(pool).toContain(l.text); } st = { ...st, lastAt: -1e12, seatAt: [] }; }
    expect(got).toBeGreaterThan(5);
  });
  it('the Hustler plays newbie, then reveals exactly once on its own cut', () => {
    const h = nameFor('hustler');
    const t = table(['You', h, nameFor('mama'), nameFor('og')]);
    const st = newTalkState();
    const pre = prePlayLine(st, t, 1, 0, () => 0)!;
    expect(PERSONAS.hustler.lines.newbie).toContain(pre.text);
    const r1 = botTalk(st, t, { kind: 'cut', seat: 1 }, 100_000, () => 0)!;
    expect(r1.reveal).toBe(true);
    const r2 = botTalk(st, t, { kind: 'cut', seat: 1 }, 200_000, () => 0);
    expect(r2?.reveal).toBeUndefined();
    expect(st.revealed).toEqual([1]);
    expect(personaTag(h, st.revealed.includes(1))).toBe('The Hustler');
  });
  it('partner bot hypes the human; templates fill names and team names', () => {
    const t = table(['Dee', nameFor('og'), nameFor('hype'), nameFor('mama')]);
    const l = botTalk(newTalkState(), t, { kind: 'setThem', seat: 0, side: 0, bid: 5 }, 0, () => 0)!;
    expect(l.seat).toBe(2);
    expect(l.text).toContain('DEE');
    expect(l.text).not.toMatch(/\{\w+\}/);
  });
  it("does not say spades ain't broke once spades are broken", () => {
    expect(LINE_META["Spades ain't broke!"]?.cond).toBe('unbroken');
    const owners = PACK_OWNERS["Spades ain't broke!"] ?? [];
    const persona = owners.find((p) => p !== 'hustler' && p !== 'silent' && !PERSONAS[p].caps);
    expect(persona).toBeTruthy();
    const speaker = nameFor(persona as PersonaId);
    const every = poolFor(persona as PersonaId, 'prePlay', 'cookout');
    expect(every).toContain("Spades ain't broke!");
    const names = ['You', speaker, nameFor('og'), nameFor('coach')];
    const openState = newTalkState();
    openState.used = { [`${persona}:prePlay`]: every.filter((l) => l !== "Spades ain't broke!") };
    const open = prePlayLine(openState, { ...table(names), spadesBroken: false }, 1, 1_000_000, () => 0);
    expect(open?.text.toLowerCase()).toBe("spades ain't broke!");
    const shutState = newTalkState();
    shutState.used = { [`${persona}:prePlay`]: every.filter((l) => l !== "Spades ain't broke!") };
    const shut = prePlayLine(shutState, { ...table(names), spadesBroken: true }, 1, 1_000_000, () => 0);
    expect(shut?.text.toLowerCase() ?? '').not.toBe("spades ain't broke!");
  });
  it('Hustler bids conservatively while acting, never below 1; clean talk masks mild cursing', () => {
    const h = nameFor('hustler');
    expect(leanBid(4, h, false, () => 0)).toBe(3);
    expect(leanBid(2, h, false, () => 0)).toBe(2);
    expect(leanBid(4, h, true, () => 0)).toBe(4);
    expect(maskMild('newbie my ass, that was some shit, damn')).toBe('newbie my a**, that was some sh*t, d*mn');
  });
});

describe("'Run it!' talk", () => {
  const names = ['Dee', ...Object.keys(BOT_NAMES_BY_PERSONA())];
  function BOT_NAMES_BY_PERSONA() { return Object.fromEntries(BOT_NAMES.filter((n) => personaForName(n) !== 'silent' && personaForName(n) !== 'hustler').slice(0, 3).map((n) => [n, 1])); }
  it('a human ran it: the bot partner never claims it in first person (hypes or stays quiet); the other side may answer', () => {
    for (let i = 0; i < 40; i++) {
      const rnd = ((k) => () => ((k = (k * 16807) % 2147483647) / 2147483647))(i + 1);
      const l = botTalk(newTalkState(), table(names), { kind: 'runIt', seat: 0, side: 0 }, 100_000, rnd);
      if (!l) continue;
      const pool = [...(COMMON.runIt ?? []), ...(PERSONAS[l.persona].lines.runIt ?? [])];
      const asRe = (tpl: string) => new RegExp(`^${tpl.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+')}$`, 'i');
      if (l.seat === 2) expect(pool.some((tpl) => asRe(tpl).test(l.text)), l.text).toBe(false);
    }
  });
  it('a bot that ran it can say a runIt line', () => {
    const l = botTalk(newTalkState(), table(names), { kind: 'runIt', seat: 1, side: 1 }, 100_000, () => 0);
    expect(l?.seat).toBe(1);
  });
});
