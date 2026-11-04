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
 *
 * Round 2 (2026-11-01, owner report): the nuke still "pauses, then skips
 * ahead" on real hardware — round 1 anchored only the START of each show;
 * the clocks then ran on WALL time, so every mid-show stall froze the
 * picture while the timeline kept running, and the next frame leapt. The
 * clocks now integrate PRESENTED frames for their whole run (fx.ts
 * advancePresentedClock / tornadoPresentedT, clamped per frame), the blast
 * ends on its presented clock, and the blown cards ride fx.nukeT. A second
 * report the same day — a nuke presented with only 3 cards on the table —
 * pinned the detonation to presentation too: the Table watchdog's schedule
 * (1100 ms) is unchanged, but a 3D blast fires only once Scene certifies
 * the displayed trick IS the nuked trick with every card down.
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
    expect(nukeSrc).toContain('onFirstFrame');
  });

  it('round 2: the blast clock integrates presented frames for its whole run (no wall-clock timeline to skip on)', () => {
    expect(nukeSrc).toContain('advancePresentedClock');
    expect(nukeSrc).toContain('presentedT');
    expect(nukeSrc).not.toContain('(now - clockStart.current) / 1000');
    // the run ends on its presented clock too — no wall end timer can cut a stretched show
    expect(nukeSrc).not.toContain('presentedEnd');
    expect(nukeSrc).toContain('T >= len + 0.25');
    // and the blown cards ride the same presented clock the fireball publishes
    expect(nukeSrc).toContain('fx.nukeT = T');
    expect(cardSrc).toContain('fx.nukeT');
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
    expect(cardSrc).toContain('tornadoPresentedT');
  });

  it('round 2: the tornado, its cards and the camera sway all integrate the same presented clock', () => {
    const sceneSrc = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(tornadoSrc).toContain('tornadoPresentedT');
    expect(cardSrc).toContain('tornadoPresentedT');
    expect(sceneSrc).toContain('tornadoPresentedT');
    // no wall-clock tornado reads remain in any consumer
    expect(tornadoSrc).not.toContain('(now - (T.presentedAt ?? T.start)) / 1000');
    expect(cardSrc).not.toContain('(performance.now() - (T.presentedAt ?? T.start)) / 1000');
    expect(sceneSrc).not.toContain('(performance.now() - T.start) / 1000) + 0.4');
  });

  it('round 2: the detonation binds to the displayed trick, not just state + a timer', () => {
    const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const sceneSrc = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    // the watchdog schedule is untouched: the same 1100 ms timer, the same nukeWatch hold
    expect(tableSrc).toContain("fx.hold(1300, 'nukeWatch')");
    expect(tableSrc).toContain('}, 1100);');
    // but firing waits for Scene's certification that the nuked trick is the one on display, all cards down
    expect(tableSrc).toContain('nukeDueKey');
    expect(tableSrc).toContain('nukeShownKey !== nukeKey');
    expect(tableSrc).toContain('    onNukePresented,');
    expect(sceneSrc).toContain('onNukePresented');
    expect(sceneSrc).toContain('certifiedNuke');
  });
});

describe('presented-time clocks (round 2)', () => {
  it('advancePresentedClock: the first presented frame anchors (advance 0)', async () => {
    const { advancePresentedClock } = await import('../src/fx');
    expect(advancePresentedClock(0, null, 5000)).toEqual({ t: 0, last: 5000 });
    vi.unstubAllGlobals();
  });

  it('advancePresentedClock: presented frames accumulate their real delta', async () => {
    const { advancePresentedClock } = await import('../src/fx');
    const a = advancePresentedClock(0, 5000, 5033);
    expect(a.t).toBeCloseTo(0.033);
    const b = advancePresentedClock(a.t, a.last, 5066);
    expect(b.t).toBeCloseTo(0.066);
    vi.unstubAllGlobals();
  });

  it('advancePresentedClock: a stall cannot skip the show — one frame advances at most the clamp', async () => {
    const { advancePresentedClock, PRESENTED_DT_CLAMP_S } = await import('../src/fx');
    expect(PRESENTED_DT_CLAMP_S).toBe(0.1);
    // a 3 s freeze between frames moves the show 0.1 s, not 3 s
    const a = advancePresentedClock(1.2, 1000, 4000);
    expect(a.t).toBeCloseTo(1.3);
    expect(a.last).toBe(4000);
    // a backwards clock reading never rewinds the show
    expect(advancePresentedClock(1.3, 4000, 3950).t).toBeCloseTo(1.3);
    vi.unstubAllGlobals();
  });

  it('tornadoPresentedT: negative lead-in before start, stamp at start, clamped integration after', async () => {
    const { tornadoPresentedT } = await import('../src/fx');
    const T = { start: 1000, reduced: false };
    // before the scheduled start: plain wall lead-in, nothing stamped
    expect(tornadoPresentedT(T, 500)).toBeCloseTo(-0.5);
    expect(T.presentedAt).toBeUndefined();
    // first frame at/after start: stamps and reads 0
    expect(tornadoPresentedT(T, 1000)).toBe(0);
    expect(T.presentedAt).toBe(1000);
    // a 5 s stall before the next frame advances the funnel only by the clamp
    expect(tornadoPresentedT(T, 6000)).toBeCloseTo(0.1);
    // normal frames accumulate; a second caller in the same instant adds nothing
    expect(tornadoPresentedT(T, 6033)).toBeCloseTo(0.133);
    expect(tornadoPresentedT(T, 6033)).toBeCloseTo(0.133);
    vi.unstubAllGlobals();
  });
});
