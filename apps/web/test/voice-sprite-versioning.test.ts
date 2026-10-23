import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '../src/version';

/**
 * Voice sprite cache coherence (defect fix, owner 2026-10-22: "robot
 * voice" on a fully current bundle). voices.ts used to fetch a sprite's
 * manifest and its audio as two independent UNVERSIONED fetches, and
 * the generated _headers set no Cache-Control for /voices/* — so a
 * device's heuristic HTTP cache could pair an old manifest with new
 * audio across a deploy. Assemblies replace the sprite files in place
 * and the re-bake moved every offset, so the stale keys sliced the new
 * audio at the old offsets: segments of the previous (persona) takes.
 * Force-close does not purge the HTTP cache; only a new URL does.
 *
 * The fix: every sprite URL carries the build token (version.ts's
 * stamp: APP_VERSION + HEAD sha — the sha moves with every deploy), so
 * a manifest and its audio are inseparable across builds, and the
 * generated _headers carries an explicit /voices/* Cache-Control rule
 * coherent with that scheme. These tests pin both halves.
 */
const fetches = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('../src/audio', () => ({
  sound: {
    audioContext: () => ({}),
    // The engine's entry points return whether the line started;
    // playClip reports that verdict to its caller (2026-10-22
    // honesty fix), so the double honors the boolean contract.
    playVoice: vi.fn(() => true),
    playVoiceCrossTalk: vi.fn(() => true),
  },
  decodeAudioBuffer: () => Promise.resolve({}),
}));
vi.mock('../src/audioPool', () => ({
  audioElementPool: () => ({ acquire: () => ({ canPlayType: () => '' }), release: () => {} }),
  AudioElementPool: class {},
  AUDIO_ELEMENT_CAP: 4,
}));

async function loadVoices() {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    fetches.urls.push(String(url));
    if (String(url).includes('.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ clips: { 'a raw line': [0, 1200] } }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  }));
  vi.resetModules();
  return import('../src/voices/voices');
}
beforeEach(() => { fetches.urls = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('sprite fetches carry the build token', () => {
  it('manifest and audio are requested under the same tokened URLs', async () => {
    const v = await loadVoices();
    expect(v.VOICE_BUILD_TOKEN).toBe(`v${VERSION.version}-${VERSION.sha}`);
    const played = await v.playClip('og', 'Big Mike', 'a raw line', 0.5);
    expect(played).toBe(true);
    expect(fetches.urls.length).toBe(2);
    const [meta, audio] = fetches.urls;
    expect(meta).toMatch(/^\/voices\/v2\/og-[fm]\.json\?v=/);
    expect(audio).toMatch(/^\/voices\/v2\/og-[fm]\.m4a\?v=/);
    // THE pin: one build token, identical on both halves of the pair
    expect(meta!.split('?v=')[1]).toBe(v.VOICE_BUILD_TOKEN);
    expect(audio!.split('?v=')[1]).toBe(v.VOICE_BUILD_TOKEN);
    expect(audio!.replace('.m4a', '.json')).toBe(meta);
  }, 30000); // first import of the voices module graph is slow under load; the assertions are instant

  it('the token is part of the URL, not a header: a cached pair can never cross builds', async () => {
    const v = await loadVoices();
    expect(v.voiceUrl('og-f.json')).toBe(`/voices/v2/og-f.json?v=${v.VOICE_BUILD_TOKEN}`);
    expect(v.voiceUrl('og-f.webm')).toBe(`/voices/v2/og-f.webm?v=${v.VOICE_BUILD_TOKEN}`);
  });
});

describe('the generated _headers rule for /voices/*', () => {
  it('emits an explicit Cache-Control for the sprite paths, after the global block', async () => {
    const { pagesHeadersSource } = await import('../vite.config');
    const src = pagesHeadersSource('https://example.invalid');
    expect(src).toContain('Content-Security-Policy'); // the global security block survives
    const at = src.indexOf('\n/voices/*\n');
    expect(at).toBeGreaterThan(src.indexOf('/*'));
    const block = src.slice(at);
    expect(block).toContain('Cache-Control: public, max-age=86400');
    // Pages applies only the FIRST matching block per path: the voices
    // block must stand alone (no security headers leak into it, none
    // of them set caching anyway)
    expect(block).not.toContain('Content-Security-Policy');
  });

  it('the token’s ingredients are the build defines the stamp is shown from', async () => {
    const cfg = (await import('../vite.config')).default as unknown as { define: Record<string, string> };
    expect(JSON.parse(cfg.define.__APP_VERSION__!)).toBe('0.3.0');
    expect(typeof JSON.parse(cfg.define.__GIT_SHA__!)).toBe('string');
    expect(JSON.parse(cfg.define.__GIT_SHA__!)).not.toBe('');
  });
});
