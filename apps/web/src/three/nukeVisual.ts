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

/*
 * Table extents, MIRRORED from layout.ts (FELT hx 1.5 / hz 1.78, RAIL 0.2) —
 * deliberately not imported: haptics.ts statically imports this module from
 * the entry graph, and layout.ts pulls in three.js, which must stay out of
 * the first script (entry-graph.test.ts). nuke-engulf.test.ts pins these
 * values against the real layout module, so the mirror cannot drift.
 */
const TABLE_FELT_HX = 1.5;
const TABLE_FELT_HZ = 1.78;
const TABLE_RAIL = 0.2;

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

/* ------------------------------------------------------------------ *
 * Wave A engulf choreography (program rows 57–58, §E.2 treatment (a)).
 *
 * Owner spec: the nuke's mushroom cloud ENGULFS THE ENTIRE TABLE; the mega
 * bursts one scale-step past it — past the table's edges and the frame.
 * All of this is pure, deterministic math (no three.js, no wall clock): the
 * component samples it per frame, the tests pin it per camera.
 *
 * The old cap was a lone torus: outer radius (0.42 + 0.25) × max scale 2.6
 * ≈ 1.74 world units, hollow in the middle. The table (felt + rail)
 * half-diagonal is ≈ 2.61, so most of the felt was never under the cloud.
 * Coverage is an occlusion property of camera POSITION: a felt point is
 * hidden iff the camera→point ray crosses the cap plane inside the cap
 * disc. `capCoverRadius` samples the felt+rail perimeter from the live
 * camera each run and adds a margin for the dome's curved shoulder.
 * ------------------------------------------------------------------ */

/** Blast root on the felt (the Nuke3D group sits at [0, 0.03, 0.04]). */
export const CAP_CENTER = { x: 0, z: 0.04 } as const;
/** Height of the cap's base plane — the plane the coverage math occludes through. */
export const CAP_PLANE_Y = 0.82;
/** Margin over the true occlusion need, for the dome's curved shoulder. */
export const CAP_COVER_MARGIN = 1.07;

/** Table extent the cloud must swallow: felt half-extents plus the rail (mirrored above). */
export const TABLE_EXTENT = {
  hx: TABLE_FELT_HX + TABLE_RAIL,
  hz: TABLE_FELT_HZ + TABLE_RAIL,
  halfDiagonal: Math.hypot(TABLE_FELT_HX + TABLE_RAIL, TABLE_FELT_HZ + TABLE_RAIL),
} as const;

/** Fallback cover radius when no live camera is at hand (tests, first frame). */
export const FALLBACK_COVER_RADIUS = TABLE_EXTENT.halfDiagonal * CAP_COVER_MARGIN;

/* Timeline (seconds, blast clock; the flash lands at NUKE_FLASH_S). */
export const NUKE_FLASH_S = 0.3;
export const CAP_START_S = 0.9; // stem rises; cap starts spreading
export const CAP_FULL_S = 2.15; // cap reaches FULL table coverage — no felt visible
export const NUKE_MEGA_STAGE2_S = 1.15; // mega's second detonation, seconds after the flash
export const MEGA_STAGE2_S = NUKE_FLASH_S + NUKE_MEGA_STAGE2_S; // 1.45 on the blast clock
export const MEGA_CAP_FULL_S = 2.35; // mega cap finishes growing past the cover radius
export const CAP_SETTLE_SINK = 0.22; // cloud sinks this far while it settles
export const CAP_SETTLE_WIDEN = 1.05; // …and widens by this factor

/* Scale hierarchy (§D.7): nuke = the table, mega = the room / frame. */
export const NUKE_RING_END = 3.4; // felt shockwave ring, world units (unchanged)
export const MEGA_RING1_END = 7.5; // mega's first ring exits through the near / side edges
export const MEGA_RING2_END = 9.5; // mega's second ring, from the second detonation
export const MEGA_RING2_DUR_S = 1.2; // 1.45 → 2.65
export const MEGA_CAP_OVERSHOOT = 1.36; // mega cap grows this far PAST the cover radius
export const WHITEOUT_FIRST = 0.5; // white-out ball carries this × the first-flash envelope
export const MEGA_WHITEOUT_PEAK = 0.95; // …and spikes to this at the second detonation
export const NUKE_FOV_PUNCH = 0.1; // first-flash camera punch (fraction of fov)
export const MEGA_FOV_PUNCH = 0.22; // mega punches deeper…
export const MEGA_FOV_KICK = 0.1; // …plus this kick × the burst envelope at stage 2
/** Mega debris rains from this height band down past the viewport. */
export const DEBRIS_RAIN_Y = { min: 1.7, max: 3.1 } as const;
/** Ember pool radius for the armed glow: covers the whole trick plus layout. */
export const ARMED_GLOW_RADIUS = 1.3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

type CamPos = readonly [number, number, number] | { x: number; y: number; z: number };
const camXYZ = (c: CamPos): [number, number, number] => ('x' in c ? [c.x, c.y, c.z] : [c[0], c[1], c[2]]);

/**
 * Is `point` (on the felt, y ≈ 0) hidden by a cap disc of `radius` centred on
 * CAP_CENTER in the plane y = CAP_PLANE_Y, seen from `camPos`? True iff the
 * camera→point ray crosses the cap plane inside the disc, before the point.
 */
export function pointOccludedByCap(camPos: CamPos, point: { x: number; z: number }, radius: number): boolean {
  const [cx, cy, cz] = camXYZ(camPos);
  if (!(cy > CAP_PLANE_Y)) return false;
  const t = (cy - CAP_PLANE_Y) / cy; // felt points sit at y = 0
  if (t < 0 || t > 1) return false;
  const ix = cx + t * (point.x - cx);
  const iz = cz + t * (point.z - cz);
  return Math.hypot(ix - CAP_CENTER.x, iz - CAP_CENTER.z) <= radius;
}

/**
 * The cap radius that hides the WHOLE felt+rail rectangle from this camera:
 * the farthest cap-plane crossing over the table perimeter (the maximum of a
 * convex function over the rectangle sits at its boundary), plus the margin.
 * Per-camera values run ≈ 2.85–3.05 across the game's framings.
 */
export function capCoverRadius(camPos: CamPos): number {
  const [cx, cy, cz] = camXYZ(camPos);
  if (!(cy > CAP_PLANE_Y)) return FALLBACK_COVER_RADIUS;
  const t = (cy - CAP_PLANE_Y) / cy;
  const { hx, hz } = TABLE_EXTENT;
  let need = 0;
  const per = 32; // samples per edge; corners included
  for (let e = 0; e < 4; e++) {
    for (let i = 0; i <= per; i++) {
      const u = -1 + (2 * i) / per;
      const px = e < 2 ? u * hx : e === 2 ? hx : -hx;
      const pz = e < 2 ? (e === 0 ? -hz : hz) : u * hz;
      const ix = cx + t * (px - cx);
      const iz = cz + t * (pz - cz);
      need = Math.max(need, Math.hypot(ix - CAP_CENTER.x, iz - CAP_CENTER.z));
    }
  }
  return need * CAP_COVER_MARGIN;
}

export interface MegaBurst {
  /** Seconds since the second detonation (negative before it). */
  tb2: number;
  active: boolean;
  /** Flash / bloom / light envelope of the second detonation. */
  env: number;
  /** Slower light envelope (the point light's re-spike). */
  lightEnv: number;
  /** FOV envelope of the second detonation. */
  fovEnv: number;
  /** FOV change from the kick: −MEGA_FOV_KICK × fovEnv. */
  fovKick: number;
  /** Cap growth multiplier from the burst alone (1 → MEGA_CAP_OVERSHOOT). */
  capScale: number;
  /** White-out ball opacity contributed by the burst. */
  whiteout: number;
  /** Second shockwave ring: radius / alpha (0 when the ring isn't running). */
  ring2Radius: number;
  ring2Alpha: number;
  /** Debris field intensity (0 before stage 2, ramps in, fades with the run). */
  debris: number;
}

/** The mega's frame burst (§E.2 (a)): second phase, on its own envelopes. */
export function megaFrameBurst(T: number, fade = 1): MegaBurst {
  const tb2 = T - MEGA_STAGE2_S;
  if (tb2 <= 0) {
    return { tb2, active: false, env: 0, lightEnv: 0, fovEnv: 0, fovKick: 0, capScale: 1, whiteout: 0, ring2Radius: 0, ring2Alpha: 0, debris: 0 };
  }
  const env = Math.exp(-tb2 * 3.2);
  const fovEnv = Math.exp(-tb2 * 2.6);
  const tr2 = tb2 / MEGA_RING2_DUR_S;
  return {
    tb2,
    active: true,
    env,
    lightEnv: Math.exp(-tb2 * 1.6),
    fovEnv,
    fovKick: -MEGA_FOV_KICK * fovEnv,
    capScale: 1 + (MEGA_CAP_OVERSHOOT - 1) * easeOut(tb2 / (MEGA_CAP_FULL_S - MEGA_STAGE2_S)),
    whiteout: MEGA_WHITEOUT_PEAK * env,
    ring2Radius: tr2 < 1 ? 0.1 + (MEGA_RING2_END - 0.1) * easeOut(tr2) : 0,
    ring2Alpha: tr2 < 1 ? 1 - tr2 : 0,
    debris: Math.min(1, tb2 / 0.15) * fade,
  };
}

/** White-out ball opacity: 0.5 × the first-flash envelope, plus the mega burst spike (≤ 0.95). */
export function whiteoutOpacity(T: number, mega: boolean): number {
  const flash = T >= NUKE_FLASH_S ? Math.exp(-(T - NUKE_FLASH_S) * 4) : 0;
  const burst = mega ? megaFrameBurst(T).whiteout : 0;
  return Math.min(MEGA_WHITEOUT_PEAK, WHITEOUT_FIRST * flash + burst);
}

export interface NukeChoreography {
  T: number;
  len: number;
  mega: boolean;
  /** Global fade: 1 until (len − 1.05), then out to 0 at the run's end. */
  fade: number;
  /** First-flash envelope (bloom / CA / light). */
  flashEnv: number;
  /** Cap spread progress toward the cover radius (eased, 0 → 1 at CAP_FULL_S). */
  coverage: number;
  /** Cap disc radius in world units (mega: past cover after stage 2). */
  capRadius: number;
  /** Cap base-plane height (rises to CAP_PLANE_Y, sinks CAP_SETTLE_SINK while settling). */
  capY: number;
  /** Cap opacity: ramps in as the cap starts, out with the fade; exactly 0 at len. */
  capAlpha: number;
  /** 0 until the fade window, 1 at the run's end. */
  settle: number;
  /** White-out ball opacity at T. */
  whiteout: number;
  /** First shockwave ring: radius / alpha (0 when not running). */
  ringRadius: number;
  ringAlpha: number;
  /** Total FOV reduction as a fraction of the base fov (punch + mega kick). */
  fovPunch: number;
  burst: MegaBurst;
}

/**
 * One sample of the blast's choreography at blast-clock T. Pure: the same T
 * always gives the same frame, which is what fx.warp captures rely on.
 */
export function nukeChoreography(T: number, opts: { mega?: boolean; coverRadius?: number; len?: number } = {}): NukeChoreography {
  const mega = opts.mega ?? false;
  const len = opts.len ?? (mega ? 4.4 : 3.6);
  const cover = opts.coverRadius ?? FALLBACK_COVER_RADIUS;
  const fade = 1 - clamp01((T - (len - 1.05)) / 0.95);
  const settle = clamp01((T - (len - 1.05)) / 0.95);
  const flashEnv = T < NUKE_FLASH_S ? 0 : Math.exp(-(T - NUKE_FLASH_S) * 4);
  const burst = mega ? megaFrameBurst(T, fade) : megaFrameBurst(0); // a plain nuke has no burst
  const coverage = easeOut((T - CAP_START_S) / (CAP_FULL_S - CAP_START_S));
  let capRadius = cover * coverage;
  if (mega) capRadius *= burst.capScale;
  capRadius *= 1 + (CAP_SETTLE_WIDEN - 1) * settle;
  const capY = 0.35 + (CAP_PLANE_Y - 0.35) * coverage - CAP_SETTLE_SINK * settle;
  const capAlpha = clamp01((T - CAP_START_S) / 0.15) * fade;
  // first shockwave ring: nuke runs 1.0 s out to NUKE_RING_END; mega's runs longer, to MEGA_RING1_END
  const ringDur = mega ? 1.6 : 1.0;
  const ringEnd = mega ? MEGA_RING1_END : NUKE_RING_END;
  const tr = (T - NUKE_FLASH_S) / ringDur;
  const ringRadius = tr > 0 && tr < 1 ? 0.1 + (ringEnd - 0.1) * easeOut(tr) : 0;
  const ringAlpha = tr > 0 && tr < 1 ? 1 - tr : 0;
  // camera punch: rises over 0.12 s after the flash, decays; mega punches deeper + the stage-2 kick
  const tb = T - NUKE_FLASH_S;
  const punchEnv = tb < 0 ? 0 : tb < 0.12 ? tb / 0.12 : Math.exp(-(tb - 0.12) * 2.2);
  const fovPunch = (mega ? MEGA_FOV_PUNCH : NUKE_FOV_PUNCH) * punchEnv - burst.fovKick;
  return {
    T, len, mega, fade, flashEnv, coverage, capRadius, capY, capAlpha, settle,
    whiteout: whiteoutOpacity(T, mega), ringRadius, ringAlpha, fovPunch, burst,
  };
}

/* ------------------------- particle budget ------------------------- *
 * Base counts at detail 1 for the plain nuke. The rebalanced sum is still
 * 640 (= the old 220 + 160 + 140 + 120): the mega's debris kind is funded
 * by trimming smoke / dust / embers / ash, not by raising the total. The
 * mega scales every kind by ×1.4 (its profile multiplier), so the mega
 * total is exactly ×1.4 of the nuke's at equal detail — on iOS
 * (detail 0.45) that is 0.63 × the desktop nuke, as before.
 */
export const NUKE_PARTICLE_BASE = { smoke: 190, dust: 135, embers: 110, ash: 100, debris: 105 } as const;
export type NukeParticleKind = keyof typeof NUKE_PARTICLE_BASE;
export const MEGA_PARTICLE_SCALE = 1.4;

export interface ParticleBudget {
  counts: Record<NukeParticleKind, number>;
  total: number;
}

export function particleBudget(detail: number, mega: boolean): ParticleBudget {
  const k = detail * (mega ? MEGA_PARTICLE_SCALE : 1);
  const counts = {} as Record<NukeParticleKind, number>;
  let total = 0;
  for (const kind of Object.keys(NUKE_PARTICLE_BASE) as NukeParticleKind[]) {
    counts[kind] = Math.round(NUKE_PARTICLE_BASE[kind] * k);
    total += counts[kind];
  }
  return { counts, total };
}

/* --------------------- card silhouettes in the cloud --------------------- */

/** Silhouette cards tumbling inside the cloud wall: at most 9 meshes, detail-scaled. */
export function cloudCardCount(detail: number): number {
  return Math.max(0, Math.min(9, Math.round(9 * detail)));
}

const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export interface CloudCardPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** Orbit radius as a fraction of the cap radius (≤ 0.92 — never past the wall). */
  orbitFrac: number;
  opacity: number;
}

/**
 * Pose of silhouette card i at blast-clock T: a pure function, so warp
 * captures and resume agree. Cards orbit inside the wall (≤ 92 % of the cap
 * radius), stay under the cap plane, and only read while the cap is near
 * full coverage.
 */
export function cloudCardPose(i: number, T: number, capRadius: number): CloudCardPose {
  const r1 = hash01(i * 3 + 1), r2 = hash01(i * 3 + 2), r3 = hash01(i * 3 + 3);
  const dir = i % 2 === 0 ? 1 : -1;
  const ang = r1 * Math.PI * 2 + dir * T * (0.25 + 0.3 * r2);
  const orbitFrac = 0.3 + 0.6 * r2;
  const orbit = orbitFrac * capRadius;
  const y = 0.12 + 0.55 * r3 + Math.sin(T * (1.1 + r1) + i * 1.7) * 0.05;
  const vis = clamp01((T - (CAP_START_S + 0.3)) / (CAP_FULL_S - CAP_START_S - 0.3));
  return {
    x: CAP_CENTER.x + Math.cos(ang) * orbit,
    y: Math.min(y, CAP_PLANE_Y - 0.07),
    z: CAP_CENTER.z + Math.sin(ang) * orbit,
    rx: r1 * 6.28 + T * (0.6 + r3),
    ry: r2 * 6.28 + dir * T * 0.8,
    rz: r3 * 6.28 + T * 0.5,
    orbitFrac,
    opacity: vis,
  };
}

/* --------------------------- armed ember pulse --------------------------- */

/**
 * Ember-light pulse under the armed trick cards: the old on-card outline's
 * 1 Hz cadence plus a flicker harmonic. Reduced motion = a steady 0.55.
 * Always within [0, 1]; centred on 0.55.
 */
export function armedEmberPulse(T: number, reduced = false): number {
  if (reduced) return 0.55;
  const v = 0.55 + 0.28 * Math.sin(T * Math.PI * 2) + 0.12 * Math.sin(T * Math.PI * 2 * 2.7 + 0.7);
  return Math.min(1, Math.max(0, v));
}
