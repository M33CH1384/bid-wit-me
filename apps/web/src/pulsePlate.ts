/**
 * Placement and alpha checks for the Big Joker pulse plate.
 * The pixels are procedural (scripts/render-joker-pulse.mjs), CC0.
 * See apps/web/public/fx/LICENSE.md.
 */

export const WEBM_PULSE_SRC = '/fx/joker-pulse.webm';
/**
 * Real HEVC-with-alpha only. libx265 on this toolchain accepts yuva420p and
 * writes an opaque yuv420p file, which iPhone Safari paints as a green rectangle.
 * Leave this empty until a file with an alpha plane actually exists.
 */
export const HEVC_PULSE_SRC = '';

export const PULSE_ASPECT = 720 / 512;
/** Clear hole in the art is the center 1/2.6 of the frame, the card itself. */
export const PLATE_SCALE = 2.6;

export interface PulseSource { src: string; type: string }

/** iPhone, iPad, and desktop Safari. CriOS/FxiOS still match the device token and stay on this path. */
export function isAppleWebKit(ua: string): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /AppleWebKit\//.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/i.test(ua);
}

/**
 * Safari: HEVC (`hvc1`) first, then WebM, and only when the HEVC file exists.
 * With no HEVC file, Safari gets no video element source — an opaque WebM is the green rectangle.
 * Other browsers get VP9 WebM.
 */
export function pulseSources(apple: boolean, hevcSrc = HEVC_PULSE_SRC): PulseSource[] {
  const webm: PulseSource = { src: WEBM_PULSE_SRC, type: 'video/webm; codecs="vp9"' };
  if (!apple) return [webm];
  if (!hevcSrc) return [];
  return [
    { src: hevcSrc, type: 'video/mp4; codecs="hvc1"' },
    webm,
  ];
}

/**
 * null: the frame has not decoded (keep the code pulse, show nothing).
 * false: the corner is opaque, so this frame would be a solid rectangle.
 * true: the corner is clear and the haze around the card is present.
 */
export function frameHasAlpha(cornerAlpha: number, hazeAlpha: number): boolean | null {
  if (cornerAlpha <= 8 && hazeAlpha <= 8) return null;
  if (cornerAlpha > 16) return false;
  return hazeAlpha > 16;
}

/** Sample point in a 64×90 probe of the 512×720 frame, just above the card hole. */
export const HAZE_PROBE = { x: 32, y: 24 } as const;

export interface PlateBox { x: number; y: number; cardW: number }

/** Center the plate on the card. Coordinates are already in the overlay's space. */
export function plateFrame(box: PlateBox): { left: number; top: number; width: number; height: number } | null {
  if (!(box.cardW > 8)) return null;
  const width = box.cardW * PLATE_SCALE;
  const height = width * PULSE_ASPECT;
  return {
    left: box.x - width / 2,
    top: box.y - height / 2,
    width,
    height,
  };
}

/** Canvas-local card center → pixels inside the hype layer. */
export function canvasToLayer(
  x: number,
  y: number,
  canvas: { left: number; top: number },
  layer: { left: number; top: number },
): { x: number; y: number } {
  return { x: canvas.left - layer.left + x, y: canvas.top - layer.top + y };
}
