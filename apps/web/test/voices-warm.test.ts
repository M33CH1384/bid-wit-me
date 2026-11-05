/**
 * @vitest-environment happy-dom
 *
 * STARTER WARM (2026-11-05, the sparse-bot-talk conviction).
 *
 * The per-clip voice layer decodes a whole sprite per pass (measured
 * 6–12 s for a talker's sprite on desktop Chromium; slower on a
 * throttled phone) and a line that waits >1500 ms for its pass is
 * dropped silent. Preload used to warm only the first 12 manifest
 * clips, so at a real table most first-played lines — the rotation IS
 * mostly first plays, the engine's shuffle-bag avoids repeats — paid a
 * full decode on the critical path and died. The starter warm pays ONE
 * decode per seated sprite at preload and slices the sprite's
 * table-rotation set (kind-priority filled to a per-sprite byte
 * budget), so the lines a game actually draws are resident before the
 * first hand.
 *
 * These pins: preload slices rotation lines SCATTERED through the
 * manifest (not just the head window), never slices text-only kinds,
 * never inflates the warm into ±10 windows around each want, stays
 * inside the per-sprite warm budget, and a warmed line then plays with
 * no second decode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  decode: vi.fn(),
  playVoice: vi.fn((): boolean => true),
  playVoiceCrossTalk: vi.fn((): boolean => true),
  ctx: { fakeCtx: true },
}));
vi.mock('../src/audio', () => ({
  sound: {
    audioContext: () => h.ctx,
    playVoice: h.playVoice,
    playVoiceCrossTalk: h.playVoiceCrossTalk,
  },
  decodeAudioBuffer: h.decode,
}));

import { speakableLines, TEXT_ONLY_KINDS, CONSULT_FREE } from '@spades/bots';
import {
  VOICE_DECODE_RATE,
  VOICE_WARM_BUDGET_BYTES,
  playClip,
  preloadVoice,
  residentClipBytes,
  residentClipIds,
  setSeatedVoiceKeys,
} from '../src/voices/voices';

const CLIP_MS = 2_000;
const CLIP_BYTES = (CLIP_MS / 1000) * VOICE_DECODE_RATE * 4;

const lines = speakableLines('deacon', 'm');
const rawOf = (kind: string) => lines.find((l) => l.kind === kind && !l.raw.includes('{bid}'))!.raw;
const PREPLAY_RAW = rawOf('prePlay');
const ROAST_RAW = rawOf('roast');
const WIN_RAW = rawOf('win');
const HIST_RAW = lines.find((l) => TEXT_ONLY_KINDS.includes(l.kind))!.raw;
const CONSULT_RAW = Object.values(CONSULT_FREE).flatMap((ls) => [...ls])[0]!;

/** Lay the interesting raws far outside the head window (indices 0–11)
 *  and outside ±10 of it, with inert filler between them. */
function scatteredManifest(): { json: string; seconds: number } {
  const clips: Record<string, [number, number]> = {};
  let idx = 0;
  const put = (key: string) => { clips[key] = [idx * CLIP_MS, CLIP_MS]; idx++; };
  for (let k = 0; k < 30; k++) put(`filler ${k}`);
  put(PREPLAY_RAW); // index 30
  for (let k = 30; k < 59; k++) put(`filler ${k}`);
  put(ROAST_RAW); // index 60
  for (let k = 59; k < 74; k++) put(`filler ${k}`);
  put(HIST_RAW); // index 75 — text-only kind, must never warm
  for (let k = 74; k < 89; k++) put(`filler ${k}`);
  put(WIN_RAW); // index 90
  for (let k = 89; k < 119; k++) put(`filler ${k}`);
  put(CONSULT_RAW); // index 120
  return { json: JSON.stringify({ clips }), seconds: (idx * CLIP_MS) / 1000 };
}

function fullCorpusManifest(): { json: string; seconds: number } {
  const clips: Record<string, [number, number]> = {};
  let idx = 0;
  for (const l of lines) {
    if (l.raw === '…' || clips[l.raw]) continue;
    clips[l.raw] = [idx * CLIP_MS, CLIP_MS];
    idx++;
  }
  return { json: JSON.stringify({ clips }), seconds: (idx * CLIP_MS) / 1000 };
}

let manifestJson = '';
let spriteSeconds = 0;
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const u = String(input);
    if (u.includes('.json')) {
      return new Response(manifestJson, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(new Uint8Array([7]).buffer as ArrayBuffer, { status: 200 });
  }));
}

function fakeSprite() {
  const len = spriteSeconds * VOICE_DECODE_RATE;
  return {
    duration: spriteSeconds,
    length: len,
    numberOfChannels: 1,
    sampleRate: VOICE_DECODE_RATE,
    getChannelData: () => new Float32Array(len),
  };
}
class FakeOffline {
  sampleRate: number;
  constructor(_channels: number, _length: number, sampleRate: number) { this.sampleRate = sampleRate; }
  createBuffer(_channels: number, len: number, rate: number) {
    return {
      length: len, sampleRate: rate, numberOfChannels: 1, duration: len / rate,
      copyToChannel: () => { /* the slice lands */ },
      getChannelData: () => new Float32Array(len),
    };
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const idOf = (raw: string) => `deacon-m\n${raw}`;

async function preloadAndSettle() {
  preloadVoice('deacon', 'Darius');
  // The idle callback (or its 400 ms fallback) fires the warm-up.
  await new Promise((r) => setTimeout(r, 600));
  await flush(); await flush(); await flush();
}

beforeEach(async () => {
  localStorage.removeItem('bwm.voicePerClip'); // the default: per-clip on
  stubFetch();
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
  h.decode.mockReset();
  h.decode.mockImplementation(async () => fakeSprite());
  h.playVoice.mockClear();
  h.playVoiceCrossTalk.mockClear();
  setSeatedVoiceKeys([]);
  await flush(); await flush();
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem('bwm.voicePerClip'); });

describe('starter warm at preload', () => {
  it('slices the rotation set scattered through the manifest in ONE pass — not just the head window', async () => {
    const m = scatteredManifest();
    manifestJson = m.json; spriteSeconds = m.seconds;
    await preloadAndSettle();
    const ids = residentClipIds();
    expect(ids).toContain(idOf(PREPLAY_RAW));
    expect(ids).toContain(idOf(ROAST_RAW));
    expect(ids).toContain(idOf(WIN_RAW));
    expect(ids).toContain(idOf(CONSULT_RAW));
    expect(h.decode).toHaveBeenCalledTimes(1); // one decode paid for the whole warm
  });

  it('never warms text-only kinds, and never inflates the warm into neighbour windows', async () => {
    const m = scatteredManifest();
    manifestJson = m.json; spriteSeconds = m.seconds;
    await preloadAndSettle();
    const ids = residentClipIds();
    expect(ids).not.toContain(idOf(HIST_RAW)); // persona-memory beats render text by design
    expect(ids).not.toContain(idOf('filler 35')); // ±10 of the prePlay raw at index 30
    expect(ids).not.toContain(idOf('filler 100')); // deep filler, nobody's want
    expect(ids).toContain(idOf('filler 0')); // the head window still warms (scene front door)
  });

  it('a warmed rotation line plays with no second decode', async () => {
    const m = scatteredManifest();
    manifestJson = m.json; spriteSeconds = m.seconds;
    await preloadAndSettle();
    expect(h.decode).toHaveBeenCalledTimes(1);
    await expect(playClip('deacon', 'Darius', WIN_RAW, 1)).resolves.toBe(true);
    expect(h.decode).toHaveBeenCalledTimes(1);
    expect(h.playVoice).toHaveBeenCalled(); // the clip actually sounded
  });

  it('stays inside the per-sprite warm budget even when the corpus is bigger than the budget', async () => {
    const m = fullCorpusManifest();
    manifestJson = m.json; spriteSeconds = m.seconds;
    // The full recordable corpus at 2 s/clip far exceeds the warm budget.
    expect(spriteSeconds * VOICE_DECODE_RATE * 4).toBeGreaterThan(VOICE_WARM_BUDGET_BYTES);
    await preloadAndSettle();
    expect(h.decode).toHaveBeenCalledTimes(1);
    expect(residentClipBytes()).toBeLessThanOrEqual(VOICE_WARM_BUDGET_BYTES + CLIP_BYTES);
    // Priority kinds land first: a prePlay line is warm…
    const ids = residentClipIds();
    expect(ids.some((id) => id === idOf(PREPLAY_RAW))).toBe(true);
    expect(residentClipBytes()).toBeGreaterThan(VOICE_WARM_BUDGET_BYTES / 2); // …and the budget is actually used
  });
});
