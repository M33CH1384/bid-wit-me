import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES, LINE_META, NAME_GENDER, PACK, PACK_OWNERS, PERSONAS, PERSONA_VOICES, botSkillFor, botTalk, kokoroGender, lineAllowed,
  nameGender, newTalkState, personaForName, personaTag, poolFor, possessive, speakableLines, voiceFor, voiceGender,
  type PersonaId, type TalkIntensity, type TalkKind, type TalkTable,
} from '../src';

const rng = (seed = 1) => { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; }; };
const IDS = Object.keys(PERSONAS) as PersonaId[];
const table = (names: string[], intensity: TalkIntensity = 'cookout', bots = [false, true, true, true]): TalkTable =>
  ({ seats: names.map((name, i) => ({ name, bot: bots[i]! })), partnerships: true, teamNames: ['Us', 'Them'], intensity, jokers: true });
const nameOf = (p: PersonaId, g?: 'f' | 'm') => BOT_NAMES.find((n) => personaForName(n) === p && (!g || voiceGender(n) === g));

describe('personas + voices', () => {
  it('has 19 personas (7 + 12 new), each with a female and a male Kokoro voice of the right gender', () => {
    expect(IDS.length).toBeGreaterThanOrEqual(17);
    for (const id of IDS) {
      expect(kokoroGender(PERSONA_VOICES[id].f.voice), id).toBe('f');
      expect(kokoroGender(PERSONA_VOICES[id].m.voice), id).toBe('m');
    }
    // no two persona-genders sound identical (same base voice → different speed)
    const sig = IDS.flatMap((id) => (['f', 'm'] as const).map((g) => `${PERSONA_VOICES[id][g].voice}@${PERSONA_VOICES[id][g].speed}`));
    expect(new Set(sig).size).toBe(sig.length);
  });
  it('every bot name is gender-tagged and its voice matches its gender', () => {
    for (const n of BOT_NAMES) {
      expect(NAME_GENDER[n], n).toBeDefined();
      const v = voiceFor(personaForName(n), n);
      if (nameGender(n) !== 'n') expect(kokoroGender(v.voice), `${n} → ${v.voice}`).toBe(nameGender(n));
      expect(kokoroGender(v.voice)).toBe(v.gender);
    }
    expect(voiceGender('Keisha')).toBe('f'); expect(voiceGender('Marcus')).toBe('m');
    expect(possessive('Keisha')).toBe('her'); expect(possessive('Marcus')).toBe('his'); expect(possessive('Kai')).toBe('their');
  });
  it('name → persona is deterministic; gendered tags follow the name', () => {
    for (const n of BOT_NAMES) expect(personaForName(n)).toBe(personaForName(n));
    expect(personaForName('Auntie Pat')).toBe('storyteller');
    expect(personaTag('Auntie Pat', true)).toBe('Auntie Gossip');
    expect(personaTag('Queenie', true)).toBe('Big Mama');
  });
  it('the Hustler never plays below Pro; Lil Cuz varies by game', () => {
    const h = nameOf('hustler')!;
    for (let i = 0; i < 30; i++) expect(['pro', 'shark']).toContain(botSkillFor('novice', `g${i}`, 1, h));
    const cuz = new Set(Array.from({ length: 30 }, (_, i) => botSkillFor('regular', `g${i}`, 1, 'Cuz')));
    expect(cuz.size).toBeGreaterThan(1);
  });
});

describe('trash-talk pack', () => {
  it('every pack line is mapped to 1-3 personas and lands in their pools', () => {
    let n = 0;
    for (const sec of PACK) for (const raw0 of sec.lines) {
      n++;
      const raw = raw0.replace(/^\[[a-z,]+\]\s*/, '').replace(/^!+/, '').replace(/ @\w+$/, '');
      const owners = PACK_OWNERS[raw]!;
      expect(owners?.length, raw).toBeGreaterThanOrEqual(1);
      expect(owners.length, raw).toBeLessThanOrEqual(raw === 'Slow your roll, cowboy!' ? 5 : 3); // Demetrius's own line goes to 5 personas
      for (const o of owners) expect(PERSONAS[o].lines[sec.kind], `${o} ${raw}`).toContain(raw);
    }
    expect(n).toBeGreaterThan(270);
  });
  it('coverage: every new event has lines for most personas at every intensity', () => {
    const kinds: TalkKind[] = ['cut', 'setThem', 'slam', 'partnerBlunder', 'bidTooHigh', 'bags', 'nilBid', 'nilBust', 'blindNil', 'joker', 'boston', 'slow', 'loudLoser', 'badHand', 'win', 'runIt', 'onNotice', 'shotOut'];
    for (const k of kinds) for (const i of ['family', 'cookout', 'nomercy'] as TalkIntensity[]) {
      const have = IDS.filter((p) => p !== 'silent' && poolFor(p, k, i).length > 0).length;
      expect(have, `${k} @ ${i}`).toBeGreaterThanOrEqual(IDS.length - 2);
    }
    // each persona has its own Run it! lines
    for (const p of IDS) expect((PERSONAS[p].lines.runIt ?? []).length, p).toBeGreaterThanOrEqual(3);
  });
  it('intensity: harsh jabs need Cookout or No Mercy; Family Friendly never says them', () => {
    for (const harsh of ['You got the IQ of a parking ticket!', "I knew I should've played with your mama!", 'You gambling with your whole bloodline!', 'You better have Jesus in that hand!']) {
      expect(LINE_META[harsh]?.min, harsh).toBeDefined();
      expect(lineAllowed(harsh, 'family')).toBe(false);
      expect(lineAllowed(harsh, 'nomercy')).toBe(true);
    }
    expect(lineAllowed('You got the IQ of a parking ticket!', 'cookout')).toBe(false);
    for (const p of IDS) for (const k of Object.keys(PERSONAS[p].lines) as TalkKind[]) for (const l of poolFor(p, k, 'family')) {
      expect(LINE_META[l]?.min, l).toBeUndefined();
      expect(/\b(shit|ass|damn|hell)\b/i.test(l), l).toBe(false);
    }
    // a whole game of talk at Family Friendly never produces a gated line
    const st = newTalkState(); const r = rng(5); const t = table(['You', nameOf('og')!, nameOf('mama')!, nameOf('hothead')!], 'family');
    for (let i = 0; i < 400; i++) {
      const l = botTalk(st, t, { kind: (['partnerBlunder', 'setThem', 'slow', 'blindNil', 'bidTooHigh'] as TalkKind[])[i % 5]!, seat: 2, side: 0, them: 0, bid: 7 }, i * 20000, r);
      if (l) expect(l.text).not.toMatch(/parking ticket|your mama|bloodline|Jesus|ancestors|God/);
    }
  });
  it('conditions: Ace lines only when an Ace was cut; negative lines only below zero; Joker lines by Joker', () => {
    const aceLines = Object.entries(LINE_META).filter(([, m]) => m.cond === 'ace').map(([l]) => l);
    const negLines = Object.entries(LINE_META).filter(([, m]) => m.cond === 'neg').map(([l]) => l);
    const big = Object.entries(LINE_META).filter(([, m]) => m.cond === 'big').map(([l]) => l);
    const little = Object.entries(LINE_META).filter(([, m]) => m.cond === 'little').map(([l]) => l);
    expect(aceLines.length).toBe(3); expect(negLines.length).toBe(5); expect(little).toContain('Little Joker still got hands!');
    const t = table(['You', 'Marcus', 'Keisha', 'Dre'], 'nomercy', [false, true, true, true]);
    const said = (ev: Parameters<typeof botTalk>[2], n = 600) => { const st = newTalkState(); const r = rng(9); const out: string[] = []; for (let i = 0; i < n; i++) { const l = botTalk(st, t, ev, i * 20000, r); if (l) out.push(l.text); } return out; };
    for (const x of said({ kind: 'cut', seat: 1, side: 1, them: 0 })) expect(aceLines.some((a) => x.toLowerCase() === a.toLowerCase()), x).toBe(false);
    for (const x of said({ kind: 'setThem', side: 1, them: 0, bid: 5 })) expect(negLines.some((a) => x.toLowerCase() === a.toLowerCase()), x).toBe(false);
    for (const x of said({ kind: 'joker', seat: 1, side: 1, card: 'LJ', them: 0 })) expect(big.some((a) => x.toLowerCase() === a.toLowerCase()), x).toBe(false);
    for (const x of said({ kind: 'joker', seat: 1, side: 1, card: 'BJ', them: 0 })) expect(little.some((a) => x.toLowerCase() === a.toLowerCase()), x).toBe(false);
  });
  it('templates: real bid numbers and his/her/their by the target name', () => {
    const st = newTalkState(); const r = rng(3);
    // seat 0 is a bot named Keisha here (a bot target gets a gendered pronoun)
    const owner = PACK_OWNERS['You bid {bid} with WHAT?!']![0]!;
    const speaker = nameOf(owner)!;
    const t: TalkTable = { seats: ['Keisha', speaker, 'Dre', 'Rell'].map((name) => ({ name, bot: true })), partnerships: true, teamNames: ['A', 'B'], intensity: 'nomercy' };
    const texts: string[] = [];
    for (let i = 0; i < 3000; i++) { const l = botTalk(st, t, { kind: 'bidTooHigh', seat: 0, side: 0, them: 0, bid: 8 }, i * 20000, r); if (l && l.seat === 1) { texts.push(l.text); if (/\{bid\}/.test(l.text)) throw new Error(l.text); if (l.text.includes('You bid 8')) expect(l.bid).toBe(8); } }
    expect(texts.some((x) => /you bid 8 with what/i.test(x))).toBe(true);
    for (const x of texts) expect(x).not.toMatch(/\{their\}|check his glasses/i);
  });
  it('anti-repeat: never the same line twice in a row, and a pool is used up before any line comes back', () => {
    const st = newTalkState(); const r = rng(11);
    const og = nameOf('og')!;
    const t = table(['You', og, 'Keisha', 'Dre'], 'nomercy', [false, true, false, false]);
    const pool = poolFor('og', 'slow', 'nomercy');
    const seq: string[] = [];
    for (let i = 0; i < 400 && seq.length < pool.length * 2; i++) {
      const l = botTalk(st, t, { kind: 'slow', them: 0 }, i * 20000, r);
      if (l) seq.push(l.line!);
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    const first = seq.slice(0, Math.min(pool.length, seq.length) - 1);
    expect(new Set(first).size).toBe(first.length);
  });
  it('every speakable line has a stable id', () => {
    for (const p of IDS) for (const l of speakableLines(p)) expect(l.id).toMatch(/^[a-z]+\.[a-zA-Z]+\.\d+$/);
  });
});

describe("Demetrius's 'Slow your roll, cowboy!'", () => {
  it('is Family Friendly, owned by OG / Big Mama / Smooth / Coach / Deacon, for bid too high, partner over-eager play and loud talk', async () => {
    const { PERSONAS, PACK_OWNERS, lineAllowed } = await import('../src/personas');
    const raw = 'Slow your roll, cowboy!';
    expect(lineAllowed(raw, 'family')).toBe(true);
    expect(PACK_OWNERS[raw]).toEqual(['og', 'mama', 'smooth', 'coach', 'deacon']);
    for (const id of ['og', 'mama', 'smooth', 'coach', 'deacon'] as const)
      for (const k of ['bidTooHigh', 'partnerBlunder', 'loudLoser'] as const) expect(PERSONAS[id].lines[k], `${id} ${k}`).toContain(raw);
  });
});
