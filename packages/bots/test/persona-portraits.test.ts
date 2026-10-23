import { describe, expect, it } from 'vitest';
import { BOT_NAMES, PERSONA_PORTRAITS, PERSONAS, personaForName, personaPortraitFor, voiceGender } from '../src';

/**
 * Persona portraits (owner, 2026-10-23: "give them faces"): every persona
 * ships a female and a male portrait, and a bot name resolves to the
 * portrait of its OWN persona in its OWN voice gender — the face can never
 * disagree with the voice or the plate tag.
 */
describe('persona portraits', () => {
  it('ships a female and a male portrait key for every persona', () => {
    const ids = Object.keys(PERSONAS);
    expect(ids).toHaveLength(19);
    expect(PERSONA_PORTRAITS).toHaveLength(ids.length * 2);
    expect(new Set(PERSONA_PORTRAITS).size).toBe(PERSONA_PORTRAITS.length);
    for (const id of ids) {
      expect(PERSONA_PORTRAITS).toContain(`${id}-f`);
      expect(PERSONA_PORTRAITS).toContain(`${id}-m`);
    }
  });

  it('resolves every bot name to the portrait of its persona + voice gender', () => {
    for (const name of BOT_NAMES) {
      expect(personaPortraitFor(name)).toBe(
        `/assets/personas/portraits/${personaForName(name)}-${voiceGender(name)}.webp`,
      );
    }
  });

  it('hand-picked name → persona assignments stay face-true', () => {
    expect(personaPortraitFor('Big Mike')).toBe('/assets/personas/portraits/hothead-m.webp');
    expect(personaPortraitFor('Queenie')).toBe('/assets/personas/portraits/mama-f.webp');
    expect(personaPortraitFor('Auntie Pat')).toBe('/assets/personas/portraits/storyteller-f.webp');
    expect(personaPortraitFor('Unc')).toBe('/assets/personas/portraits/og-m.webp');
    expect(personaPortraitFor('Ace')).toBe('/assets/personas/portraits/gambler-m.webp');
    expect(personaPortraitFor('Smoke')).toBe('/assets/personas/portraits/smooth-m.webp');
  });
});
