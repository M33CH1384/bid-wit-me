import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Source guards (node env): Block Party is offered only in menus, built only from synth, never a venue bed. */
describe('Block Party wiring', () => {
  const controls = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  it('offered in the menu sound fields, and in the sound sheet only while in the menu context', () => {
    expect(controls).toContain('data-testid="block-party-switch"');
    expect(controls).toContain("s.soundContext === 'menu'");
    expect(controls).toContain('menu / celebration screens only');
  });
  it('is not a venue/soundscape bed (so a room change in-game can never start it)', () => {
    expect(audio).not.toContain("'blockparty'");
    expect(audio).toContain('private buildBlockParty()');
    expect(audio).toContain("ctx === 'menu'");
  });
  it('the bed is loopable synthesis: looped noise sources + recurring timers, no audio assets', () => {
    expect(audio).toContain('src.loop = true');
    expect(audio).toContain('private buildBlockParty()');
    expect(audio).not.toMatch(/blockParty[^;]*\.(mp3|wav|ogg)/);
  });
  it('later approved scenes are NOT built here (noted only): no new scene pickers or beds beyond Block Party', () => {
    for (const later of ['Kitchen-Table Spades Night', 'Front Porch', 'Beauty Salon', 'Park Dominoes', 'Fish Fry']) {
      expect(controls + audio).not.toContain(later);
    }
  });
});
