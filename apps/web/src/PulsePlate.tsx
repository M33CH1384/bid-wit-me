import { useEffect, useRef } from 'react';
import { HAPTIC, haptic } from './haptics';
import { sound } from './audio';
import { getBurst } from './jokerFx';
import {
  HAZE_PROBE, canvasToLayer, frameHasAlpha, isAppleWebKit, plateFrame, pulseSources,
  type PlateBox,
} from './pulsePlate';

/**
 * Cinematic radioactive loop around the Big Joker.
 * Chromium plays the VP9 WebM after a corner-pixel alpha check.
 * Safari would need HEVC-with-alpha; this environment cannot encode that, so Safari
 * plays the PNG sheet (or the code pulse if the sheet is opaque). An unconfirmed
 * video is never shown — that is the flat green rectangle on iPhone.
 */

const RATES = [1, 1.4, 1.9] as const;
const OPACITY = [0.75, 0.88, 1] as const;
/** Two swells in the 1.2s loop. Haptics fire when playback crosses them. */
const SWELLS = [0.18, 0.72];

let live = false;
export function pulseVideoLive(): boolean { return live; }

interface Box extends PlateBox { cardsAfter: number; flicker: boolean; kind: string; at: number }

type Mode = 'pending' | 'video' | 'sheet' | 'code';

function readAlpha(ctx: CanvasRenderingContext2D): boolean | null {
  const corner = ctx.getImageData(0, 0, 1, 1).data[3] ?? 0;
  const haze = ctx.getImageData(HAZE_PROBE.x, HAZE_PROBE.y, 1, 1).data[3] ?? 0;
  return frameHasAlpha(corner, haze);
}

export default function PulsePlate({ reduced }: { reduced: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<Mode>('pending');
  const prevRef = useRef(0);
  const sheetOk = useRef(false);

  useEffect(() => {
    if (reduced) { live = false; return; }
    const video = videoRef.current;
    const sheet = sheetRef.current;
    const host = hostRef.current;
    if (!video || !sheet || !host) return;
    let dead = false;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.loop = true;
    video.querySelectorAll('source').forEach((s) => s.remove());
    video.removeAttribute('src');

    const dropVideo = () => {
      video.pause();
      video.removeAttribute('src');
      video.querySelectorAll('source').forEach((s) => s.remove());
      try { video.load(); } catch { /* already empty */ }
      modeRef.current = sheetOk.current ? 'sheet' : 'code';
      if (modeRef.current !== 'sheet') live = false;
    };

    const probeVideo = (): boolean | null => {
      if (video.readyState < 2 || !video.videoWidth) return null;
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 90;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.clearRect(0, 0, 64, 90);
      try { ctx.drawImage(video, 0, 0, 64, 90); } catch { return false; }
      return readAlpha(ctx);
    };

    const onError = () => { if (!dead) dropVideo(); };
    const sources = pulseSources(isAppleWebKit(navigator.userAgent));
    modeRef.current = sources.length === 0 ? 'sheet' : 'pending';
    if (sources.length > 0) {
      for (const s of sources) {
        const el = document.createElement('source');
        el.src = s.src;
        el.type = s.type;
        video.appendChild(el);
      }
      video.load();
      const play = video.play();
      if (play && typeof play.catch === 'function') play.catch(() => { if (!dead) dropVideo(); });
      video.addEventListener('error', onError);
    }

    const img = new Image();
    img.onload = () => {
      if (dead) return;
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 90;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!ctx || !img.naturalWidth) { sheetOk.current = false; return; }
      const fw = img.naturalWidth / 6;
      const fh = img.naturalHeight / 6;
      ctx.clearRect(0, 0, 64, 90);
      ctx.drawImage(img, 0, 0, fw, fh, 0, 0, 64, 90);
      sheetOk.current = readAlpha(ctx) === true;
      if (!sheetOk.current && modeRef.current !== 'video') {
        modeRef.current = 'code';
        live = false;
      }
    };
    img.src = '/fx/joker-pulse-sheet.png';

    let raf = 0;
    const tick = () => {
      if (dead) return;
      if (modeRef.current === 'pending') {
        const has = probeVideo();
        if (has === true) { modeRef.current = 'video'; live = true; }
        else if (has === false) dropVideo();
      }
      const box = (window as unknown as { __bwmJokerBox?: Box }).__bwmJokerBox;
      const fresh = !!box && box.kind === 'BJ' && performance.now() - box.at < 200;
      const bursting = getBurst() != null;
      const mode = modeRef.current;
      const show = fresh && !reduced && !bursting && (mode === 'video' || (mode === 'sheet' && sheetOk.current));
      if (mode === 'video' || (mode === 'sheet' && sheetOk.current)) live = true;
      else if (mode === 'code') live = false;
      const rate = RATES[Math.min(2, box?.cardsAfter ?? 0)]!;
      const op = OPACITY[Math.min(2, box?.cardsAfter ?? 0)]!;
      const flick = fresh && box?.flicker ? 0.45 + 0.55 * (Math.sin(performance.now() / 40) > 0 ? 1 : 0) : 1;

      host.style.display = 'none';
      video.style.display = 'none';
      sheet.style.display = 'none';
      if (show && box) {
        // className lands on the R3F wrapper, not the <canvas>.
        const canvas = document.querySelector('.table-canvas canvas') ?? document.querySelector('canvas.table-canvas');
        const layer = host.closest('.hype-layer');
        let placed = box;
        if (canvas && layer) {
          const c = canvas.getBoundingClientRect();
          const l = layer.getBoundingClientRect();
          const p = canvasToLayer(box.x, box.y, c, l);
          placed = { ...box, x: p.x, y: p.y };
        }
        const frame = plateFrame(placed);
        if (frame) {
          host.style.display = 'block';
          host.style.left = `${frame.left}px`;
          host.style.top = `${frame.top}px`;
          host.style.width = `${frame.width}px`;
          host.style.height = `${frame.height}px`;
          host.style.opacity = String(op * flick);
          if (mode === 'video') {
            video.style.display = 'block';
            video.playbackRate = rate;
            const t = video.currentTime % 1.2;
            const prev = prevRef.current;
            for (const markAt of SWELLS) {
              const crossed = (prev < markAt && t >= markAt) || (prev > t && (prev < markAt || t >= markAt));
              if (crossed) { haptic(HAPTIC.beat, 'beat'); sound.geigerTick(); }
            }
            prevRef.current = t;
          } else if (mode === 'sheet' && img.complete && img.naturalWidth > 0) {
            sheet.style.display = 'block';
            const ctx = sheet.getContext('2d');
            if (ctx) {
              const cols = 6;
              const rows = 6;
              const fw = img.naturalWidth / cols;
              const fh = img.naturalHeight / rows;
              const frames = cols * rows;
              const frameNo = Math.floor(((performance.now() / 1000) * rate * 30) % Math.max(1, frames));
              const col = frameNo % cols;
              const row = Math.floor(frameNo / cols);
              const bw = Math.max(1, Math.floor(frame.width));
              const bh = Math.max(1, Math.floor(frame.height));
              if (sheet.width !== bw || sheet.height !== bh) {
                sheet.width = bw;
                sheet.height = bh;
              }
              ctx.clearRect(0, 0, sheet.width, sheet.height);
              ctx.drawImage(img, col * fw, row * fh, fw, fh, 0, 0, sheet.width, sheet.height);
              const loopT = (frameNo / 30) % 1.2;
              const prev = prevRef.current;
              for (const markAt of SWELLS) {
                if (prev < markAt && loopT >= markAt) { haptic(HAPTIC.beat, 'beat'); sound.geigerTick(); }
              }
              prevRef.current = loopT;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      dead = true;
      live = false;
      cancelAnimationFrame(raf);
      video.pause();
      video.removeEventListener('error', onError);
    };
  }, [reduced]);

  if (reduced) return null;
  return (
    <div ref={hostRef} className="joker-pulse-host" data-testid="joker-pulse-host" style={{ display: 'none' }}>
      <video ref={videoRef} className="joker-pulse-plate" muted loop playsInline autoPlay preload="auto" data-testid="joker-pulse-plate" />
      <canvas ref={sheetRef} className="joker-pulse-plate" data-testid="joker-pulse-sheet" />
    </div>
  );
}
