import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { playSpy } = vi.hoisted(() => ({ playSpy: vi.fn() }));
vi.mock('../src/audio', () => ({ sound: { play: playSpy, stopTornado() {} } }));

/**
 * Hero presentation fix (2026-10-29, owner report): the big animations (nuke /
 * mega / tornado) froze the game ~1 s, played their sound, then flashed to book
 * collection — the show itself was never seen. Root causes, all pinned here:
 *  1. the nuke's shaders compiled at first blast (no load-time warm pass),
 *  2. the blast's clock was wall-time from the emit, so a blocked mount ate the
 *     timeline, and the stall watchdog bailed blasts whose first frame was late,
 *  3. the boom + shake were scheduled at emit, behind the block.
 * The cure: warm the blast at load (warmNuke), anchor every hero clock at its
 * first PRESENTED frame, and defer the boom/shake to that frame.
 */
function stubWindow() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {} }), setTimeout, clearTimeout });
  return store;
}

async function freshFx() {
  stubWindow();
  vi.resetModules();
  playSpy.mockClear();
  const { fx } = await import('../src/fx');
  return fx;
}

describe('hero boom + shake wait for the first presented frame', () => {
  it('nuke: nothing plays at emit; heroPresented() plays the boom once, with the shake', async () => {
    const fx = await freshFx();
    fx.emit('nuke');
    expect(playSpy).not.toHaveBeenCalled();
    expect(fx.shake).toBeNull(); // the shake is presentation-anchored now, not emit-anchored
    fx.heroPresented();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledWith('nuke', { gain: 1 });
    expect(fx.shake?.dur).toBe(2.2);
    fx.heroPresented(); // a second call must not replay anything
    expect(playSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('mega defers the same way, with its deeper shake', async () => {
    const fx = await freshFx();
    fx.emit('mega');
    expect(playSpy).not.toHaveBeenCalled();
    fx.heroPresented();
    expect(playSpy).toHaveBeenCalledWith('mega', { gain: 1 });
    expect(fx.shake?.dur).toBe(3.0);
    vi.unstubAllGlobals();
  });

  it("mode 'off' never defers: there is no 3D run, so the emit's sound is the show", async () => {
    const fx = await freshFx();
    fx.setNuke('off');
    fx.emit('nuke');
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledWith('nuke', { gain: 1 });
    fx.heroPresented();
    expect(playSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('silent emits stay silent (no deferral is registered)', async () => {
    const fx = await freshFx();
    fx.emit('nuke', { silent: true });
    fx.heroPresented();
    expect(playSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('the boom is never lost: if no frame presents, the fallback presents it', async () => {
    vi.useFakeTimers();
    try {
      const fx = await freshFx();
      fx.emit('nuke');
      expect(playSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1600);
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(playSpy).toHaveBeenCalledWith('nuke', { gain: 1 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('hero presentation — source pins', () => {
  const nukeSrc = readFileSync(new URL('../src/three/Nuke3D.tsx', import.meta.url), 'utf8');
  const warmSrc = readFileSync(new URL('../src/effects/warm.ts', import.meta.url), 'utf8');
  const tornadoSrc = readFileSync(new URL('../src/three/Tornado3D.tsx', import.meta.url), 'utf8');
  const cardSrc = readFileSync(new URL('../src/three/Card3D.tsx', import.meta.url), 'utf8');

  it('the blast is warmed at load, beside the funnel (nukeMs in the warm ledger)', () => {
    expect(nukeSrc).toContain('export async function warmNuke');
    expect(nukeSrc).toContain('compileAsync');
    expect(warmSrc).toContain('warmNuke');
    expect(warmSrc).toContain('nukeMs');
  });

  it("the blast's clock is anchored at its first presented frame, not the emit", () => {
    expect(nukeSrc).not.toContain('(performance.now() - start) / 1000');
    expect(nukeSrc).toContain('clockStart');
    expect(nukeSrc).toContain('onFirstFrame');
  });

  it('the stall watchdog cannot bail a blast that has not presented yet', () => {
    expect(nukeSrc).toContain('if (!firstFrameAt.current)');
  });

  it('the blast impulse fires on the presented clock, not a wall-clock timer', () => {
    expect(nukeSrc).not.toContain('}, FLASH * 1000);');
    expect(nukeSrc).toContain('blasted.current');
  });

  it('the tornado + its cards run from the first presented frame too', () => {
    expect(tornadoSrc).toContain('T.presentedAt');
    expect(cardSrc).toContain('presentedAt ?? T.start');
  });
});
