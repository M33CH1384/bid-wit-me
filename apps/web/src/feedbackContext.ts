import { VERSION, versionLine } from './version';

/** What a feedback report carries automatically (shown to the player before sending). */
let game: Record<string, unknown> | null = null;
/** The table screen keeps this up to date (null when no game is open). */
export function setFeedbackGame(g: Record<string, unknown> | null) { game = g; }

export function feedbackContext(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const code = typeof location !== 'undefined' ? /^\/t\/([A-Za-z0-9]+)/.exec(location.pathname)?.[1] ?? null : null;
  return {
    version: versionLine(), sha: VERSION.sha,
    browser: nav?.userAgent ?? '',
    platform: (nav as Navigator & { userAgentData?: { platform?: string } })?.userAgentData?.platform ?? nav?.platform ?? '',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x` : '',
    touch: typeof window !== 'undefined' && 'ontouchstart' in window,
    online: !!code || (typeof location !== 'undefined' && location.pathname.startsWith('/online')),
    table: code,
    game,
    at: new Date().toISOString(),
  };
}

/** One readable line per field, for the "What's included" disclosure. */
export function describeContext(c: Record<string, unknown>): string[] {
  const g = c.game as Record<string, unknown> | null;
  return [
    `Version: ${c.version}`,
    `Device: ${c.platform || 'unknown'}${c.touch ? ' (touch)' : ''} · ${c.viewport}`,
    `Browser: ${String(c.browser).slice(0, 140)}`,
    c.table ? `Online table: ${c.table}` : c.online ? 'Online lobby' : 'Offline (vs bots)',
    g ? `Game: ${Object.entries(g).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('/') : v}`).join(' · ')}` : 'Game: none open',
  ];
}

/** Downscale an image to ≤ maxSide px and re-encode (WebP if the browser can, else JPEG), staying under maxBytes. */
export async function shrinkImage(src: Blob | string, maxSide = 1600, maxBytes = 1_500_000): Promise<string> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not an image')); i.src = url; });
    let side = maxSide;
    for (let q = 0.8; ; ) {
      const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/webp', q);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', q);
      if (out.length * 0.75 <= maxBytes || side < 400) return out;
      if (q > 0.6) q -= 0.1; else side = Math.round(side * 0.75);
    }
  } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
}

/** "Snap this screen": the 3D table (one fresh frame) + the HTML overlay on top, without the feedback sheet itself. */
export async function snapScreen(): Promise<string | null> {
  const w = window as unknown as { __bwmSnap?: () => string };
  const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  const out = document.createElement('canvas');
  out.width = Math.round(W * dpr); out.height = Math.round(H * dpr);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#0c0712'; ctx.fillRect(0, 0, out.width, out.height);
  const gl = document.querySelector<HTMLCanvasElement>('canvas.table-canvas, .table-canvas canvas');
  const glUrl = w.__bwmSnap?.();
  if (gl && glUrl) {
    const r = gl.getBoundingClientRect();
    const img = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = glUrl; });
    if (img) ctx.drawImage(img, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
  }
  try {
    const { toCanvas } = await import('html-to-image');
    document.documentElement.classList.add('snapping'); // the table screen's solid background would hide the 3D frame
    const root = document.getElementById('root') ?? document.body;
    const overlay = await toCanvas(root, {
      pixelRatio: dpr, width: W, height: H, cacheBust: false, skipFonts: false,
      filter: (n) => !(n instanceof HTMLCanvasElement) && !(n instanceof Element && n.closest?.('[data-feedback-ui]')),
      style: { background: 'transparent' }, backgroundColor: 'transparent',
    });
    ctx.drawImage(overlay, 0, 0, out.width, out.height);
  } catch { /* overlay capture unsupported here: the table frame alone still helps */ } finally { document.documentElement.classList.remove('snapping'); }
  return shrinkImage(out.toDataURL('image/png'));
}
