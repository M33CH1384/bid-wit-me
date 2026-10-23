import { describe, expect, it } from 'vitest';
import { CHAT_BLIP_TONES, DM_CHIME_TONES, chatSoundsOn, type SoundSettings } from '../src/audio';
import { CHAT_SOUND_THROTTLE_MS, chatSoundDecision, type ChatSoundGate } from '../src/social/chatSounds';

const gate = (p: Partial<ChatSoundGate> = {}): ChatSoundGate => ({
  kind: 'dm', own: false, pageVisible: true, chatViewOpen: false, enabled: true, now: 100_000, lastPlayedAt: 0, ...p,
});

describe('chatSoundDecision — DM', () => {
  it('plays for a live incoming DM anywhere in the app (chat view irrelevant)', () => {
    expect(chatSoundDecision(gate({ chatViewOpen: false }))).toBe(true);
    expect(chatSoundDecision(gate({ chatViewOpen: true }))).toBe(true);
  });
  it('never plays for my own message', () => {
    expect(chatSoundDecision(gate({ own: true }))).toBe(false);
  });
  it('stays silent while the page is hidden (push covers the background)', () => {
    expect(chatSoundDecision(gate({ pageVisible: false }))).toBe(false);
  });
  it('stays silent when chat sounds are disabled', () => {
    expect(chatSoundDecision(gate({ enabled: false }))).toBe(false);
  });
});

describe('chatSoundDecision — global chat', () => {
  it('plays only while the chat view is open', () => {
    expect(chatSoundDecision(gate({ kind: 'global', chatViewOpen: true }))).toBe(true);
    expect(chatSoundDecision(gate({ kind: 'global', chatViewOpen: false }))).toBe(false);
  });
  it('never plays for my own message, even with the view open', () => {
    expect(chatSoundDecision(gate({ kind: 'global', chatViewOpen: true, own: true }))).toBe(false);
  });
  it('stays silent while the page is hidden, even with the view open', () => {
    expect(chatSoundDecision(gate({ kind: 'global', chatViewOpen: true, pageVisible: false }))).toBe(false);
  });
});

describe('chatSoundDecision — mention', () => {
  it('blips wherever you are in the app (chat view irrelevant, like a DM)', () => {
    expect(chatSoundDecision(gate({ kind: 'mention', chatViewOpen: false }))).toBe(true);
    expect(chatSoundDecision(gate({ kind: 'mention', chatViewOpen: true }))).toBe(true);
  });
  it('never for my own line, while hidden, or when sounds are off', () => {
    expect(chatSoundDecision(gate({ kind: 'mention', own: true }))).toBe(false);
    expect(chatSoundDecision(gate({ kind: 'mention', pageVisible: false }))).toBe(false);
    expect(chatSoundDecision(gate({ kind: 'mention', enabled: false }))).toBe(false);
  });
  it('throttles on its own per-kind stamp', () => {
    const now = 100_000;
    expect(chatSoundDecision(gate({ kind: 'mention', now, lastPlayedAt: now - 10 }))).toBe(false);
    expect(chatSoundDecision(gate({ kind: 'mention', now, lastPlayedAt: now - CHAT_SOUND_THROTTLE_MS }))).toBe(true);
  });
});

describe('chatSoundDecision — throttle', () => {
  it('blocks a replay inside the window and allows it after', () => {
    const now = 100_000;
    expect(chatSoundDecision(gate({ now, lastPlayedAt: now - CHAT_SOUND_THROTTLE_MS + 1 }))).toBe(false);
    expect(chatSoundDecision(gate({ now, lastPlayedAt: now - CHAT_SOUND_THROTTLE_MS }))).toBe(true);
  });
  it('the window is per kind: a DM does not throttle a global blip decision', () => {
    // lastPlayedAt is tracked per kind by the player; the decision itself only sees its own kind's stamp
    expect(chatSoundDecision(gate({ kind: 'global', chatViewOpen: true, lastPlayedAt: 0 }))).toBe(true);
  });
});

describe('chatSoundsOn — the setting', () => {
  const base: SoundSettings = { on: true, volume: 0.7, ambient: false, music: true, musicVolume: 0.5, venueSound: true };
  it('defaults on when the flag is absent', () => {
    expect(chatSoundsOn(base)).toBe(true);
  });
  it('off when the player turned chat sounds off', () => {
    expect(chatSoundsOn({ ...base, chatSounds: false })).toBe(false);
  });
  it('off whenever master sound is off', () => {
    expect(chatSoundsOn({ ...base, on: false })).toBe(false);
    expect(chatSoundsOn({ ...base, on: false, chatSounds: true })).toBe(false);
  });
});

describe('the two sounds are distinct by construction', () => {
  const span = (tones: typeof DM_CHIME_TONES) => tones.reduce((m, t) => Math.max(m, t.at + t.dur), 0);
  const peak = (tones: typeof DM_CHIME_TONES) => Math.max(...tones.map((t) => t.gain));
  it('use different pitches (no shared fundamental)', () => {
    const dm = new Set(DM_CHIME_TONES.map((t) => t.freq));
    for (const t of CHAT_BLIP_TONES) expect(dm.has(t.freq)).toBe(false);
  });
  it('the DM sound is a two-note chime; the global sound is a single blip', () => {
    expect(new Set(DM_CHIME_TONES.map((t) => t.at)).size).toBe(2);
    expect(CHAT_BLIP_TONES.length).toBe(1);
  });
  it('the global blip is quieter, lower and shorter than the DM chime', () => {
    expect(peak(CHAT_BLIP_TONES)).toBeLessThan(peak(DM_CHIME_TONES));
    expect(Math.max(...CHAT_BLIP_TONES.map((t) => t.freq))).toBeLessThan(Math.min(...DM_CHIME_TONES.map((t) => t.freq)));
    expect(span(CHAT_BLIP_TONES)).toBeLessThan(span(DM_CHIME_TONES));
  });
});
