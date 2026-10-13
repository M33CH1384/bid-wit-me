import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AUDIO_ELEMENT_CAP, AudioElementPool } from '../src/audioPool';
import { audioContextAction, settleAudio, soundRestorePending } from '../src/audioSession';
import { RestoreSoundChip } from '../src/RestoreSound';

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

  it('asks for a tap only after unlock, while sound is still wanted and the context is not running', () => {
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

  it('renders the restore chip only while sound is stuck', () => {
    expect(renderToStaticMarkup(createElement(RestoreSoundChip, { show: false, onRestore() {} }))).toBe('');
    const html = renderToStaticMarkup(createElement(RestoreSoundChip, { show: true, onRestore() {} }));
    expect(html).toContain('Tap to restore sound');
    expect(html).toContain('data-testid="restore-sound"');
    expect(html).toContain('sound-restore');
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
    expect(dock).toContain('RestoreSoundChip');
    expect(dock).toContain('sound.wake');
  });
});
