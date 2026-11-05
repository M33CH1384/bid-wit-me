/**
 * @vitest-environment happy-dom
 *
 * BOOT SPLASH (owner, 2026-11-04): the app-open sting's replacement. A splash
 * screen prompts "Touch to begin"; that tap is the audio unlock, the sting
 * plays (shuffle → whole-deck SLAM), the home UI fades in slowly under the
 * shuffle (0.14 → 0.88) and SNAPS to full at the slam. Cold-open only.
 *
 * This suite pins the contract before/with the build:
 *  - the plan: first claim of a page load shows; later claims never do;
 *    sound-off or reduced-motion → the splash still gates entry but the tap
 *    goes straight in at full strength (no fade, no sting).
 *  - the engine seam: beginFromSplash wakes in-gesture FIRST (before any
 *    await), is gated by bootStingAudible, fires only the deckSlam slot, and
 *    is called from the splash alone — never from wake() or any settings path.
 *  - the choreography constants: fade 0.14 → 0.88 over SPLASH_SLAM_MS, the
 *    pick-dependent slam offset (the owner's pick, sting-B: 1050 ms,
 *    wired in with sting-B's file on 2026-11-04).
 *  - the perf law (fan-crash lesson): the splash layer carries no
 *    will-change, no blur, no backdrop-filter.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

beforeEach(() => { localStorage.clear(); });

describe('the plan (pure)', () => {
  it('first claim shows; sting mode when audible and motion is allowed', async () => {
    const { planBootSplash, __resetBootSplashClaimForTest } = await import('../src/bootSplash');
    __resetBootSplashClaimForTest();
    expect(planBootSplash({ claimed: false, reducedMotion: false, stingAudible: true }))
      .toEqual({ show: true, mode: 'sting' });
  });

  it('an already-claimed load never shows again (route change / resume / back-nav)', async () => {
    const { planBootSplash } = await import('../src/bootSplash');
    expect(planBootSplash({ claimed: true, reducedMotion: false, stingAudible: true }).show).toBe(false);
  });

  it('sound off → shows, but the tap goes straight in (instant mode)', async () => {
    const { planBootSplash } = await import('../src/bootSplash');
    expect(planBootSplash({ claimed: false, reducedMotion: false, stingAudible: false }))
      .toEqual({ show: true, mode: 'instant' });
  });

  it('reduced motion → shows, straight in, static (instant mode)', async () => {
    const { planBootSplash } = await import('../src/bootSplash');
    expect(planBootSplash({ claimed: false, reducedMotion: true, stingAudible: true }))
      .toEqual({ show: true, mode: 'instant' });
  });

  it('the claim latch: first claim wins, every later claim in the load loses', async () => {
    vi.resetModules();
    const { claimBootSplash } = await import('../src/bootSplash');
    expect(claimBootSplash()).toBe(true);
    expect(claimBootSplash()).toBe(false);
    expect(claimBootSplash()).toBe(false);
  });
});

describe('the claim across same-session reloads (owner, 2026-11-05)', () => {
  // The owner left a game for the menu and got "Touch to begin" again. The
  // latch used to live in module state alone, so any same-session document
  // reload re-armed it — and this app reloads itself by design (the chunk
  // self-heal spends one location.reload() per build on a page a deploy
  // stranded; post-game surfaces navigate with location.href). The claim
  // must be scoped to the SESSION, not the document: sessionStorage is
  // the tab-scoped lifetime the heal's own flag already trusts (the
  // StoryHome mode-gate precedent, 2026-10-22).
  it('a claim survives a document reload inside the same session', async () => {
    sessionStorage.clear();
    vi.resetModules();
    let m = await import('../src/bootSplash');
    expect(m.claimBootSplash()).toBe(true); // the cold open's claim
    // A document reload: fresh module registry, same sessionStorage.
    vi.resetModules();
    m = await import('../src/bootSplash');
    expect(m.claimBootSplash()).toBe(false); // leaving to the menu must not splash
    expect(m.claimBootSplash()).toBe(false);
  });

  it('a fresh session claims again — the cold-open boundary is a new session', async () => {
    sessionStorage.clear();
    vi.resetModules();
    const m = await import('../src/bootSplash');
    expect(m.claimBootSplash()).toBe(true);
  });

  it('the test reset clears the session flag too', async () => {
    sessionStorage.clear();
    vi.resetModules();
    let m = await import('../src/bootSplash');
    expect(m.claimBootSplash()).toBe(true);
    m.__resetBootSplashClaimForTest();
    vi.resetModules();
    m = await import('../src/bootSplash');
    expect(m.claimBootSplash()).toBe(true);
  });

  it('the session flag rides sessionStorage under a bwm.* key (chunk-heal precedent)', () => {
    const src = read('../src/bootSplash.ts');
    expect(src).toContain('sessionStorage');
    expect(src).toMatch(/bwm\.boot-splash/);
  });
});

describe('choreography constants', () => {
  it('the fade runs 0.14 → 0.88 and the slam offset is the owner\'s pick (sting-B: 1050 ms)', async () => {
    const { SPLASH_FADE_FROM, SPLASH_FADE_TO, SPLASH_SLAM_MS } = await import('../src/bootSplash');
    expect(SPLASH_FADE_FROM).toBe(0.14);
    expect(SPLASH_FADE_TO).toBe(0.88);
    expect(SPLASH_SLAM_MS).toBe(1050);
    // the constant must stay visibly pick-dependent for the wire-in
    expect(read('../src/bootSplash.ts')).toContain('PICK-DEPENDENT');
  });

  it('the reveal CSS carries the same numbers and the fade rides the slam-ms variable', () => {
    const css = read('../src/styles.css');
    const armed = css.match(/\[data-splash-reveal='armed'\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(armed).toContain('opacity: .14');
    const fading = css.match(/\[data-splash-reveal='fading'\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(fading).toContain('opacity: .88');
    expect(fading).toContain('var(--splash-fade-ms');
    const done = css.match(/\[data-splash-reveal='done'\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(done).toContain('opacity: 1');
  });

  it('perf law: the splash layer uses no will-change, no blur, no backdrop-filter', () => {
    const css = read('../src/styles.css');
    const start = css.indexOf('.boot-splash {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 2600);
    expect(block).not.toContain('will-change');
    expect(block).not.toContain('blur(');
    expect(block).not.toContain('backdrop-filter');
  });
});

describe('the splash surface', () => {
  it('is one whole-surface button carrying the exact prompt copy', () => {
    const src = read('../src/BootSplash.tsx');
    expect(src).toContain('Touch to begin');
    expect(src).toContain('data-testid="boot-splash"');
    expect(src).toMatch(/<button[^>]*className="boot-splash"/);
  });

  it('App gates the menu branch with it (the wizard root is its only child surface)', () => {
    const src = read('../src/App.tsx');
    expect(src).toContain('BootSplashGate');
    expect(src).toMatch(/<BootSplashGate>[\s\S]*?<Setup/);
  });
});

describe('the engine seam', () => {
  it('beginFromSplash: wakes in-gesture before any await, gated, fires only deckSlam', () => {
    const src = read('../src/audio.ts');
    const at = src.indexOf('beginFromSplash');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 1400);
    expect(body.indexOf("this.wake('gesture')")).toBeGreaterThan(-1);
    expect(body.indexOf("this.wake('gesture')")).toBeLessThan(body.indexOf('await'));
    expect(body).toContain('this.stingAudible()');
    expect(body).toContain("this.play('deckSlam')");
    // the gate itself is the kept boot gate over the player's own volumes
    const gateAt = src.indexOf('stingAudible()');
    expect(src.slice(gateAt, gateAt + 400)).toContain('bootStingAudible(this.settings.on, this.settings.volume, normalizeCategoryVolumes(this.settings.volumes).sfx)');
    // exactly one mention in the engine: the definition. wake() must not call it.
    expect(src.split('beginFromSplash').length - 1).toBe(1);
  });

  it('no settings path can fire it (the rejected sting fired off the audio settings button)', () => {
    for (const f of ['../src/Setup.tsx', '../src/SoundControls.tsx', '../src/MoreOptions.tsx', '../src/SettingsSheetHost.tsx', '../src/Table.tsx']) {
      expect(read(f), f).not.toContain('beginFromSplash');
    }
  });

  it('fires and resolves true when the context is running and the player is audible', async () => {
    const { sound } = await import('../src/audio');
    const e = sound as unknown as Record<string, unknown>;
    const played: string[] = [];
    e['wake'] = () => {};
    e['play'] = (n: string) => { played.push(n); };
    e['ctx'] = { state: 'running', resume: async () => {} };
    e['settings'] = { on: true, volume: 0.7, volumes: { sfx: 1 } };
    // The seam now awaits its buffer before firing (the music-race fix:
    // a play() issued before the decode lands is silently dropped, and
    // the first ship's seam resolved true over a sting that never
    // sounded). Seed the decoded buffer so this pin keeps its meaning —
    // running + audible ⇒ fires. The wait itself is pinned in
    // splash-music-race.test.ts.
    e['buffers'] = new Map([['deck-slam', {}]]);
    await expect(sound.beginFromSplash()).resolves.toBe(true);
    expect(played).toEqual(['deckSlam']);
  });

  it('resolves false and fires nothing when the player is silent (gate)', async () => {
    const { sound } = await import('../src/audio');
    const e = sound as unknown as Record<string, unknown>;
    const played: string[] = [];
    e['wake'] = () => {};
    e['play'] = (n: string) => { played.push(n); };
    e['ctx'] = { state: 'running', resume: async () => {} };
    e['settings'] = { on: true, volume: 0.7, volumes: { sfx: 0 } };
    await expect(sound.beginFromSplash()).resolves.toBe(false);
    expect(played).toEqual([]);
  });

  it('resolves false when the context never reaches running (fail closed, splash lets the player in)', async () => {
    const { sound } = await import('../src/audio');
    const e = sound as unknown as Record<string, unknown>;
    e['wake'] = () => {};
    e['play'] = () => { throw new Error('must not play'); };
    e['ctx'] = { state: 'suspended', resume: async () => {} };
    e['settings'] = { on: true, volume: 0.7, volumes: { sfx: 1 } };
    await expect(sound.beginFromSplash()).resolves.toBe(false);
  });
});
