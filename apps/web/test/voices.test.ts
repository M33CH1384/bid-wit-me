import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMON, PERSONAS, type PersonaId, botTalk, lineById, lineIdOf, newTalkState, personaForName, BOT_NAMES } from '@spades/bots';
import manifest from '../src/voices/manifest.json';
import { clipFor, unmatchedLines } from '../src/voices/voices';

const pub = resolve(__dirname, '../public/voices');
const lookup = (manifest as { lookup: Record<string, Record<string, string[]>> }).lookup;

describe('recorded bot voices', () => {
  it('every manifest entry has both formats on disk', () => {
    let n = 0;
    for (const lines of Object.values(lookup)) for (const stems of Object.values(lines)) for (const s of stems) {
      expect(existsSync(`${pub}/${s}.webm`), s).toBe(true);
      expect(existsSync(`${pub}/${s}.m4a`), s).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(600);
  });

  it('line ids round-trip to the raw line, and most lines map to a clip', () => {
    let total = 0;
    for (const persona of Object.keys(PERSONAS) as PersonaId[]) {
      for (const [kind, list] of Object.entries(PERSONAS[persona].lines)) for (const raw of list as string[]) {
        const id = lineIdOf(persona, kind as never, raw)!;
        expect(lineById(id)).toBe(raw);
        total++;
      }
    }
    for (const [kind, list] of Object.entries(COMMON)) for (const raw of list as string[]) expect(lineById(lineIdOf('og', kind as never, raw)!)).toBe(raw);
    // every line has a clip (new lines fall back to Web Speech until recorded: bwm-voices scripts/generate_missing.py)
    expect(total).toBeGreaterThan(100);
    expect(unmatchedLines()).toBe(0);
  });

  it('a spoken line carries its id and resolves to that persona\'s clip; Clean talk picks the clean take', () => {
    const names = ['You', ...BOT_NAMES.filter((n) => personaForName(n) === 'mama').slice(0, 1), ...BOT_NAMES.filter((n) => personaForName(n) === 'og').slice(0, 2)];
    const t = { seats: names.map((name, i) => ({ name, bot: i > 0 })), partnerships: true, teamNames: ['Us', 'Them'] };
    const l = botTalk(newTalkState(), t, { kind: 'cut', seat: 1 }, 100_000, () => 0)!;
    expect(l.line).toBeTruthy();
    expect(clipFor(l.persona, lineById(l.line!), true)).toMatch(new RegExp(`^${l.persona}/`));
    expect(clipFor('hustler', 'newbie my ass 😈', true)).toBe('hustler/hustler.reveal.1.clean');
    expect(clipFor('hustler', 'newbie my ass 😈', false)).toBe('hustler/hustler.reveal.1');
    expect(clipFor('mama', 'a line that was never recorded', false)).toBeNull();
  });
});
