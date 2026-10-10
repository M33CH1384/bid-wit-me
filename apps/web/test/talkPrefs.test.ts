import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'bwm.talk.v1';
function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } });
  return m;
}
async function load(saved?: object) {
  const m = store(saved ? { [KEY]: JSON.stringify(saved) } : {});
  vi.resetModules();
  const mod = await import('../src/talkPrefs');
  return { ...mod, m };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('bot voices default respects explicit choices', () => {
  it('never touched (no save): on, gentle volume', async () => {
    const { talkPrefs } = await load();
    expect(talkPrefs.get().voices).toBe(true);
    expect(talkPrefs.get().voiceVolume).toBeLessThanOrEqual(0.6);
  });
  it('old save with voices off stays off; old save with voices on stays on', async () => {
    expect((await load({ botTalk: true, cleanTalk: true, hideBotTalk: false, voices: false, voiceVolume: 0.8 })).talkPrefs.get()).toMatchObject({ voices: false, voiceVolume: 0.6 });
    expect((await load({ voices: true, voiceVolume: 0.4 })).talkPrefs.get()).toMatchObject({ voices: true, voiceVolume: 0.4 });
  });
  it('a save without a voices value gets the default (on)', async () => {
    expect((await load({ v: 3, cleanTalk: false })).talkPrefs.get()).toMatchObject({ voices: true, cleanTalk: false });
  });
  it('turning voices off is kept across reloads; changing another setting does not pin voices', async () => {
    const a = await load();
    a.talkPrefs.set({ voices: false });
    const saved = JSON.parse(a.m.get(KEY)!);
    expect(saved.voices).toBe(false);
    expect((await load(saved)).talkPrefs.get().voices).toBe(false);
    const b = await load();
    b.talkPrefs.set({ cleanTalk: false });
    const s2 = JSON.parse(b.m.get(KEY)!);
    expect(s2).not.toHaveProperty('voices');
    expect((await load(s2)).talkPrefs.get()).toMatchObject({ voices: true, cleanTalk: false });
  });
});
