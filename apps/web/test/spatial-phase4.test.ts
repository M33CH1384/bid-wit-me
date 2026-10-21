import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { IR_SPECS, ROOM_STYLES, irSpec, sessionRoom, surfaceHz } from '../src/spatial';
import { VENUES } from '@spades/protocol';

describe('spatial phase 4: unified room (seen = heard = named)', () => {
  it('one style per room for all 11 venues, each with reverb + surface character', () => {
    expect(ROOM_STYLES.map((r) => r.venue).sort()).toEqual([...VENUES].sort());
    for (const r of ROOM_STYLES) { expect(irSpec(r).seconds).toBeGreaterThan(0); expect(surfaceHz(r)).toBeGreaterThan(3000); }
    expect(Object.keys(IR_SPECS)).toHaveLength(5);
    expect(irSpec(ROOM_STYLES.find((r) => r.venue === 'vegas')!).seconds).toBeGreaterThan(irSpec(ROOM_STYLES.find((r) => r.venue === 'backyard')!).seconds * 4);
  });
  it('Auto rolls a room from the seed — and that room is the visual venue (deterministic, online-agreeing)', () => {
    const a = sessionRoom({ seed: 'game-42' });
    expect(sessionRoom({ seed: 'game-42' })).toEqual(a);
    expect(a.name.length).toBeGreaterThan(2);
    expect(ROOM_STYLES).toContain(a); // venue field on the style is what Table renders
  });
  it('resolver order: online venue > picked venue > Auto roll (the venue decides the sounds)', () => {
    expect(sessionRoom({ seed: 'game-42', onlineVenue: 'barbershop', visualVenue: 'yacht' }).venue).toBe('barbershop');
    expect(sessionRoom({ seed: 'game-42', visualVenue: 'mansion' }).venue).toBe('mansion'); // picked venue wins over the roll
    // the picked venue brings its whole signature: name, bed, reverb, surface
    const church = sessionRoom({ seed: 'game-42', visualVenue: 'church' });
    expect(church.name).toBe('Basement Spades Night'); expect(church.bed).toBe('basement');
  });
  it("Auto roll keeps The Pj's out unless the player has venue access", () => {
    const locked = new Set<string>();
    const open = new Set<string>();
    for (let i = 0; i < 400; i++) {
      locked.add(sessionRoom({ seed: `g${i}` }).venue);
      open.add(sessionRoom({ seed: `g${i}`, lockedVenues: true }).venue);
    }
    expect(locked.has('blockAfterDark')).toBe(false);
    expect(open.has('blockAfterDark')).toBe(true);
    // a picked venue is not a roll — the story stop's house venue (The Pj's) still wins outright
    expect(sessionRoom({ seed: 'g1', visualVenue: 'blockAfterDark' }).venue).toBe('blockAfterDark');
  });
  it('Auto can roll Classic (all 11 rooms in the pool)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(sessionRoom({ seed: `g${i}` }).venue);
    expect(seen.has('classic')).toBe(true);
    expect(seen.size).toBeGreaterThan(8);
  });
  it('loading + engine wiring: 3.0s minimum, room named, ambience starts under the loader', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('3000 - (performance.now() - loadShownAt.current)');
    expect(table).toContain('sound.applySoundscape(seed, online?.venue,');
    expect(table).toContain('const venue: VenueId = roomStyle.venue as VenueId');
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain('__bwmRoomPlaying'); // bed-start probe (fires on first unlock via wake->syncVenue)
    expect(audio).toContain('createConvolver');
  });
});
