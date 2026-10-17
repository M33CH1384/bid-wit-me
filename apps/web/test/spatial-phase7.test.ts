import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_CATEGORY_VOLUMES, normalizeCategoryVolumes } from '../src/spatial';

const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
const media = readFileSync(new URL('../src/online/Media.tsx', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');

describe('spatial phase 7: human voice chat', () => {
  it('voice-chat volume is a per-category slider wired to playerVoice', () => {
    expect(controls).toContain('testId="voice-chat-volume"');
    expect(controls).toContain('Voice chat volume');
    expect(controls).toContain('playerVoice: v');
    expect(normalizeCategoryVolumes({ playerVoice: 0.3 }).playerVoice).toBe(0.3);
    expect(DEFAULT_CATEGORY_VOLUMES.playerVoice).toBe(1);
  });
  it('playerVoice category is applied ONLY on the voice-chat bus (no double multiply)', () => {
    const hits = audio.split('\n').filter((l) => l.includes('playerVoice') && !l.trim().startsWith('*') && !l.trim().startsWith('/**'));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((l) => l.includes('voiceChatBus'))).toBe(true);
    // per-peer gain carries only mute/duck
    expect(audio).toContain("g.gain.value = opts?.muted ? 0 : opts?.ducked ? 0.4 : 1");
    expect(audio).not.toContain('voiceLineGain(gain, this.settings.volumes) * ');
  });
  it('AI voices: category applied exactly once in playVoice, callers pass only their gain (audit)', () => {
    expect(audio.match(/voiceLineGain\(gain, this\.settings\.volumes\)/g)).toHaveLength(1);
    const voices = readFileSync(new URL('../src/voices/voices.ts', import.meta.url), 'utf8');
    expect(voices).not.toContain('aiVoice');
  });
  it('remote streams route MediaStreamSource -> seat panner -> bus; element muted while routed (heard once)', () => {
    expect(audio).toContain('createMediaStreamSource');
    expect(audio).toContain('attachVoiceChat');
    expect(audio).toContain('seatPanner');
    expect(media).toContain('sound.attachVoiceChat');
    expect(media).toContain('muted={routed ? true : muted}');
    expect(media).toContain('sound.detachVoiceChat(id)');
  });
  it('per-player human mute persists via mutedVoices and never touches card SFX', () => {
    expect(media).toContain('sound.setVoiceMuted(id, !peerMuted)');
    expect(media).toContain('sound.voiceMuted(id)');
    const seg = audio.slice(audio.indexOf('attachVoiceChat'), audio.indexOf('detachAllVoiceChat'));
    expect(seg).not.toContain('sfxBus');
  });
  it('spatial off / no seat falls back to the plain bus (stereo), aiTalk default untouched', () => {
    expect(audio).toContain("} else g.connect(this.voiceChatBus);");
    const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
    expect(settings).toContain('aiTalk?: boolean'); // optional, unset = off
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('aiTalk: !!settings.aiTalk');
  });
});
