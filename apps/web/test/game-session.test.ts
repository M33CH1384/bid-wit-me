import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const fakeStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
vi.stubGlobal('localStorage', fakeStorage);
vi.stubGlobal('sessionStorage', fakeStorage);

const { sound } = await import('../src/audio');
const { offlineTalk } = await import('../src/offlineTalk');
const { enterTable, quitGame, suspendGame } = await import('../src/gameSession');
const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');

describe('leaving a game', () => {
  beforeEach(() => { store.clear(); store.set('bwm.game', '{"v":1}'); store.set('bwm.inGame', '1'); enterTable(); offlineTalk.sink = () => undefined; });

  it('Save & quit keeps the save, but the game is silent', () => {
    suspendGame();
    expect(store.get('bwm.game')).toBeDefined();
    expect(sound.atTable).toBe(false);
    expect(offlineTalk.sink).toBeNull();
  });

  it('Quit deletes the save and the refresh marker, and is silent', () => {
    quitGame();
    expect(store.has('bwm.game')).toBe(false);
    expect(store.has('bwm.inGame')).toBe(false);
    expect(sound.atTable).toBe(false);
    expect(offlineTalk.sink).toBeNull();
  });

  it('game sounds are refused off the table; settings previews still sound', () => {
    quitGame();
    const b = { ...sound.blocked };
    (sound as unknown as { unlocked: boolean }).unlocked = true;
    sound.play('deal');
    expect(sound.blocked.deal ?? 0).toBe((b.deal ?? 0) + 1);
    sound.play('tap');
    expect(sound.blocked.tap ?? 0).toBe(0);
  });

  it('Table routes every exit through the two functions and silences on unmount', () => {
    const t = src('Table.tsx');
    expect(t).toMatch(/enterTable\(\); return silenceGame;/);
    expect(t).toMatch(/if \(!online\) \{ quitGame\(\); onExit\(\)/);
    expect(t).toMatch(/suspendGame\(\); onSuspend\(\)/);
  });
});
