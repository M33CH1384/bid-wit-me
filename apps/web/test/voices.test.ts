import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT_NAMES, PERSONAS, PERSONA_VOICES, type PersonaId, botTalk, kokoroGender, lineById, lineIdOf, newTalkState, personaForName, speakableLines, voiceFor } from '@spades/bots';
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
  it('every line every persona can say has a clip in both genders (bid lines: one per number)', () => {
    let n = 0;
    for (const id of IDS) for (const g of ['f', 'm'] as const) {
      const clips = sprite(`${id}-${g}`).clips;
      for (const l of speakableLines(id)) {
        if (l.raw === '…') continue; // the Silent Assassin's silence is text-only
        if (/^You bid \{bid\}/.test(l.raw)) { for (let b = 1; b <= 13; b++) expect(clips[`${l.raw}#${b}`], `${id}-${g} ${l.raw}#${b}`).toBeDefined(); }
        else expect(clips[l.raw], `${id}-${g}: ${l.raw}`).toBeDefined();
        n++;
      }
    }
    expect(n).toBeGreaterThan(2000);
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
