import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROOM_STYLES, TOURNAMENT_ROOM, sessionRoom } from '../src/spatial';

describe('spatial phase 8: settings UI + live volumes + Tournament', () => {
  it("Demetrius's named four rooms all exist", () => {
    const names = [...ROOM_STYLES.map((r) => r.name), TOURNAMENT_ROOM.name];
    for (const n of ['Backyard Cookout', 'Basement Spades Night', 'Barbershop', 'Competitive Tournament']) expect(names).toContain(n);
    expect(TOURNAMENT_ROOM.reverb).toBe('hall'); expect(TOURNAMENT_ROOM.crowd).toBe('arena');
    // the tournament-hall character (casino bed, hall reverb, arena crowd) rides the
    // Vegas room itself now that the venue decides the sounds — no separate pick
    const vegas = sessionRoom({ onlineVenue: 'vegas' });
    expect(vegas.bed).toBe('casino'); expect(vegas.reverb).toBe('hall'); expect(vegas.crowd).toBe('arena');
    expect(sessionRoom({ visualVenue: 'classic' }).venue).toBe('classic');
  });
  it('ambience slider updates LIVE: applyGain retargets a playing venue bed; syncVenue scales by category', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain("this.venueBus.gain.setTargetAtTime(0.38 * cats.ambience");
    expect(audio).toContain('0.38 * normalizeCategoryVolumes(this.settings.volumes).ambience, c.currentTime, 1.2');
  });
  it('Phase 8 UI has spatial/quality/effects/ambience (+ voice-chat volume added by Phase 7); the room picker is retired', () => {
    const ui = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
    const seg = ui.slice(ui.indexOf('export function SpatialFields'), ui.indexOf('export function SoundFields'));
    for (const t of ['spatial-switch', 'quality-seg', 'Effects volume', 'Ambience volume']) expect(seg).toContain(t);
    expect(seg).not.toContain('Voices volume'); expect(seg).toContain('Voice chat volume'); // Phase 7 control, distinct from Bot voices
    // owner, 2026-10-20: no soundscape picker — each venue's signature sounds are automatic
    expect(seg).not.toContain('soundscape-select'); expect(seg).not.toContain('Room (soundscape)'); expect(seg).not.toContain('Competitive Tournament');
  });
});
