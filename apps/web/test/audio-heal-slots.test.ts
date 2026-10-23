/**
 * @vitest-environment happy-dom
 *
 * The heal contract at the CURRENT voice layer (owner's recurrence
 * report, 2026-10-22: "the overall sound intermittent bug is happening
 * again"). The 2026-10-21 heal (ea86bb22 + 7d67f317) was pinned in
 * audio-resume.test.ts at the POLICY level — pure functions and
 * source greps — but the voice path has been rebuilt since (slots +
 * cross-talk), and the audit found the rebuild had opened holes the
 * policy pins cannot see:
 *
 *  - recreateContext() never re-ran the stem syncs itself. The
 *    statechange watcher checks the OLD context's state after a
 *    rebuild (it is 'interrupted', never 'running'), so music, beds
 *    and tension stayed down until a later wake() happened to land.
 *    The rebuild now re-syncs as part of the rebuild.
 *  - An SFX fetch in flight across the rebuild was discarded by the
 *    generation guard, and the refill only ran when ZERO buffers
 *    survived the copy — a partially-copied set kept its holes for
 *    the rest of the session. The loader now always completes the
 *    set, skipping names the copy restored.
 *
 * This suite drives the REAL Engine on a fake AudioContext through
 * the whole arc: unlock at a table → a voice slot plays → iOS
 * interrupts → the rebuild restores the room tone IMMEDIATELY (no
 * wake, no tap) → the slot layer plays again on the new context →
 * the SFX set is whole again.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

/* ---------- a minimal AudioContext the Engine can run on ---------- */

class FakeParam {
  value = 0;
  setTargetAtTime(): void { /* noop */ }
  setValueAtTime(): void { /* noop */ }
  linearRampToValueAtTime(): void { /* noop */ }
  exponentialRampToValueAtTime(): void { /* noop */ }
  cancelScheduledValues(): void { /* noop */ }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  playbackRate = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect(): FakeNode { return this; }
  disconnect(): void { /* noop */ }
  start(): void { /* noop */ }
  stop(): void { /* noop */ }
  addEventListener(): void { /* noop */ }
  removeEventListener(): void { /* noop */ }
}

class FakeCtx {
  static instances: FakeCtx[] = [];
  state: string = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  /** Buffer sources started on THIS context (voice slots, room tone, blips). */
  sourcesStarted = 0;
  constructor() { FakeCtx.instances.push(this); }
  createGain(): FakeNode { return new FakeNode(); }
  createDynamicsCompressor(): FakeNode { return new FakeNode(); }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createConvolver(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { return new FakeNode(); }
  createMediaElementSource(): FakeNode { return new FakeNode(); }
  createBufferSource(): FakeNode {
    const n = new FakeNode();
    n.start = () => { this.sourcesStarted++; };
    return n;
  }
  createBuffer(channels: number, length: number, rate: number) {
    return {
      numberOfChannels: channels, length, sampleRate: rate, duration: length / rate,
      getChannelData: () => new Float32Array(length),
      copyToChannel: () => { /* noop */ },
    };
  }
  decodeAudioData(_data: ArrayBuffer, ok?: (b: unknown) => void): Promise<unknown> {
    const buf = this.createBuffer(1, 4800, 48000);
    if (ok) { ok(buf); return Promise.resolve(buf); }
    return Promise.resolve(buf);
  }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
}

/* ---------- the arc ---------- */

type Sound = typeof import('../src/audio').sound;
let sound: Sound;

const flush = () => new Promise((r) => setTimeout(r, 60));

beforeAll(async () => {
  localStorage.clear();
  // The rebuild is rate-limited (RECREATE_COOLDOWN_MS) off
  // performance.now(); a fresh test worker is younger than the
  // cooldown, a real phone page is not. Pin the clock to a page
  // that has been open a while.
  vi.spyOn(performance, 'now').mockImplementation(() => 100_000);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 })));
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  ({ sound } = await import('../src/audio'));
  sound.set({ music: false, ambient: true });
  sound.enterTable();
});

describe('the heal at the slot layer', () => {
  it('unlock builds a context, starts the room tone, and a voice slot plays', async () => {
    sound.wake('gesture');
    const ctx1 = FakeCtx.instances.at(-1)!;
    expect(sound.audioContext()).toBe(ctx1);
    expect(ctx1.sourcesStarted).toBeGreaterThan(0); // the room tone is up
    const buf = sound.audioContext()!.createBuffer(1, 48000, 48000) as unknown as AudioBuffer;
    const before = ctx1.sourcesStarted;
    expect(sound.playVoiceCrossTalk(buf, 1, [0, 2], undefined, 4, 'Dee')).toBe(true);
    expect(ctx1.sourcesStarted).toBeGreaterThan(before);
    expect(sound.played.voice).toBe(1);
    await flush();
    expect(sound.loaded).toBe(13); // the whole SFX set decoded
  });

  it('an interruption rebuilds — and the rebuild itself restores the stems and the slot layer', async () => {
    const ctx1 = FakeCtx.instances.at(-1)!;
    (ctx1 as { state: string }).state = 'interrupted';
    ctx1.onstatechange?.();
    const ctx2 = FakeCtx.instances.at(-1)!;
    expect(ctx2).not.toBe(ctx1);
    expect(sound.audioContext()).toBe(ctx2);
    // THE PIN: the room tone is already sounding on the new context,
    // synchronously out of the statechange — no wake(), no tap, no
    // heal-timer wait. On the pre-fix code this was 0: the watcher
    // checked the old context's state, and the rebuild never re-synced.
    expect(ctx2.sourcesStarted).toBeGreaterThan(0);
    expect(sound.needsRestore).toBe(false);
    // The slot layer is intact on the rebuilt graph: a line plays.
    const buf = ctx2.createBuffer(1, 48000, 48000) as unknown as AudioBuffer;
    const before = ctx2.sourcesStarted;
    expect(sound.playVoiceCrossTalk(buf, 1, [0, 2], undefined, 4, 'Dee')).toBe(true);
    expect(ctx2.sourcesStarted).toBeGreaterThan(before);
    expect(sound.played.voice).toBe(2);
    await flush();
    expect(sound.loaded).toBe(13); // the SFX set completed again after the rebuild
  });
});
