import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROOM_STYLES, TOURNAMENT_ROOM, sessionRoom } from '../src/spatial';

describe('spatial phase 8: settings UI + live volumes + Tournament', () => {
  it("Demetrius's named four rooms all exist", () => {
    const names = [...ROOM_STYLES.map((r) => r.name), TOURNAMENT_ROOM.name];
    for (const n of ['Backyard Cookout', 'Basement Spades Night', 'Barbershop', 'Competitive Tournament']) expect(names).toContain(n);
    expect(sessionRoom({ storyRoom: 'tournament' }).name).toBe('Competitive Tournament');
    expect(TOURNAMENT_ROOM.reverb).toBe('hall'); expect(TOURNAMENT_ROOM.crowd).toBe('arena');
    expect(sessionRoom({ storyRoom: 'classic' }).venue).toBe('classic');
  });
  it('ambience slider updates LIVE: applyGain retargets a playing venue bed; syncVenue scales by category', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain("this.venueBus.gain.setTargetAtTime(0.38 * cats.ambience");
    expect(audio).toContain('0.38 * normalizeCategoryVolumes(this.settings.volumes).ambience, c.currentTime, 1.2');
  });
  it('Phase 8 UI has spatial/quality/room/effects/ambience — and NO voice-chat volume (Phase 7 owns that)', () => {
    const ui = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
    const seg = ui.slice(ui.indexOf('export function SpatialFields'), ui.indexOf('export function SoundFields'));
    for (const t of ['spatial-switch', 'quality-seg', 'soundscape-select', 'Effects volume', 'Ambience volume', 'Competitive Tournament']) expect(seg).toContain(t);
    expect(seg).not.toContain('Voices volume'); expect(seg.toLowerCase()).not.toContain('voice chat');
  });
});
