import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Nil bust shotgun', () => {
  it('plays the shotgun from the synced Nil-bust trigger, through mute and volume', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const cue = table.slice(table.indexOf('nilBustsJustResolved(prev'), table.indexOf('}, [st]);', table.indexOf('nilBustsJustResolved(prev')));
    expect(cue).toContain('nilBustsJustResolved(prev, st, nilBusted.current)');
    expect(cue).toContain("sound.play('shotgun'");
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const play = audio.slice(audio.indexOf('play(name: Sfx'), audio.indexOf('private sample'));
    expect(play.indexOf('if (!this.settings.on')).toBeGreaterThan(-1);
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'shotgun'"));
    expect(play).toContain("case 'shotgun': return this.shotgunBoom");
    expect(audio).toContain('this.settings.volume');
    expect(audio).toContain('Goes out the sfx bus, so mute and volume apply');
    const recap = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    expect(recap).toContain('!s.nils.some((n) => !n.made)');
    expect(recap).toContain('data-blast');
    // the recap's set slot is the earned SetCover now (tape retired 2026-10-21)
    expect(recap).toContain('SetCover');
  });
});
