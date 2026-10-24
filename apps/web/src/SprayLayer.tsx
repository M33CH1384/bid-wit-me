/**
 * The spray-paint transition layer (owner, 2026-10-23) — the visual half
 * of spray.ts. Mounted once in Root beside InkLayer / SocialRoot. It
 * renders nothing while idle; during a spray it is one fixed layer of
 * DOM + SVG.
 *
 * V4 — COMPOSITOR-DRIVEN (owner, 2026-10-23, after v3's verdict:
 * "still very choppy and far from smooth"). The first three
 * generations of this layer painted full-screen canvases every frame
 * (v1's swept spray front, v2's stamp walk, v3's pre-rendered sprites
 * behind per-frame mask composites and draw calls at DPR 2 on a
 * 1170x2532 phone). iOS Safari cannot
 * composite that chain at 60 fps, and the dropped frames WERE the
 * choppiness. So v4 paints nothing per frame: every moving part is a
 * property the browser composites on the GPU — transform, opacity,
 * clip-path, SVG stroke-dashoffset — animated with Web Animations
 * created once per spray episode. JS keeps only the controller duties
 * it always had (spray.ts owns eligibility, timers, the swap at full
 * cover, the failsafe); this file translates the snapshot into
 * animation parameters. The only canvas work left in the whole
 * transition is sprayTextures.ts rendering its small static textures
 * once.
 *
 * The choreography is v3's, untouched — the owner accepted it; only
 * the rendering was wrong. Three strict beats inside the ~1310 ms
 * cover, a hold, then the reveal:
 *   1. OUTLINE (~590 ms): the can travels the spade's COMPLETE
 *      contour. The spade is the game's own mark — the verbatim path
 *      from public/favicon.svg — drawn as layered SVG strokes via
 *      stroke-dashoffset (a wide wet under-stroke + a dense core),
 *      while a dotted speckle stroke and the overspray halo gather by
 *      opacity, and a nozzle dab rides the frontier on a transform
 *      keyframe track sampled from the outline's arc length (the
 *      compositor interpolates between samples; the dab never steps).
 *      The interior stays EMPTY in this beat.
 *   2. INTERIOR (~470 ms): the fill (a second stacked SVG of the same
 *      mark) is revealed by a clip-path inset animation while a soft
 *      pre-rendered speckle front sweeps down over the clip edge and
 *      the nozzle sways across it — the fill arrives feathered, not
 *      as a hard wipe.
 *   3. BLOOM (~250 ms): a black disc and a speckle-ring texture
 *      expand from the spade's center by transform scale (ease-out)
 *      until the corners are covered; at full cover the controller
 *      swaps the screen underneath.
 * HOLD (~90 ms): the paint sits at full black — stillness that sells
 * the cover — then clears.
 * REVEAL (~390 ms): the canvas grain erase is gone too. Three
 * stacked paint layers carrying static grain masks fade on staggered
 * opacity curves — the solid base first, then the grain layers
 * thinning at different rates — so the black breaks into speckle and
 * dissolves off the new screen exactly as before, but every frame of
 * it is an opacity composite.
 *
 * TUNING PASSES (owner, 2026-10-23, on v4: "I like it but it still
 * needs to be slower, cleaner, and should fill most of the screen" —
 * then, deeper spec: slower still): the whole program stretched
 * twice over (full cycle 850 -> 1280 -> 1790 ms; the outline is the
 * signature and keeps the largest share, the interior gets room to
 * breathe, and a hold at full black was added); the spray character
 * tidied — halo pulled in close and thinned, speckle smaller and
 * sparser, fill grain finer and lower-contrast, the bloom's ring a
 * thinner annulus — crisp first, spray-textured second; and the
 * spade grew from ~46% to ~84% of the viewport height (min() of
 * height and width budgets, 6-9% safe margins on every side) so it
 * fills most of the screen. The engine and the beat order did not
 * change.
 *
 * Snap-back: when a dissolve is snapped back into a cover, spray.ts
 * reports fromCoverage; every cover animation is created with
 * delay = beatStart - fromCoverage * SPRAY_COVER_MS. Negative delays
 * start an animation partway through, fill mode 'both' holds end
 * states until the controller flushes, and the beats resume in order.
 *
 * If Web Animations are unavailable the layer still mounts with its
 * initial states (outline undrawn, paint layers solid) and the
 * controller's timers clear it on schedule — worst case is a plain
 * beat of black, never a stuck screen.
 *
 * INK BLOOM (the Neon skin of this program, owner 2026-10-23 "Build
 * them all"): under the Neon theme the controller resolves menu-space
 * moves to program 'ink', and this layer renders the SAME
 * choreography re-skinned — the spade forms from blooming, curling
 * ink in the Neon palette (midnight navy, violet, electric blue,
 * cyan), the cover completes to ink-dark, and the reveal is the ink
 * dissipating. Identical beats, identical timings, identical
 * controller semantics (theme parity: visuals only) — the animation
 * scheduling below is shared verbatim; only the art differs, and the
 * ink-only pieces (poured splats, curling blooms at the lobes) are
 * extra composited tweens the shared scheduler runs when their
 * elements exist. The ink's textures are static like the spray's
 * (inkTextures.ts, rendered once).
 */
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import {
  SPRAY_COVER_MS,
  SPRAY_FILL_MS,
  SPRAY_HOLD_MS,
  SPRAY_OUTLINE_MS,
  SPRAY_REVEAL_MS,
  SPRAY_SPADE_MS,
  getSpraySnapshot,
  registerSprayRenderer,
  subscribeSpray,
} from './spray';
import { getSprayTextures } from './sprayTextures';
import { getInkTextures } from './inkTextures';
import './spray.css';

const PAINT = '#070708';
/** Beat 3's length: what the cover leaves after outline + interior. */
const SPRAY_BLOOM_MS = SPRAY_COVER_MS - SPRAY_SPADE_MS;
/** easings.net easeInOutCubic / easeOutCubic as beziers — the same
 *  curves v3's canvas program eased its frontier and bloom with. */
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const EASE_OUT = 'cubic-bezier(0.33, 1, 0.68, 1)';

/* ------------------------------------------------------------------ */
/* The spade. Geometry decoded from public/favicon.svg — the game's    */
/* own mark (viewBox 0 0 64 64, spade spans x 12..52, y 8..56).        */
/* SPADE_D is the favicon's path data verbatim, painted by the SVG.    */
/* The segment table is the same path decoded into cubics              */
/* ([c1x, c1y, c2x, c2y, x, y] in favicon units, each starting where   */
/* the previous ended, opening at the tip (32, 8); the base line is   */
/* a degenerate cubic) so one sampler walks the outline for the        */
/* dab's arc-length track. Keep in sync if the mark ever changes.      */
/* ------------------------------------------------------------------ */
const SPADE_D =
  'M32 8C26 18 12 26 12 37c0 7 5 11 11 11 3.5 0 6.2-1.4 7.4-3.2C30 50 27.5 54 22 56h20c-5.5-2-8-6-8.4-11.2C34.8 46.6 37.5 48 41 48c6 0 11-4 11-11C52 26 38 18 32 8z';
const SPADE_START: { x: number; y: number } = { x: 32, y: 8 };
const SPADE_SEGS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [26, 18, 12, 26, 12, 37], // tip -> left lobe, outer
  [12, 44, 17, 48, 23, 48], // left lobe, bottom
  [26.5, 48, 29.2, 46.6, 30.4, 44.8], // in toward the stem
  [30, 50, 27.5, 54, 22, 56], // stem, left side
  [28.7, 56, 35.3, 56, 42, 56], // base (straight in the source path)
  [36.5, 54, 34, 50, 33.6, 44.8], // stem, right side
  [34.8, 46.6, 37.5, 48, 41, 48], // out to the right lobe
  [47, 48, 52, 44, 52, 37], // right lobe, bottom
  [52, 26, 38, 18, 32, 8], // right lobe, outer -> tip
];
const SPADE_W_UNITS = 40; // 52 - 12
const SPADE_H_UNITS = 48; // 56 - 8

export interface SpadeOutline {
  /** Sampled outline points in favicon units, tip first, closed. */
  pts: Array<{ x: number; y: number; cum: number }>;
  /** Total outline length in favicon units. */
  length: number;
}

/** Sample the spade outline at fine steps with cumulative arc length
 *  (normalized 0..1 in `cum`). Pure math over the segment table — exported
 *  so the choreography's geometry is pinned by tests, not by eyeballing. */
export function buildSpadeOutline(subdiv = 42): SpadeOutline {
  const raw: Array<{ x: number; y: number }> = [{ ...SPADE_START }];
  let pen = { ...SPADE_START };
  for (const [c1x, c1y, c2x, c2y, x, y] of SPADE_SEGS) {
    for (let i = 1; i <= subdiv; i++) {
      const t = i / subdiv;
      const u = 1 - t;
      raw.push({
        x: u * u * u * pen.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        y: u * u * u * pen.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
      });
    }
    pen = { x, y };
  }
  let length = 0;
  const pts = raw.map((p, i) => {
    if (i > 0) {
      const q = raw[i - 1]!;
      length += Math.hypot(p.x - q.x, p.y - q.y);
    }
    return { ...p, cum: length };
  });
  for (const p of pts) p.cum = length > 0 ? p.cum / length : 0;
  return { pts, length };
}

export const SPADE_OUTLINE: SpadeOutline = buildSpadeOutline();

/** The spade path itself, so sibling transition art (the Card Fan)
 *  can carry the same mark without duplicating the path data. */
export const SPADE_PATH_D = SPADE_D;

/* ------------------------------------------------------------------ */
/* Layout — the same numbers v3's canvas program used.                 */
/* ------------------------------------------------------------------ */

/** The speckle ring rides a disc this much larger than the solid bloom
 *  disc, so its baked annulus straddles the disc's expanding edge.
 *  1.18 -> 1.1 in the clean pass: the ring hugs the disc's edge. */
const RING_OVER = 1.1;

export interface SpadeGeo {
  cx: number;
  cy: number;
  /** CSS px per favicon unit. */
  k: number;
  left: number;
  top: number;
  w: number;
  h: number;
  brush: number;
  /** The interior front's feather band, px. */
  band: number;
  /** Bloom disc radius at full scale (past the farthest corner). */
  maxR: number;
  /** Bloom disc scale at the beat's start (radius = spade h * 0.3). */
  bloomS0: number;
  /** Ring disc scale at the beat's start, matching the disc's radius. */
  ringS0: number;
  /** Outline points in spade-box px (origin at the mark's bbox
   *  top-left) with cumulative length in px — the dab's track. */
  pts: Array<{ x: number; y: number; cum: number }>;
  outlineLen: number;
}

export function spadeGeometry(vw: number, vh: number): SpadeGeo {
  // Fill most of the screen (owner, 2026-10-23: "should fill most of
  // the screen"): ~84% of the viewport height, centered — but the
  // spade is ~0.83 w/h, so on a tall narrow phone the height budget
  // alone would push it off the sides. The size is a min() of the two
  // budgets: height-bound on wide screens, width-bound (~86% of the
  // width) on portrait phones — either way 6-9% of safe margin
  // survives on every side.
  const h = Math.min(vh * 0.84, (vw * 0.86 * SPADE_H_UNITS) / SPADE_W_UNITS);
  const w = (h * SPADE_W_UNITS) / SPADE_H_UNITS;
  const k = h / SPADE_H_UNITS;
  const cx = vw / 2;
  const cy = vh / 2;
  const outlineLen = SPADE_OUTLINE.length * k;
  const pts = SPADE_OUTLINE.pts.map((p) => ({
    x: (p.x - 12) * k,
    y: (p.y - 8) * k,
    cum: p.cum * outlineLen,
  }));
  const brush = Math.min(46, Math.max(15, h * 0.088));
  const maxR = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy)) + brush * 1.6;
  const bloomS0 = (h * 0.3) / maxR;
  return {
    cx,
    cy,
    k,
    left: cx - w / 2,
    top: cy - h / 2,
    w,
    h,
    brush,
    band: h * 0.3,
    maxR,
    bloomS0,
    ringS0: bloomS0 / RING_OVER,
    pts,
    outlineLen,
  };
}

/** Point at arc length `target` (px) along the outline, interpolated
 *  between the sampled points — the dab's keyframe track is sampled
 *  from this, so the can's position is continuous in arc length. */
function frontierAt(
  pts: SpadeGeo['pts'],
  target: number,
): { x: number; y: number } {
  if (target <= 0) return { x: pts[0]!.x, y: pts[0]!.y };
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.cum >= target) {
      const q = pts[i - 1]!;
      const span = p.cum - q.cum;
      const f = span > 0 ? (target - q.cum) / span : 0;
      return { x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f };
    }
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x, y: last.y };
}

const bgOf = (url: string): string | undefined => (url ? `url(${url})` : undefined);

/** A reveal grain layer's style: solid paint seen through a static
 *  grain mask (both mask spellings — iOS Safari still wants -webkit-). */
function grainStyle(url: string, size: string, position: string): CSSProperties {
  if (!url) return {};
  const image = `url(${url})`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: size,
    WebkitMaskSize: size,
    maskPosition: position,
    WebkitMaskPosition: position,
    maskMode: 'alpha',
  } as CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Ink Bloom art — the Neon skin. Same spade, same data-anim pieces,   */
/* same schedule; the paint is ink: gradient strokes (violet ->       */
/* electric blue -> cyan), poured splat overlays, curling blooms at    */
/* the lobes, an ink-dark bloom, and a dissipating reveal.             */
/* ------------------------------------------------------------------ */

const INK_DARK = '#04050e';

interface SpadeArtProps {
  geo: SpadeGeo;
  len: number;
  coreW: number;
  wetW: number;
  speckleW: number;
  dabPx: number;
  tipX: number;
}

function InkCoverArt({ geo, len, coreW, wetW, speckleW, dabPx, tipX }: SpadeArtProps) {
  const itx = getInkTextures();
  return (
    <div className="spray-cover">
      <div
        className="spray-spadebox"
        style={{ left: geo.left, top: geo.top, width: geo.w, height: geo.h }}
      >
        <div
          data-anim="ink-curl-a"
          className="ink-blob"
          style={{
            left: '-16%',
            top: '-4%',
            width: '72%',
            height: '72%',
            backgroundImage: bgOf(itx.splats),
            opacity: 0,
          }}
        />
        <div
          data-anim="ink-curl-b"
          className="ink-blob"
          style={{
            right: '-16%',
            bottom: '-6%',
            width: '72%',
            height: '72%',
            backgroundImage: bgOf(itx.splats),
            opacity: 0,
          }}
        />
        <svg className="spray-svg" viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <linearGradient id="ink-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8054FF" />
              <stop offset="0.5" stopColor="#269CFF" />
              <stop offset="1" stopColor="#5BDFFF" />
            </linearGradient>
          </defs>
          <path
            data-anim="halo"
            d={SPADE_D}
            fill="#8054FF"
            opacity={0}
            transform="translate(32 32) scale(1.05) translate(-32 -32)"
          />
          <path
            data-anim="speckle"
            d={SPADE_D}
            fill="none"
            stroke="#5BDFFF"
            strokeWidth={speckleW}
            strokeDasharray="0.01 5.6"
            strokeLinecap="round"
            opacity={0}
          />
          <path
            data-anim="wet"
            d={SPADE_D}
            fill="none"
            stroke="#269CFF"
            strokeWidth={wetW}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={len}
            strokeDasharray={len}
            strokeDashoffset={len}
            opacity={0.18}
          />
          <path
            data-anim="core"
            d={SPADE_D}
            fill="none"
            stroke="url(#ink-grad)"
            strokeWidth={coreW}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={len}
            strokeDasharray={len}
            strokeDashoffset={len}
            opacity={0.97}
          />
        </svg>
        <svg
          className="spray-svg"
          data-anim="fill"
          viewBox="0 0 64 64"
          aria-hidden="true"
          style={{ clipPath: 'inset(0 0 100% 0)' }}
        >
          <defs>
            <linearGradient id="ink-grad-fill" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#8054FF" />
              <stop offset="0.55" stopColor="#269CFF" />
              <stop offset="1" stopColor="#5BDFFF" />
            </linearGradient>
            <pattern id="ink-fill-dots" width="5" height="5" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1.2" r="0.4" fill="#5BDFFF" opacity="0.35" />
              <circle cx="3.4" cy="2.6" r="0.5" fill="#070914" opacity="0.3" />
              <circle cx="2" cy="4" r="0.3" fill="#8054FF" opacity="0.3" />
              <circle cx="4.3" cy="4.4" r="0.32" fill="#0a1030" opacity="0.26" />
            </pattern>
          </defs>
          <path d={SPADE_D} fill="url(#ink-grad-fill)" />
          <path d={SPADE_D} fill="url(#ink-fill-dots)" />
          <path d={SPADE_D} fill={INK_DARK} opacity={0.22} />
        </svg>
        <div
          data-anim="ink-splats"
          className="ink-splats"
          style={{ backgroundImage: bgOf(itx.splats), opacity: 0 }}
        />
        <div
          data-anim="front"
          className="spray-front"
          style={{
            left: -geo.w * 0.06,
            width: geo.w * 1.12,
            height: geo.band,
            backgroundImage: bgOf(itx.front),
            opacity: 0,
          }}
        />
        <div
          data-anim="dab-trace"
          className="spray-dab"
          style={{ width: dabPx, height: dabPx, opacity: 0 }}
        >
          <div className="spray-dab-puff" style={{ backgroundImage: bgOf(itx.brush) }} />
          <div className="spray-dab-in" style={{ backgroundImage: bgOf(itx.brush) }} />
        </div>
        <div
          data-anim="dab-fill"
          className="spray-dab"
          style={{ left: tipX, width: dabPx, height: dabPx, opacity: 0 }}
        >
          <div className="spray-dab-puff" style={{ backgroundImage: bgOf(itx.brush) }} />
          <div className="spray-dab-in" style={{ backgroundImage: bgOf(itx.brush) }} />
        </div>
      </div>
      <div
        data-anim="bloom"
        className="spray-bloom"
        style={{
          left: geo.cx - geo.maxR,
          top: geo.cy - geo.maxR,
          width: geo.maxR * 2,
          height: geo.maxR * 2,
          background: INK_DARK,
          transform: `scale(${geo.bloomS0})`,
          opacity: 0,
        }}
      />
      <div
        data-anim="bloom-ring"
        className="spray-bloom"
        style={{
          left: geo.cx - geo.maxR * RING_OVER,
          top: geo.cy - geo.maxR * RING_OVER,
          width: geo.maxR * 2 * RING_OVER,
          height: geo.maxR * 2 * RING_OVER,
          backgroundImage: bgOf(itx.ring),
          backgroundSize: '100% 100%',
          transform: `scale(${geo.ringS0})`,
          opacity: 0,
        }}
      />
    </div>
  );
}

function InkRevealArt() {
  const itx = getInkTextures();
  return (
    <div className="ink-reveal">
      <div data-anim="rv-base" className="spray-rv ink-rv" />
      <div
        data-anim="rv-grain-a"
        className="spray-rv ink-rv-grain"
        style={grainStyle(itx.grainA, '200px 200px', '17px 41px')}
      />
      <div
        data-anim="rv-grain-b"
        className="spray-rv ink-rv-grain"
        style={grainStyle(itx.grainB, '280px 280px', '113px 67px')}
      />
    </div>
  );
}

export default function SprayLayer() {
  const snap = useSyncExternalStore(subscribeSpray, getSpraySnapshot);
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    registerSprayRenderer(true);
    return () => registerSprayRenderer(false);
  }, []);

  const sprayId = snap.episodeId;
  const phase = snap.phase;
  const active = phase !== 'idle';
  const fromCoverage = snap.fromCoverage;

  /* Create the episode's animations. Everything here runs ONCE per
   * episode (per sprayId / phase flip) — the animations themselves
   * are compositor tweens; no frame loop exists anywhere in v4. */
  useEffect(() => {
    if (!active) return;
    const root = layerRef.current;
    if (!root) return;
    const anims: Animation[] = [];
    const run = (
      el: Element | null,
      keyframes: Keyframe[],
      opts: KeyframeAnimationOptions,
    ): void => {
      if (!el || typeof el.animate !== 'function') return;
      try {
        const a = el.animate(keyframes, { fill: 'both', ...opts });
        // A cancelled animation rejects its finished promise; nobody
        // awaits it, so mark it handled before it can surface as an
        // unhandled rejection at cleanup time.
        a.finished?.catch(() => undefined);
        anims.push(a);
      } catch {
        /* no usable WAAPI: initial states hold and the controller's
         * timers still clear the layer on schedule */
      }
    };
    const q = (name: string): Element | null =>
      root.querySelector(`[data-anim="${name}"]`);

    if (phase === 'cover') {
      const geo = spadeGeometry(window.innerWidth, window.innerHeight);
      // Snap-back resume point: the cover program is a function of
      // position along its timeline, and position == coverage, so a
      // re-cover from a partially dissolved reveal resumes by shifting
      // every beat's delay back by the credited coverage.
      const resumeMs = fromCoverage * SPRAY_COVER_MS;
      const LEN = SPADE_OUTLINE.length;

      // Beat 1 — the outline draws itself: layered strokes tweened by
      // stroke-dashoffset (pathLength normalizes the dash math to the
      // outline's own length); speckle + halo gather by opacity.
      const draw: Keyframe[] = [
        { strokeDashoffset: String(LEN) },
        { strokeDashoffset: '0' },
      ];
      const drawOpts: KeyframeAnimationOptions = {
        duration: SPRAY_OUTLINE_MS,
        delay: -resumeMs,
        easing: EASE_IN_OUT,
      };
      run(q('wet'), draw, drawOpts);
      run(q('core'), draw, drawOpts);
      run(q('speckle'), [{ opacity: '0' }, { opacity: '0.3' }], {
        duration: SPRAY_OUTLINE_MS,
        delay: -resumeMs,
        easing: 'ease-out',
      });
      run(q('halo'), [{ opacity: '0' }, { opacity: '0.55' }], {
        duration: SPRAY_SPADE_MS,
        delay: -resumeMs,
        easing: 'ease-out',
      });
      // The nozzle dab rides the frontier on a transform track sampled
      // from the outline's arc length — 41 stops the compositor
      // interpolates between under the beat's easing (the track is
      // fine enough, and the easing smooth enough, that the frontier
      // motion carries no step quantisation at all).
      const STOPS = 40;
      const dabFrames: Keyframe[] = [];
      for (let i = 0; i <= STOPS; i++) {
        const f = frontierAt(geo.pts, (i / STOPS) * geo.outlineLen);
        const frame: Keyframe = {
          transform: `translate(${f.x}px, ${f.y}px)`,
          offset: i / STOPS,
        };
        if (i === 0) frame.opacity = '0';
        if (i === 2) frame.opacity = '1';
        if (i === STOPS - 2) frame.opacity = '1';
        if (i === STOPS) frame.opacity = '0';
        dabFrames.push(frame);
      }
      run(q('dab-trace'), dabFrames, {
        duration: SPRAY_OUTLINE_MS,
        delay: -resumeMs,
        easing: EASE_IN_OUT,
      });

      // Beat 2 — the interior sprays in: the fill SVG's clip-path
      // opens top-to-bottom while the wet front strip sweeps over the
      // clip edge and the second dab sways across the front. Starts
      // only when the outline stands complete (delay = beat 1's end).
      const fillAt: KeyframeAnimationOptions = {
        duration: SPRAY_FILL_MS,
        delay: SPRAY_OUTLINE_MS - resumeMs,
        easing: EASE_IN_OUT,
      };
      run(
        q('fill'),
        [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }],
        fillAt,
      );
      run(
        q('front'),
        [
          { transform: `translateY(${-geo.band}px)`, opacity: '0' },
          { opacity: '1', offset: 0.15 },
          { opacity: '1', offset: 0.75 },
          { transform: `translateY(${geo.h}px)`, opacity: '0' },
        ],
        fillAt,
      );
      run(
        q('dab-fill'),
        [
          { transform: 'translate(0px, 0px)', opacity: '0' },
          { opacity: '1', offset: 0.12 },
          {
            transform: `translate(${geo.w * 0.1}px, ${geo.h * 0.5}px)`,
            opacity: '1',
            offset: 0.5,
          },
          { transform: `translate(${geo.w * -0.17}px, ${geo.h}px)`, opacity: '0' },
        ],
        { ...fillAt, easing: 'ease-in-out' },
      );

      // Beat 3 — the bloom out to full black: disc + speckle ring
      // scaling from the spade's center (delay = the spade sequence's
      // end, so the bloom never starts early).
      const bloomOpts: KeyframeAnimationOptions = {
        duration: SPRAY_BLOOM_MS,
        delay: SPRAY_SPADE_MS - resumeMs,
        easing: EASE_OUT,
      };
      run(
        q('bloom'),
        [
          { opacity: '0', transform: `scale(${geo.bloomS0})` },
          { opacity: '1', offset: 0.18 },
          { opacity: '1', transform: 'scale(1)' },
        ],
        bloomOpts,
      );
      run(
        q('bloom-ring'),
        [
          { opacity: '0', transform: `scale(${geo.ringS0})` },
          { opacity: '0.9', offset: 0.18 },
          { opacity: '0.9', transform: 'scale(1)' },
        ],
        bloomOpts,
      );

      // Ink skin extras — these elements exist only in the ink art
      // (run() no-ops on a missing element, so the spray is
      // untouched): the poured splats gather across the spade
      // sequence while two ink blooms curl slowly at the lobes —
      // rotation + scale drift, all composited.
      run(q('ink-splats'), [{ opacity: '0' }, { opacity: '0.75' }], {
        duration: SPRAY_SPADE_MS,
        delay: -resumeMs,
        easing: 'ease-out',
      });
      run(
        q('ink-curl-a'),
        [
          { opacity: '0', transform: 'rotate(0deg) scale(1)' },
          { opacity: '0.8', transform: 'rotate(22deg) scale(1.14)' },
        ],
        { duration: SPRAY_COVER_MS, delay: -resumeMs, easing: 'ease-out' },
      );
      run(
        q('ink-curl-b'),
        [
          { opacity: '0', transform: 'rotate(0deg) scale(1.1)' },
          { opacity: '0.7', transform: 'rotate(-18deg) scale(0.98)' },
        ],
        { duration: SPRAY_COVER_MS, delay: -resumeMs, easing: 'ease-out' },
      );
    } else {
      // Reveal — the HOLD first: for SPRAY_HOLD_MS nothing moves at
      // all (every fade below is delayed by it; the three paint
      // layers at full opacity are flat black, indistinguishable
      // from the cover's final state, and the swap has already landed
      // underneath). Then staggered opacity fades over the static
      // grain masks: the solid base clears first, the masked layers
      // linger by dot density, the last grains drift slightly as
      // they thin. The stagger landmarks are PROPORTIONS of the
      // reveal (base clears at ~46%, grain A holds to ~89%, grain B
      // lands exactly at the end), so the curves re-proportion
      // themselves whenever SPRAY_REVEAL_MS stretches.
      run(q('rv-base'), [{ opacity: '1' }, { opacity: '0' }], {
        duration: SPRAY_REVEAL_MS * 0.46,
        delay: SPRAY_HOLD_MS,
        easing: EASE_OUT,
      });
      run(q('rv-grain-a'), [{ opacity: '1' }, { opacity: '0' }], {
        duration: SPRAY_REVEAL_MS * 0.73,
        delay: SPRAY_HOLD_MS + SPRAY_REVEAL_MS * 0.16,
        easing: EASE_OUT,
      });
      run(
        q('rv-grain-b'),
        [
          { opacity: '1', transform: 'scale(1)' },
          { opacity: '0', transform: 'scale(1.035)' },
        ],
        {
          duration: SPRAY_REVEAL_MS * 0.84,
          delay: SPRAY_HOLD_MS + SPRAY_REVEAL_MS * 0.16,
          easing: EASE_OUT,
        },
      );
    }
    return () => {
      for (const a of anims) {
        try {
          a.cancel();
        } catch {
          /* already finished or detached */
        }
      }
    };
  }, [sprayId, phase, active, fromCoverage]);

  if (!active) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
  const geo = spadeGeometry(vw, vh);
  const tex = getSprayTextures();
  const LEN = SPADE_OUTLINE.length;
  const dabPx = geo.brush * 1.18;
  // Stroke widths in favicon units (v3's brush recipe; the wet and
  // speckle ratios thinned in the clean pass so the core line reads
  // crisp first and spray-textured second).
  const coreW = (geo.brush * 0.8) / geo.k;
  const wetW = (geo.brush * 1.3) / geo.k;
  const speckleW = (geo.brush * 0.8) / geo.k;
  const tipX = (SPADE_START.x - 12) * geo.k;
  const ink = snap.program === 'ink';

  return (
    <div
      ref={layerRef}
      className="spray-layer"
      data-testid="spray-layer"
      data-phase={snap.phase}
      aria-hidden="true"
      style={{ pointerEvents: snap.phase === 'cover' ? 'auto' : 'none' }}
    >
      {snap.phase === 'cover' ? (
        ink ? (
          <InkCoverArt geo={geo} len={LEN} coreW={coreW} wetW={wetW} speckleW={speckleW} dabPx={dabPx} tipX={tipX} />
        ) : (
        <div className="spray-cover">
          <div
            className="spray-spadebox"
            style={{ left: geo.left, top: geo.top, width: geo.w, height: geo.h }}
          >
            <svg className="spray-svg" viewBox="0 0 64 64" aria-hidden="true">
              <path
                data-anim="halo"
                d={SPADE_D}
                fill={PAINT}
                opacity={0}
                transform="translate(32 32) scale(1.035) translate(-32 -32)"
              />
              <path
                data-anim="speckle"
                d={SPADE_D}
                fill="none"
                stroke={PAINT}
                strokeWidth={speckleW}
                strokeDasharray="0.01 5.6"
                strokeLinecap="round"
                opacity={0}
              />
              <path
                data-anim="wet"
                d={SPADE_D}
                fill="none"
                stroke={PAINT}
                strokeWidth={wetW}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={LEN}
                strokeDasharray={LEN}
                strokeDashoffset={LEN}
                opacity={0.11}
              />
              <path
                data-anim="core"
                d={SPADE_D}
                fill="none"
                stroke={PAINT}
                strokeWidth={coreW}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={LEN}
                strokeDasharray={LEN}
                strokeDashoffset={LEN}
                opacity={0.97}
              />
            </svg>
            <svg
              className="spray-svg"
              data-anim="fill"
              viewBox="0 0 64 64"
              aria-hidden="true"
              style={{ clipPath: 'inset(0 0 100% 0)' }}
            >
              <defs>
                <pattern
                  id="spray-fill-grain"
                  width="5"
                  height="5"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="0.9" cy="1.2" r="0.35" fill="#0a0a0c" opacity="0.28" />
                  <circle cx="3.4" cy="2.4" r="0.5" fill="#101014" opacity="0.24" />
                  <circle cx="2" cy="4" r="0.3" fill="#050505" opacity="0.28" />
                  <circle cx="4.3" cy="4.5" r="0.32" fill="#0a0a0c" opacity="0.22" />
                </pattern>
              </defs>
              <path d={SPADE_D} fill={PAINT} />
              <path d={SPADE_D} fill="url(#spray-fill-grain)" />
            </svg>
            <div
              data-anim="front"
              className="spray-front"
              style={{
                left: -geo.w * 0.06,
                width: geo.w * 1.12,
                height: geo.band,
                backgroundImage: bgOf(tex.front),
                opacity: 0,
              }}
            />
            <div
              data-anim="dab-trace"
              className="spray-dab"
              style={{ width: dabPx, height: dabPx, opacity: 0 }}
            >
              <div
                className="spray-dab-puff"
                style={{ backgroundImage: bgOf(tex.brush) }}
              />
              <div
                className="spray-dab-in"
                style={{ backgroundImage: bgOf(tex.brush) }}
              />
            </div>
            <div
              data-anim="dab-fill"
              className="spray-dab"
              style={{ left: tipX, width: dabPx, height: dabPx, opacity: 0 }}
            >
              <div
                className="spray-dab-puff"
                style={{ backgroundImage: bgOf(tex.brush) }}
              />
              <div
                className="spray-dab-in"
                style={{ backgroundImage: bgOf(tex.brush) }}
              />
            </div>
          </div>
          <div
            data-anim="bloom"
            className="spray-bloom"
            style={{
              left: geo.cx - geo.maxR,
              top: geo.cy - geo.maxR,
              width: geo.maxR * 2,
              height: geo.maxR * 2,
              background: PAINT,
              transform: `scale(${geo.bloomS0})`,
              opacity: 0,
            }}
          />
          <div
            data-anim="bloom-ring"
            className="spray-bloom"
            style={{
              left: geo.cx - geo.maxR * RING_OVER,
              top: geo.cy - geo.maxR * RING_OVER,
              width: geo.maxR * 2 * RING_OVER,
              height: geo.maxR * 2 * RING_OVER,
              backgroundImage: bgOf(tex.ring),
              backgroundSize: '100% 100%',
              transform: `scale(${geo.ringS0})`,
              opacity: 0,
            }}
          />
        </div>
        )
      ) : ink ? (
        <InkRevealArt />
      ) : (
        <div className="spray-reveal">
          <div data-anim="rv-base" className="spray-rv" />
          <div
            data-anim="rv-grain-a"
            className="spray-rv"
            style={grainStyle(tex.grainA, '200px 200px', '17px 41px')}
          />
          <div
            data-anim="rv-grain-b"
            className="spray-rv"
            style={grainStyle(tex.grainB, '280px 280px', '113px 67px')}
          />
        </div>
      )}
    </div>
  );
}
