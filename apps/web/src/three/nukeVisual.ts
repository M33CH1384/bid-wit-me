/**
 * What the nuke is allowed to spend on this device.
 *
 * iPhone / iPad Safari (including iPadOS "desktop" mode) loses the WebGL context, or stops presenting
 * frames, when the blast mounts a half-float EffectComposer (mipmapped bloom) and a fullscreen noise
 * pass at the same moment the last-trick auto-play retargets every card. The canvas freezes on the
 * white flash: the four trick cards stay blown out in a cross and the fireball never advances.
 * The fireball, shockwave, and particles do not need that composer or the fullscreen pass.
 */
export interface NukeDevice {
  ua: string;
  platform: string;
  maxTouchPoints: number;
}

/** iPhone, iPod, iPad, and iPadOS Safari that sends a Macintosh UA plus a touch screen. */
export function isIosWebKit(d: NukeDevice): boolean {
  if (/iPhone|iPad|iPod/i.test(d.ua)) return true;
  if (d.maxTouchPoints > 1 && (/Macintosh|MacIntel/i.test(d.ua) || d.platform === 'MacIntel')) return true;
  return false;
}

export interface NukeProfile {
  /** Bloom, chromatic aberration, vignette. Off where the half-float composer wedges the canvas. */
  post: boolean;
  /** Fullscreen fire octaves. The second fbm is what blows the iOS fragment budget at the white flash. */
  octaves: 0 | 1;
  /** 1 = full particle counts and mesh detail; lower still reads as an explosion. */
  detail: number;
  /** Full-viewport noise pass. Off on iOS: a screen-sized fbm at the flash is what times the GPU out. */
  screen: boolean;
}

export function nukeProfile(quality: 'high' | 'low', device: NukeDevice): NukeProfile {
  if (isIosWebKit(device)) return { post: false, octaves: 0, detail: 0.45, screen: false };
  if (quality === 'low') return { post: false, octaves: 0, detail: 0.35, screen: true };
  return { post: true, octaves: 1, detail: 1, screen: true };
}

export function currentNukeDevice(): NukeDevice {
  if (typeof navigator === 'undefined') return { ua: '', platform: '', maxTouchPoints: 0 };
  return { ua: navigator.userAgent ?? '', platform: navigator.platform ?? '', maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}

/**
 * The demand-loop blast is stuck on the white flash when the rendered clock stops between watchdog
 * samples. A live clock moves with wall time. A hitch that then paints again jumps the clock
 * (`performance.now()`), so it is not a stall. `rendered` is null when the blast has never drawn.
 */
export function nukeClockStalled(prev: number | null, rendered: number | null, dtMs: number, len = 3.6): boolean {
  if (dtMs < 700) return false;
  if (rendered === null) return true;
  if (prev === null) return false;
  // still inside the blast (3.6 s nuke, 4.4 s mega), but the clock barely moved
  return rendered < len - 0.2 && rendered - prev < 0.2;
}
