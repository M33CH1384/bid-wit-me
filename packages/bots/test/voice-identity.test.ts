import { describe, expect, it } from 'vitest';
import { BOT_NAMES, PERSONAS, PERSONA_VOICES, type PersonaId, kokoroGender, personaForName, voiceFor, voiceGender } from '../src/index';

const IDS = Object.keys(PERSONAS) as PersonaId[];

/**
 * Character voice consistency (owner, 2026-10-21: a character should sound like itself
 * everywhere). The persona id is the voice key on every path — recorded Kokoro clips
 * (PERSONA_VOICES) and the Web Speech character (PERSONAS[id].voice) — and the name →
 * persona map is deterministic, so the same bot is the same voice at every table.
 */
describe('persona voice identity', () => {
  it('every persona has a recorded voice for each gender, of that gender', () => {
    for (const id of IDS) for (const g of ['f', 'm'] as const) {
      const v = PERSONA_VOICES[id][g];
      expect(v, `${id}-${g}`).toBeTruthy();
      expect(kokoroGender(v.voice), `${id}-${g}: ${v.voice}`).toBe(g);
      expect(v.speed, `${id}-${g}`).toBeGreaterThan(0.5);
      expect(v.speed, `${id}-${g}`).toBeLessThan(1.5);
    }
  });

  it('personas that share a base recorded voice are told apart by speed', () => {
    for (const g of ['f', 'm'] as const) {
      const seen = new Map<string, PersonaId>();
      for (const id of IDS) {
        const v = PERSONA_VOICES[id][g];
        const key = `${v.voice}@${v.speed}`;
        expect(seen.get(key), `${id}-${g} collides with ${seen.get(key)}`).toBeUndefined();
        seen.set(key, id);
      }
    }
  });

  it('voiceFor is deterministic and gender-true for every bot name', () => {
    for (const n of BOT_NAMES) {
      const persona = personaForName(n);
      expect(personaForName(n), n).toBe(persona); // same name → same character, every visit
      const a = voiceFor(persona, n);
      expect(voiceFor(persona, n), n).toEqual(a);
      expect(a.gender, n).toBe(voiceGender(n));
      expect(kokoroGender(a.voice), n).toBe(a.gender);
      expect(a.key, n).toBe(`${persona}-${a.gender}`);
    }
  });

  it('every persona has a complete, distinct Web Speech character (pitch / rate / preferred voices)', () => {
    const triples = new Set<string>();
    for (const id of IDS) {
      const v = PERSONAS[id].voice;
      expect(v.prefer.length, `${id} needs preferred system voices`).toBeGreaterThan(0);
      expect(v.pitch, id).toBeGreaterThanOrEqual(0.5);
      expect(v.pitch, id).toBeLessThanOrEqual(2);
      expect(v.rate, id).toBeGreaterThanOrEqual(0.5);
      expect(v.rate, id).toBeLessThanOrEqual(1.6);
      const triple = `${v.pitch}|${v.rate}|${v.prefer.join(',')}`;
      expect(triples.has(triple), `${id} shares its whole Web Speech character with another persona`).toBe(false);
      triples.add(triple);
    }
  });
});
