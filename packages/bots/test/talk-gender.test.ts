import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES, COMMON, prePlayLine, LINE_META, PACK_OWNERS, PERSONAS, botTalk, newTalkState, personaForName, poolFor, speakableLines, voiceGender,
  type PersonaId, type TalkIntensity, type TalkKind, type TalkTable,
} from '../src';

const IDS = Object.keys(PERSONAS) as PersonaId[];
const INTENSITIES: TalkIntensity[] = ['family', 'cookout', 'nomercy'];
const ALL_LINES = [...new Set([...Object.values(COMMON), ...IDS.flatMap((id) => Object.values(PERSONAS[id].lines))].flat().filter(Boolean) as string[])];
const kinds = (p: PersonaId) => [...new Set([...Object.keys(PERSONAS[p].lines), ...Object.keys(COMMON)])] as TalkKind[];

// Independent detector: words a speaker uses about THEMSELF that carry a gender ("mama's thinking", "a grown-man card").
// "your mama", "your uncle", "Don't run from that Queen" (the card), "watch me, unc" (addressing someone) aren't self-references.
const F_SELF = /(^|[^a-z])(mama|mommy|momma|auntie|big mama|grown-woman|girlie|queen of (this|the) table|i'?m (a|the) (queen|lady|woman|girl))([^a-z]|$)/i;
const M_SELF = /(^|[^a-z])(papa|daddy|big papa|uncle|unc|grown-man|king of (this|the) table|i'?m (a|the) (king|man|boy|og man))([^a-z]|$)/i;
const NOT_SELF = /\b(your|ya|yo|his|her|their|{their}|{them}'s)\s+(mama|momma|mommy|daddy|uncle|unc|auntie|papa)\b/gi;
const ADDRESS = /,\s*(unc|auntie)\b|^(unc|auntie),/gi;
function selfRef(raw: string): 'f' | 'm' | undefined {
  const s = raw.replace(NOT_SELF, '').replace(ADDRESS, '');
  if (F_SELF.test(s)) return 'f';
  if (M_SELF.test(s)) return 'm';
  return undefined;
}
// lines that gender who they're ABOUT ({them} IS HIM, "baby boy")
function targetRef(raw: string): 'f' | 'm' | undefined {
  if (/\b(IS HER|baby girl|bag lady)\b/i.test(raw)) return 'f';
  if (/\b(IS HIM|baby boy|bag man)\b/i.test(raw)) return 'm';
  return undefined;
}
const other = (g: 'f' | 'm') => (g === 'f' ? 'm' : 'f');

describe('gendered lines follow the bot name gender', () => {
  it('the detector finds the known gendered lines, and every one is tagged', () => {
    const found = ALL_LINES.filter((l) => selfRef(l) || targetRef(l));
    expect(found).toContain("mm-hm. mama's thinking.");
    expect(found).toContain("That's a grown-man card right there!");
    for (const l of ALL_LINES) {
      expect(LINE_META[l]?.self, l).toBe(selfRef(l));
      expect(LINE_META[l]?.target, l).toBe(targetRef(l));
    }
  });

  it('for every persona and both genders, no opposite-gender self-reference can be chosen', () => {
    for (const p of IDS) for (const g of ['f', 'm'] as const) for (const k of kinds(p)) for (const i of INTENSITIES) {
      for (const target of [undefined, 'f', 'm'] as const) {
        for (const l of poolFor(p, k, i, g, target)) {
          expect(selfRef(l), `${p}/${g}/${k}: ${l}`).not.toBe(other(g));
          if (targetRef(l)) expect(targetRef(l), `${p}/${g}/${k} about ${target}: ${l}`).toBe(target);
        }
      }
    }
    // and the recorded clips for each voice never include them either
    for (const p of IDS) for (const g of ['f', 'm'] as const) {
      for (const l of speakableLines(p, g)) expect(selfRef(l.raw), `${p}/${g} clip: ${l.raw}`).not.toBe(other(g));
    }
  }, 60_000);

  it('every gendered line has its opposite-gender variant for the same persona', () => {
    for (const p of IDS) for (const k of kinds(p)) {
      const own = PERSONAS[p].lines[k] ?? [];
      const f = own.filter((l) => LINE_META[l]?.self === 'f').length, m = own.filter((l) => LINE_META[l]?.self === 'm').length;
      expect(f, `${p}/${k}`).toBe(m);
    }
    expect([...PACK_OWNERS["Bag man, you gon' hurt your back!"]!].sort()).toEqual([...PACK_OWNERS["Bag lady, you gon' hurt your back!"]!].sort());
    expect([...PACK_OWNERS["That's a grown-woman card right there!"]!].sort()).toEqual([...PACK_OWNERS["That's a grown-man card right there!"]!].sort());
  });

  it("a male Big Mama never says 'mama' in play (the reported bug), a female one never says 'papa'", () => {
    for (const g of ['f', 'm'] as const) {
      const name = BOT_NAMES.find((n) => personaForName(n) === 'mama' && voiceGender(n) === g)!;
      expect(name, g).toBeTruthy();
      const t: TalkTable = { seats: [{ name: 'You', bot: false }, { name, bot: true }, { name: 'Zed', bot: false }, { name: 'Ann', bot: false }], partnerships: true, teamNames: ['Us', 'Them'], intensity: 'nomercy' };
      let x = 7; const rnd = () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; };
      const said: string[] = [];
      for (let n = 0; n < 3000; n++) {
        const pre = prePlayLine(newTalkState(), t, 1, 1e6 + n, rnd);
        if (pre) said.push(pre.text.toLowerCase());
        const kind = (['win', 'setThem', 'runIt', 'hypePartner'] as TalkKind[])[n % 4]!;
        const line = botTalk(newTalkState(), t, { kind, seat: 1, side: 1, them: kind === 'setThem' ? 0 : 3, bid: 6 }, 1e6 + n, rnd);
        if (line && line.seat === 1) said.push(line.text.toLowerCase());
      }
      if (g === 'f') expect(said.some((s) => s.includes('mama'))).toBe(true);
      if (g === 'm') expect(said.some((s) => s.includes('papa'))).toBe(true);
      expect(said.length, g).toBeGreaterThan(20);
      expect(said.some((s) => s.includes(g === 'f' ? 'papa' : 'mama')), g).toBe(false);
    }
  });
});
