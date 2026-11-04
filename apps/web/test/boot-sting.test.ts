/**
 * App-open sting — RETIRED TRIGGER contract (owner, 2026-11-04).
 *
 * The first cut fired the sting from a latch in wake() on the first unlock.
 * On the owner's device it fired late (only once the audio-settings path
 * woke the engine), the asset's slam never landed, and the sound itself was
 * rejected ("sounds horrible"). The trigger and its home-reveal wiring were
 * removed the same day. The sting returns splash-driven — a "Touch to
 * begin" splash whose tap unlocks audio, starts a RE-PICKED sting, and runs
 * the fade/snap choreography — and these pins hold the line until then:
 *  - no boot latch anywhere in the engine: no maybeBootSting, no
 *    'bwm:bootsting' dispatch, no BOOT_SLAM_MS / BOOT_STING_* constants;
 *  - the deckSlam one-shot stays REGISTERED (Sfx member, FILES entry,
 *    UI_SFX membership, play() case) so the splash wire-in only has to
 *    call it — SFX_COUNT is unchanged;
 *  - the audibility gate (bootStingAudible, audioSession.ts) is kept and
 *    its pins are unchanged — the splash consults it before firing;
 *  - the old reveal module is gone and neither Setup nor styles carry any
 *    reveal wiring (no useBootReveal, no [data-boot-reveal]).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { bootStingAudible } from '../src/audioSession';

const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/Setup.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('app-open sting: the retired trigger stays retired', () => {
  it('no boot latch, no reveal event, no slam constants in the engine', () => {
    expect(audio).not.toContain('maybeBootSting');
    expect(audio).not.toContain('bwm:bootsting');
    expect(audio).not.toContain('BOOT_SLAM_MS');
    expect(audio).not.toContain('BOOT_STING_EVENT');
    expect(audio).not.toContain('BOOT_STING_WINDOW_MS');
    expect(audio).not.toContain('bootStingFired');
    expect(audio).not.toContain('bootStingAudible'); // the gate lives in audioSession.ts only
  });

  it('the old reveal module is absent', () => {
    expect(existsSync(new URL('../src/bootReveal.ts', import.meta.url))).toBe(false);
  });

  it('no reveal wiring in Setup or styles', () => {
    expect(setup).not.toContain('useBootReveal');
    expect(setup).not.toContain('bootReveal');
    expect(styles).not.toContain('data-boot-reveal');
  });
});

describe('app-open sting: the slot stays registered for the splash wire-in', () => {
  it('deckSlam is a registered recorded one-shot in the event-SFX family', () => {
    expect(audio).toContain("'deckSlam'");
    expect(audio).toContain("deckSlam: ['deck-slam']"); // FILES registry -> SFX_COUNT derives
    expect(audio).toContain("case 'deckSlam': return this.sample('deckSlam', t, 0.95 * g)");
    const credits = readFileSync(new URL('../../../CREDITS.md', import.meta.url), 'utf8');
    expect(credits).toContain('deck-slam.mp3');
  });

  it('may sound away from a table (UI_SFX) — it plays on the home screen', () => {
    expect(audio).toContain("'dmChime', 'chatBlip', 'deckSlam'");
  });
});

describe('app-open sting: the audibility gate (kept for the splash)', () => {
  it('master off, zero volume or a zeroed sfx category all mean silence', () => {
    expect(bootStingAudible(true, 0.7, 1)).toBe(true);
    expect(bootStingAudible(true, 0.7, 0.5)).toBe(true);
    expect(bootStingAudible(false, 0.7, 1)).toBe(false);
    expect(bootStingAudible(true, 0, 1)).toBe(false);
    expect(bootStingAudible(true, 0.7, 0)).toBe(false);
  });
});
