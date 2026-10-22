import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pannerGainAt, seatCompensation, seatPoint, voiceLineGain } from '../src/spatial';
import { cameraFor } from '../src/three/layout';

describe('spatial phase 5: voices from seat, direction only', () => {
  it('near vs far voice loudness: full compensation — a far character is not quieter (within 15%)', () => {
    for (const view of ['sitting', 'standing'] as const) {
      const cam = cameraFor(390 / 844, false, view);
      const listener = { x: cam.pos[0]!, y: cam.pos[1]!, z: cam.pos[2]! };
      const eff = (pos: 'bottom' | 'top') => { const pt = seatPoint(pos, 4); const d = Math.hypot(pt.x - listener.x, pt.y - listener.y, pt.z - listener.z); return pannerGainAt(d) * seatCompensation(listener, pos, 4); };
      expect(Math.abs(eff('top') - eff('bottom')) / eff('bottom')).toBeLessThan(0.15);
    }
  });
  it('category volume is applied exactly once: voiceLineGain = caller x aiVoice category', () => {
    expect(voiceLineGain(0.54, { aiVoice: 1 } as never)).toBeCloseTo(0.54);
    expect(voiceLineGain(0.54, { aiVoice: 0.5 } as never)).toBeCloseTo(0.27);
    expect(voiceLineGain(0.54, undefined)).toBeCloseTo(0.54); // default category = 1, no hidden scaling
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const playVoice = audio.slice(audio.indexOf('playVoice('), audio.indexOf('/* ---------- table gate'));
    expect(playVoice).toContain('voiceLineGain(gain, this.settings.volumes)');
    expect((playVoice.match(/aiVoice/g) ?? []).length).toBeLessThanOrEqual(1); // never multiplied twice in the voice path
  });
  it('wiring: playVoice takes a seat, per-player mute gates speakBot, Table passes the speaker seat', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain('seat?: SeatPos, playerCount = 4): boolean');
    expect(audio).toContain('__bwmVoice');
    expect(audio).toContain('setVoiceMuted');
    const talk = readFileSync(new URL('../src/talkPrefs.ts', import.meta.url), 'utf8');
    expect(talk).toContain('if (sound.voiceMuted(name)) return;');
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('sound.playVoiceCrossTalk(b, gain, [0, b.duration], seatPos, n, l.name, { defer: true })');
    expect(table).toContain('voice-mute-');
  });
});
