import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIO_ELEMENT_CAP, AudioElementPool } from '../src/audioPool';
import { RECREATE_COOLDOWN_MS, RESTORE_HEAL_MS, audioContextAction, recreateDue, settleAudio, soundRestorePending, speakerAriaLabel } from '../src/audioSession';

function fakeAudio() {
  return {
    src: '',
    paused: false,
    loads: 0,
    pause() { this.paused = true; },
    load() { this.loads++; },
    removeAttribute(name: string) { if (name === 'src') this.src = ''; },
  };
}

describe('iOS audio session', () => {
  it('rebuilds an interrupted or closed context and resumes a suspended one', () => {
    expect(audioContextAction('running')).toBe('ok');
    expect(audioContextAction('suspended')).toBe('resume');
    expect(audioContextAction('interrupted')).toBe('recreate');
    expect(audioContextAction('closed')).toBe('recreate');
    expect(audioContextAction(null)).toBe('resume');
  });

  it('swallows a rejected resume or close so the page does not see an unhandled rejection', async () => {
    const rejection = Promise.reject(new Error('Failed to start the audio device'));
    await expect(settleAudio(rejection)).resolves.toBeUndefined();
    await expect(settleAudio(undefined)).resolves.toBeUndefined();
    await expect(settleAudio(Promise.resolve('running'))).resolves.toBeUndefined();
  });

  it('marks the header speaker only after unlock, while sound is still wanted and the context is not running', () => {
    expect(soundRestorePending('suspended', false, true)).toBe(false);
    expect(soundRestorePending('suspended', true, false)).toBe(false);
    expect(soundRestorePending('running', true, true)).toBe(false);
    expect(soundRestorePending('suspended', true, true)).toBe(true);
    expect(soundRestorePending('interrupted', true, true)).toBe(true);
  });

  it('does not allocate past the iOS element cap, and frees a slot on release', () => {
    const made: ReturnType<typeof fakeAudio>[] = [];
    const pool = new AudioElementPool(AUDIO_ELEMENT_CAP, () => { const el = fakeAudio(); made.push(el); return el; });
    const live = [];
    for (let i = 0; i < AUDIO_ELEMENT_CAP; i++) live.push(pool.acquire()!);
    expect(pool.acquire()).toBeNull();
    expect(pool.exhausted).toBe(1);
    expect(pool.inUse).toBe(AUDIO_ELEMENT_CAP);
    const first = live[0]!;
    pool.release(first);
    expect(first.paused).toBe(true);
    expect(first.src).toBe('');
    expect(first.loads).toBe(1);
    const again = pool.acquire();
    expect(again).toBe(first);
    expect(made).toHaveLength(AUDIO_ELEMENT_CAP);
  });

  it('retires a media-element source instead of handing it to the next context', () => {
    const pool = new AudioElementPool(2, fakeAudio);
    const bound = pool.acquire()!;
    pool.retire(bound);
    expect(bound.loads).toBe(1);
    expect(pool.inUse).toBe(0);
    const fresh = pool.acquire();
    expect(fresh).not.toBe(bound);
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
  });

  it('rate-limits context rebuilds while an interruption persists, and heals on a short cadence', () => {
    // first rebuild is always due; the next one waits out the cooldown so a stuck
    // 'interrupted' state cannot churn rebuilds (each copies every decoded buffer)
    expect(recreateDue(0, RECREATE_COOLDOWN_MS)).toBe(true);
    expect(recreateDue(10_000, 10_000 + RECREATE_COOLDOWN_MS - 1)).toBe(false);
    expect(recreateDue(10_000, 10_000 + RECREATE_COOLDOWN_MS)).toBe(true);
    // the self-heal retry is prompt (seconds, not a settings visit) but not a busy loop
    expect(RESTORE_HEAL_MS).toBeGreaterThan(0);
    expect(RESTORE_HEAL_MS).toBeLessThanOrEqual(5000);
  });

  it('wires self-recovery into the engine: statechange re-syncs, a heal timer retries, utterances hand recovery back', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const talk = readFileSync(new URL('../src/talkPrefs.ts', import.meta.url), 'utf8');
    // a context returning to 'running' on its own re-syncs the stems its rebuild tore down
    expect(audio).toContain('resyncAll');
    expect(audio).toContain("if (this.liveState(c) === 'running') this.resyncAll();");
    // while a restore is pending the engine retries wake('show') on the heal cadence
    expect(audio).toContain('syncHealTimer');
    expect(audio).toContain('RESTORE_HEAL_MS');
    // rebuilds from both wake and the state watcher respect the same cooldown
    expect(audio).toContain('recreateDue');
    // a Web Speech utterance (iOS seizes the audio session for it) drives recovery when it ends
    expect(talk).toContain('u.onend');
    expect(talk).toContain('u.onerror');
    expect(talk).toContain("sound.wake('show')");
  });

  it('names the existing speaker as the restore control and adds no second button', () => {
    expect(speakerAriaLabel(false, false)).toBe('Sound settings — hold to mute all');
    expect(speakerAriaLabel(false, true)).toBe('Sound (muted) — hold to unmute');
    expect(speakerAriaLabel(true, false)).toBe('Sound paused — tap to restore');
    const dock = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(dock).not.toContain('RestoreSound');
    expect(dock).not.toContain('Tap to restore sound');
    expect(dock).not.toContain('restore-sound');
    expect(css).not.toContain('sound-restore');
    expect(css).toContain('.dock-btn.needs-tap');
  });

  it('wires resume, recreate, and the element pool into the engine', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const voices = readFileSync(new URL('../src/voices/voices.ts', import.meta.url), 'utf8');
    const host = readFileSync(new URL('../src/hostMusic.ts', import.meta.url), 'utf8');
    const dock = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
    expect(audio).toContain("addEventListener('visibilitychange'");
    expect(audio).toContain("addEventListener('pageshow'");
    expect(audio).toContain("addEventListener('pointerdown'");
    expect(audio).toContain("addEventListener('touchstart'");
    expect(audio).toContain('audioContextAction');
    expect(audio).toContain('settleAudio');
    expect(audio).toContain('this.publishRestore()');
    expect(audio).toContain('recreateContext');
    expect(audio).toContain('audioElementPool');
    expect(audio).not.toContain('new Audio()');
    expect(voices).toContain('audioElementPool');
    expect(voices).not.toContain("createElement('audio')");
    expect(host).toContain('audioElementPool');
    expect(host).not.toContain('new Audio(');
    expect(dock).toContain('needs-tap');
    expect(dock).toContain('speakerAriaLabel');
    expect(dock).toContain("sound.wake('gesture')");
    expect(dock).not.toContain('RestoreSoundChip');
  });
});
