import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/audio', () => ({ sound: { play() {}, stopTornado() {} } }));

/**
 * Owner's clearance rule (2026-11-06): after a nuked trick, no player may
 * throw the next card until the explosion has FULLY cleared — the winner's
 * lead was being thrown on the bare trick timer while the blast (which runs
 * on a presented clock that stretches under load) was still live, and
 * Card3D's blast sweep blew the fresh lead off the felt and latched it
 * there (`flung`), so the leader's card never appeared. These pins cover
 * the three pieces of the fix: the fx blast EPISODE signal (emit opens it,
 * the blast's return to null closes it), the pause-release gate built on
 * it, and the late-arrival guard that keeps a card born after the flash
 * out of the blown set.
 */
function stubWindow() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), setTimeout, clearTimeout });
}

describe('fx blast episode (the clearance signal)', () => {
  it('emit(nuke) at Full opens the episode; the blast running then clearing closes it', async () => {
    stubWindow();
    vi.resetModules();
    const { fx } = await import('../src/fx');
    expect(fx.nukeMode).toBe('full');
    expect(fx.blastEpisodeOpen).toBe(false);
    fx.emit('nuke', { silent: true });
    expect(fx.blastEpisodeOpen).toBe(true);
    fx.blast = { start: performance.now(), hand: true };
    expect(fx.blastEpisodeOpen).toBe(true);
    fx.blast = null;
    expect(fx.blastEpisodeOpen).toBe(false);
    vi.unstubAllGlobals();
  });

  it('a mega emit opens the episode too', async () => {
    stubWindow();
    vi.resetModules();
    const { fx } = await import('../src/fx');
    fx.emit('mega', { silent: true });
    expect(fx.blastEpisodeOpen).toBe(true);
    fx.blast = { start: performance.now(), hand: false, mega: true };
    fx.blast = null;
    expect(fx.blastEpisodeOpen).toBe(false);
    vi.unstubAllGlobals();
  });

  it('nuke Off opens no episode — there is no explosion to wait for', async () => {
    stubWindow();
    vi.resetModules();
    const { fx } = await import('../src/fx');
    fx.setNuke('off');
    expect(fx.nukeMode).toBe('off');
    fx.emit('nuke', { silent: true });
    expect(fx.blastEpisodeOpen).toBe(false);
    vi.unstubAllGlobals();
  });

  it('an unrelated blast clear with no episode open stays closed', async () => {
    stubWindow();
    vi.resetModules();
    const { fx } = await import('../src/fx');
    fx.blast = { start: performance.now(), hand: false };
    fx.blast = null;
    expect(fx.blastEpisodeOpen).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('releaseAfterNukeClearance (the pause gate)', () => {
  it('an ungated trick releases exactly on the designed hold', async () => {
    vi.useFakeTimers();
    const { releaseAfterNukeClearance } = await import('../src/nukeGate');
    const onRelease = vi.fn();
    releaseAfterNukeClearance({ holdMs: 5150, gated: false, episodeOpen: () => true, onRelease });
    vi.advanceTimersByTime(5149);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a gated trick whose blast already cleared releases on the designed hold (healthy device: no added delay)', async () => {
    vi.useFakeTimers();
    const { releaseAfterNukeClearance } = await import('../src/nukeGate');
    const onRelease = vi.fn();
    releaseAfterNukeClearance({ holdMs: 5150, gated: true, episodeOpen: () => false, onRelease });
    vi.advanceTimersByTime(5150);
    expect(onRelease).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a gated trick waits while the episode is open and releases when it clears', async () => {
    vi.useFakeTimers();
    const { releaseAfterNukeClearance } = await import('../src/nukeGate');
    const onRelease = vi.fn();
    let open = true;
    releaseAfterNukeClearance({ holdMs: 5150, gated: true, episodeOpen: () => open, onRelease });
    vi.advanceTimersByTime(5150);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onRelease).not.toHaveBeenCalled();
    open = false;
    vi.advanceTimersByTime(100); // one poll tick
    expect(onRelease).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a gated trick whose completion signal never arrives still releases at the cap — delayed, never stuck', async () => {
    vi.useFakeTimers();
    const { NUKE_CLEARANCE_CAP_MS, releaseAfterNukeClearance } = await import('../src/nukeGate');
    const onRelease = vi.fn();
    releaseAfterNukeClearance({ holdMs: 5150, gated: true, episodeOpen: () => true, onRelease });
    vi.advanceTimersByTime(5150 + NUKE_CLEARANCE_CAP_MS - 1);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('cancelling before the hold ends means no release ever', async () => {
    vi.useFakeTimers();
    const { releaseAfterNukeClearance } = await import('../src/nukeGate');
    const onRelease = vi.fn();
    const cancel = releaseAfterNukeClearance({ holdMs: 5150, gated: true, episodeOpen: () => false, onRelease });
    cancel();
    vi.advanceTimersByTime(60000);
    expect(onRelease).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancelling during the clearance wait means no release ever', async () => {
    vi.useFakeTimers();
    const { releaseAfterNukeClearance } = await import('../src/nukeGate');
    const onRelease = vi.fn();
    let open = true;
    const cancel = releaseAfterNukeClearance({ holdMs: 5150, gated: true, episodeOpen: () => open, onRelease });
    vi.advanceTimersByTime(5150);
    cancel();
    open = false;
    vi.advanceTimersByTime(60000);
    expect(onRelease).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('blastClaimsCard (the late-arrival guard)', () => {
  it('a card on the table when the flash went off is part of the blown set', async () => {
    const { blastClaimsCard } = await import('../src/three/blastSweep');
    expect(blastClaimsCard(1000, 2000)).toBe(true);
    expect(blastClaimsCard(2000, 2000)).toBe(true);
    expect(blastClaimsCard(2010, 2000)).toBe(true); // same-frame grace
  });

  it('a card thrown after the flash is NOT claimed — it must survive the blast', async () => {
    const { blastClaimsCard } = await import('../src/three/blastSweep');
    expect(blastClaimsCard(2100, 2000)).toBe(false);
    expect(blastClaimsCard(6000, 2000)).toBe(false);
  });
});
