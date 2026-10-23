import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT_NAMES, PERSONAS, PERSONA_VOICES, RUNDOWN_FIRST, RUNDOWN_KING_LEG2, RUNDOWN_RETURN_CLEAR, RUNDOWN_RETURN_LOSS, TEXT_ONLY_KINDS, type PersonaId, botTalk, kokoroGender, lineById, lineIdOf, newTalkState, personaForName, speakableLines, voiceFor } from '@spades/bots';
import { browserVoiceFor } from '../src/talkPrefs';

const pub = resolve(__dirname, '../public/voices/v2');
const IDS = Object.keys(PERSONAS) as PersonaId[];
const sprite = (key: string) => JSON.parse(readFileSync(`${pub}/${key}.json`, 'utf8')) as { voice: string; clips: Record<string, [number, number]> };

describe('recorded bot voices (v2 sprites)', () => {
  it('every persona has a female and a male sprite, both formats, recorded with the configured voice', () => {
    for (const id of IDS) for (const g of ['f', 'm'] as const) {
      const key = `${id}-${g}`;
      expect(existsSync(`${pub}/${key}.webm`), key).toBe(true);
      expect(existsSync(`${pub}/${key}.m4a`), key).toBe(true);
      const sp = sprite(key);
      expect(sp.voice).toBe(PERSONA_VOICES[id][g].voice);
      expect(kokoroGender(sp.voice)).toBe(g);
    }
  });
  it('every line every persona can say has a clip in each gender that can say it (bid lines: one per number)', () => {
    let n = 0;
    for (const id of IDS) for (const g of ['f', 'm'] as const) {
      const clips = sprite(`${id}-${g}`).clips;
      for (const l of speakableLines(id, g)) {
        if (l.raw === '…') continue; // the Silent Assassin's silence is text-only
        if (TEXT_ONLY_KINDS.includes(l.kind)) continue; // persona-memory lines (2026-10-23): text-only by design until a future bake records them — they stay in the corpus (speakableLines) so that bake can pick them up
        if (/^(You bid \{bid\} (for THAT|with WHAT)\?!|\{bid\}\? that.s a lot of books\.)$/.test(l.raw)) { for (let b = 1; b <= 13; b++) expect(clips[`${l.raw}#${b}`], `${id}-${g} ${l.raw}#${b}`).toBeDefined(); }
        else expect(clips[l.raw], `${id}-${g}: ${l.raw}`).toBeDefined();
        n++;
      }
    }
    expect(n).toBeGreaterThan(2000);
  });
  it("gendered self-references are only recorded in the matching voice (a male Big Papa has no 'mama' clip)", () => {
    for (const id of IDS) for (const g of ['f', 'm'] as const) {
      const clips = Object.keys(sprite(`${id}-${g}`).clips);
      for (const l of speakableLines(id)) if (l.self && l.self !== g) expect(clips, `${id}-${g}: ${l.raw}`).not.toContain(l.raw);
    }
    expect(Object.keys(sprite('mama-m').clips)).toContain("mm-hm. papa's thinking.");
    expect(Object.keys(sprite('mama-m').clips)).not.toContain("mm-hm. mama's thinking.");
  });
  it('line ids round-trip to the raw line', () => {
    for (const id of IDS) for (const l of speakableLines(id)) { expect(lineIdOf(id, l.kind, l.raw)).toBe(l.id); expect(lineById(l.id)).toBe(l.raw); }
  });
  it('every bot name speaks with a voice of its gender (recorded and browser fallback)', () => {
    const list = [{ name: 'Samantha' }, { name: 'Daniel' }, { name: 'Google US English' }, { name: 'Google UK English Male' }, { name: 'Karen' }, { name: 'Alex' }];
    for (const n of BOT_NAMES) {
      const v = voiceFor(personaForName(n), n);
      expect(kokoroGender(v.voice), n).toBe(v.gender);
      const b = browserVoiceFor(n, list as SpeechSynthesisVoice[]);
      const female = ['Samantha', 'Google US English', 'Karen'];
      if (b) expect(female.includes(b.name), `${n} → ${b.name}`).toBe(v.gender === 'f');
    }
  });
  it('a spoken line carries its id and maps to the speaker persona-gender sprite', () => {
    const names = ['You', ...BOT_NAMES.filter((n) => personaForName(n) === 'mama').slice(0, 1), ...BOT_NAMES.filter((n) => personaForName(n) === 'og').slice(0, 2)];
    const t = { seats: names.map((name, i) => ({ name, bot: i > 0 })), partnerships: true, teamNames: ['Us', 'Them'] };
    const l = botTalk(newTalkState(), t, { kind: 'cut', seat: 1 }, 100_000, () => 0)!;
    expect(l.line).toBeTruthy();
    const key = voiceFor(l.persona, l.name).key;
    expect(sprite(key).clips[lineById(l.line!)!]).toBeDefined();
  });
});

/**
 * Dee's Rundown scripts resolve in the SHIPPED lilcuz-f sprite — the
 * runtime lookup playClip actually performs (raw script text as the
 * manifest key), checked against the artifacts in this repo, not a
 * fixture. The 2026-10-22 meet-them silence was NOT a missing clip
 * (the panel paced by the clip's real duration — it resolved), but
 * this pin keeps it that way: a bake that drops or re-keys a rundown
 * segment fails here instead of on the owner's phone.
 */
describe("Dee's Rundown in the shipped sprite", () => {
  const dee = sprite('lilcuz-f');
  const soloScripts = [...Object.values(RUNDOWN_FIRST), ...Object.values(RUNDOWN_RETURN_LOSS), ...Object.values(RUNDOWN_RETURN_CLEAR), RUNDOWN_KING_LEG2];

  it('all 34 solo scripts are manifest keys with in-bounds segments', () => {
    expect(soloScripts).toHaveLength(34);
    const idx = JSON.parse(readFileSync(`${pub}/index.json`, 'utf8')) as { sprites: Record<string, { count: number; durationSec: number }> };
    const meta = idx.sprites['lilcuz-f']!;
    expect(Object.keys(dee.clips)).toHaveLength(meta.count); // the index and the manifest are one matched pair
    for (const text of soloScripts) {
      const seg = dee.clips[text];
      expect(seg, text.slice(0, 48)).toBeDefined();
      const [start, dur] = seg!;
      expect(dur).toBeGreaterThan(0);
      expect(start + dur).toBeLessThanOrEqual(meta.durationSec * 1000 + 500);
    }
  });

  it("the Porch first-meet is the segment the bake recorded (id 872b0ad54292)", () => {
    const text = RUNDOWN_FIRST['porch']!;
    const id = createHash('sha1').update(`dee|${text}`).digest('hex').slice(0, 12);
    expect(id).toBe('872b0ad54292');
    expect(dee.clips[text]).toEqual([2258710, 30410]);
  });
});
