import { useEffect, useRef } from 'react';
import { HAPTIC, haptic } from './haptics';
import { sound } from './audio';

/**
 * Cinematic radioactive loop behind the Big Joker.
 * The plate is procedural (see scripts/render-joker-pulse.mjs) and dedicated to the public domain.
 * VP9 WebM with alpha for Chromium. libx265 cannot write HEVC-with-alpha, so Safari uses the PNG sheet.
 * The code pulse in JokerAura stays up until this reports ready, and stays up if the asset fails.
 */

const RATES = [1, 1.4, 1.9] as const;
const OPACITY = [0.75, 0.88, 1] as const;
/** Two swells in the 1.2s loop. Haptics fire when playback crosses them. */
const SWELLS = [0.18, 0.72];

let live = false;
export function pulseVideoLive(): boolean { return live; }

interface Box { x: number; y: number; cardW: number; cardsAfter: number; flicker: boolean; kind: string; at: number }

export default function PulsePlate({ reduced }: { reduced: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<'video' | 'sheet' | 'off'>('off');
  const prevRef = useRef(0);

  useEffect(() => {
    if (reduced) { live = false; return; }
    const video = videoRef.current;
    const sheet = sheetRef.current;
    if (!video || !sheet) return;
    let dead = false;
    const mark = (on: boolean) => { if (!dead) { live = on; modeRef.current = on ? 'video' : modeRef.current; } };
    const webm = video.canPlayType('video/webm; codecs="vp9"') !== '';
    video.addEventListener('loadeddata', () => mark(true));
    video.addEventListener('error', () => { mark(false); modeRef.current = 'sheet'; });
    if (webm) video.src = '/fx/joker-pulse.webm';
    else modeRef.current = 'sheet';
    if (video.src) video.play().catch(() => { mark(false); modeRef.current = 'sheet'; });

    const img = new Image();
    img.src = '/fx/joker-pulse-sheet.png';
    let raf = 0;
    const tick = () => {
      if (dead) return;
      const box = (window as unknown as { __bwmJokerBox?: Box }).__bwmJokerBox;
      const fresh = !!box && box.kind === 'BJ' && performance.now() - box.at < 200;
      const rate = RATES[Math.min(2, box?.cardsAfter ?? 0)]!;
      const op = OPACITY[Math.min(2, box?.cardsAfter ?? 0)]!;
      const flick = fresh && box?.flicker ? 0.45 + 0.55 * (Math.sin(performance.now() / 40) > 0 ? 1 : 0) : 1;
      const show = fresh && !reduced;
      if (video && modeRef.current === 'video') {
        video.playbackRate = rate;
        const w = Math.max(80, (box?.cardW ?? 80) * 2.6);
        const h = w * (720 / 512);
        video.style.display = show ? 'block' : 'none';
        video.style.width = `${w}px`;
        video.style.height = `${h}px`;
        video.style.left = `${(box?.x ?? 0) - w / 2}px`;
        video.style.top = `${(box?.y ?? 0) - h / 2}px`;
        video.style.opacity = String(show ? op * flick : 0);
        const t = video.currentTime % 1.2;
        const prev = prevRef.current;
        for (const markAt of SWELLS) {
          const crossed = prev < markAt && t >= markAt || (prev > t && (prev < markAt || t >= markAt));
          if (crossed && show) { haptic(HAPTIC.beat, 'beat'); sound.geigerTick(); }
        }
        prevRef.current = t;
      }
      if (sheet && modeRef.current === 'sheet' && img.complete && img.naturalWidth > 0) {
        live = true;
        const ctx = sheet.getContext('2d');
        const w = Math.max(80, (box?.cardW ?? 80) * 2.6);
        const h = w * (720 / 512);
        sheet.style.display = show ? 'block' : 'none';
        sheet.style.width = `${w}px`;
        sheet.style.height = `${h}px`;
        sheet.style.left = `${(box?.x ?? 0) - w / 2}px`;
        sheet.style.top = `${(box?.y ?? 0) - h / 2}px`;
        sheet.style.opacity = String(show ? op * flick : 0);
        if (ctx && show) {
          const cols = 6;
          const rows = 6;
          const fw = img.naturalWidth / cols;
          const fh = img.naturalHeight / rows;
          const frames = cols * rows;
          const frame = Math.floor(((performance.now() / 1000) * rate * 30) % Math.max(1, frames));
          const col = frame % cols;
          const row = Math.floor(frame / cols);
          if (sheet.width !== Math.floor(w) || sheet.height !== Math.floor(h)) {
            sheet.width = Math.floor(w);
            sheet.height = Math.floor(h);
          }
          ctx.clearRect(0, 0, sheet.width, sheet.height);
          ctx.drawImage(img, col * fw, row * fh, fw, fh, 0, 0, sheet.width, sheet.height);
          const loopT = (frame / 30) % 1.2;
          const prev = prevRef.current;
          for (const markAt of SWELLS) {
            if (prev < markAt && loopT >= markAt && show) { haptic(HAPTIC.beat, 'beat'); sound.geigerTick(); }
          }
          prevRef.current = loopT;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { dead = true; live = false; cancelAnimationFrame(raf); };
  }, [reduced]);

  if (reduced) return null;
  return (
    <>
      <video ref={videoRef} className="joker-pulse-plate" muted loop playsInline autoPlay data-testid="joker-pulse-plate" />
      <canvas ref={sheetRef} className="joker-pulse-plate" data-testid="joker-pulse-sheet" />
    </>
  );
}
