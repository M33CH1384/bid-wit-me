import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { VENUES } from '@spades/protocol';
import { BOT_NAMES, PERSONAS, type PersonaId, personaForName, voiceGender } from '@spades/bots';
import { ROOM_STYLES, TOURNAMENT_ROOM, audioIdentityForVenue, styleForVenue } from '../src/spatial';
import { VENUE_DEFS } from '../src/venues';
import { TRACKS } from '../src/audio';
import { personaVoiceFor } from '../src/talkPrefs';

/**
 * Venue audio identity + character voice consistency (owner, 2026-10-21: "each venue
 * should have its own feel audibly — from the characters to the ambiance — and should
 * be consistent"). ROOM_STYLES is the ONE definition of how a venue sounds; characters
 * resolve their voice from their persona id, the same key on the recorded and the
 * Web Speech path.
 */
describe('venue audio identity', () => {
  it('every venue resolves a complete identity (bed, room, music, events)', () => {
    expect(ROOM_STYLES.map((r) => r.venue).sort()).toEqual([...VENUES].sort());
    for (const v of VENUES) {
      const id = audioIdentityForVenue(v)!;
      expect(id, v).toBeTruthy();
      expect(id).toBe(styleForVenue(v));
      expect(id.bed, v).toBeTruthy();
      expect(id.surface, v).toBeTruthy();
      expect(id.reverb, v).toBeTruthy();
      expect(id.crowd, v).toBeTruthy();
      expect(id.music, v).toBeTruthy();
      expect(Array.isArray(id.events), v).toBe(true);
      // a venue's music character: a pin, or at least two signature tracks to open with
      if (!id.music.pin) expect(id.music.lean.length, v).toBeGreaterThanOrEqual(2);
    }
    expect(TOURNAMENT_ROOM.music).toBeTruthy();
    expect(Array.isArray(TOURNAMENT_ROOM.events)).toBe(true);
  });

  it("the visual venue def and the heard identity agree on the bed (one definition)", () => {
    for (const v of VENUES) expect(VENUE_DEFS[v].bed, v).toBe(audioIdentityForVenue(v)!.bed);
  });

  it("only The Pj's pins its music, and its track is real", () => {
    for (const v of VENUES) {
      const id = audioIdentityForVenue(v)!;
      if (v === 'blockAfterDark') expect(id.music.pin).toBe('marty-gots-a-plan');
      else expect(id.music.pin, v).toBeUndefined();
    }
  });

  it('every lean/pin track file exists in the playlist (no tracks added or removed)', () => {
    const files = new Set(TRACKS.map((t) => t.file));
    for (const r of ROOM_STYLES) {
      if (r.music.pin) expect(files.has(r.music.pin), `${r.venue} pin`).toBe(true);
      for (const f of r.music.lean) expect(files.has(f), `${r.venue} lean ${f}`).toBe(true);
    }
  });

  it("only The Pj's carries ambient events — the drive-by and the calm headlight pass", () => {
    for (const v of VENUES) {
      const id = audioIdentityForVenue(v)!;
      if (v === 'blockAfterDark') expect([...id.events].sort()).toEqual(['driveby', 'headlights']);
      else expect(id.events, v).toEqual([]);
    }
  });

  it('the engine reads music and events from the identity, and menus clear it (no bleed)', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain('roomStyle?.music');
    expect(audio).not.toContain("roomStyle?.venue === 'blockAfterDark'");
    expect(audio).toContain("streetEvents.includes('driveby')");
    expect(audio).toContain("streetEvents.includes('headlights')");
    expect(audio).toContain('leanArmed = style.music.lean.length > 0');
    expect(audio).toContain("if (ctx === 'menu') { this.roomStyle = null; this.leanArmed = false; }");
  });
});

describe('character voice consistency (Web Speech path)', () => {
  const list = ['Daniel', 'Kate', 'Samantha', 'Alex', 'James', 'Hazel', 'George', 'Catherine', 'Google UK English Male', 'Google UK English Female']
    .map((name) => ({ name })) as unknown as SpeechSynthesisVoice[];
  const MALE = new Set(['Daniel', 'Alex', 'James', 'George', 'Google UK English Male']);

  it("the persona's preferred voice wins, gender-filtered", () => {
    expect(personaVoiceFor('professor', 'Unc', list)?.name).toBe('Daniel');
    expect(personaVoiceFor('professor', 'Auntie Pat', list)?.name).toBe('Kate'); // Daniel is male: skipped for her
    expect(personaVoiceFor('storyteller', 'Auntie Pat', list)?.name).toBe('Hazel');
    // Gambler prefers George (m) then Catherine (f): Queenie still gets a female voice
    expect(personaVoiceFor('gambler', 'Queenie', list)?.name).toBe('Catherine');
    expect(personaVoiceFor('gambler', 'Big Mike', list)?.name).toBe('George');
  });

  it('the same character resolves the same voice every time, of the name’s gender', () => {
    for (const n of BOT_NAMES) {
      const persona: PersonaId = personaForName(n);
      const a = personaVoiceFor(persona, n, list);
      expect(personaVoiceFor(persona, n, list), n).toEqual(a);
      if (a) expect(MALE.has(a.name), `${n} → ${a.name}`).toBe(voiceGender(n) === 'm');
    }
  });

  it('falls back to the name-stable pick when no preferred voice is on the device', () => {
    const sparse = [{ name: 'Samantha' }, { name: 'Daniel' }] as unknown as SpeechSynthesisVoice[];
    expect(personaVoiceFor('deacon', 'Queenie', sparse)?.name).toBe('Samantha');
    expect(personaVoiceFor('deacon', 'Marcus', sparse)?.name).toBe('Daniel');
  });

  it('every persona carries a distinct Web Speech character', () => {
    const seen = new Set<string>();
    for (const id of Object.keys(PERSONAS) as PersonaId[]) {
      const v = PERSONAS[id].voice;
      expect(v.prefer.length, id).toBeGreaterThan(0);
      const key = `${v.pitch}|${v.rate}|${v.prefer.join(',')}`;
      expect(seen.has(key), id).toBe(false);
      seen.add(key);
    }
  });

  it('speakBot hands the clip-resolved persona to the Web Speech fallback (one character, both paths)', () => {
    const talk = readFileSync(new URL('../src/talkPrefs.ts', import.meta.url), 'utf8');
    expect(talk).toContain('webSpeech(name, text, per)');
    expect(talk).toContain('personaVoiceFor(persona, name, voices)');
  });
});
