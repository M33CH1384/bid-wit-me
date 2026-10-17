import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
const intermission = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');

describe('white sheet rolls down from its own scorecard', () => {
  it('no longer slides in from the top: the old screen-top drop is gone', () => {
    expect(css).not.toContain('sheet-drop');
    expect(css).not.toContain('translate3d(0, -110%, 0)');
  });
  it('unfurls downward anchored to the scorecard top edge (transform origin at the top)', () => {
    expect(css).toContain('.tt-team.sheet-in .shroud { transform-origin: 50% 0; animation: sheet-roll 620ms');
    const roll = css.slice(css.indexOf('@keyframes sheet-roll {'), css.indexOf('@keyframes sheet-roll-edge'));
    expect(roll).toContain('transform: scaleY(0)');
    expect(roll).toContain('transform: scaleY(1)');
    expect(roll).not.toContain('translate');
    // the shroud lives inside each scorecard (.tt-team), so every sheet rolls from its own card
    expect(css).toContain('.tt-team.sheet-in .shroud::after'); // the moving roll edge
  });
  it('the roll wait (400ms) is kept so the punch lands first, and reduced motion snaps', () => {
    expect(css).toContain('.tt-team.sheet-in.sheet-wait .shroud::after');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) { .tt-team.notice.tape-in'));
    expect(reduced).toContain('.tt-team.sheet-in .shroud, .police-rim { animation: none; }');
    expect(css).toContain('.tt-team.sheet-in .shroud::after { animation: none; opacity: 0; }');
  });
  it('cloth sound: free synthesized fabric rustle on the sfx bus (settings/mute/category apply)', () => {
    expect(audio).toContain("| 'cloth';");
    expect(audio).toContain("case 'cloth': return this.clothRustle(t, g);");
    const rustle = audio.slice(audio.indexOf('private clothRustle'), audio.indexOf('private chime'));
    expect(rustle).toContain('this.noise(1)'); // synthesized noise, no sample file
    expect(rustle).toContain('this.sfxBus!'); // routed through the normal sfx path
    expect(rustle).not.toMatch(/\.mp3|\.wav|fetch\(/);
  });
  it('the rustle is timed to the roll and only plays when a roll actually animates', () => {
    expect(intermission).toContain("if (anim.current?.waitSheet.size) sound.play('cloth', { delay });");
    expect(css).toContain('animation: sheet-roll 620ms'); // CSS and sound share the 620ms roll
  });
});
