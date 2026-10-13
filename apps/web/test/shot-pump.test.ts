import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shotgun pump cue', () => {
  it('plays from the shared state through the volume bus, which stays quiet while muted', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('newlyOneTrickFromShot');
    expect(table).toContain("sound.play('pump'");
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const play = audio.slice(audio.indexOf('play(name: Sfx'), audio.indexOf('private sample'));
    expect(play.indexOf('if (!this.settings.on')).toBeGreaterThan(-1);
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'pump'"));
    expect(play).toContain("case 'pump': return this.shotgunPump");
    expect(audio).toContain('no sampled recording');
  });
});
