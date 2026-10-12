/// <reference lib="webworker" />
import { createBlast, drawBlast, noteFrame, resetBlast, stepBlast, type Blast } from './nukeBlast';

let blast: Blast | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as {
    type: string;
    canvas?: OffscreenCanvas;
    tMs?: number;
    cx?: number;
    cy?: number;
    w?: number;
    h?: number;
    dpr?: number;
    reduced?: boolean;
  };
  if (msg.type === 'init' && msg.canvas) {
    ctx = msg.canvas.getContext('2d', { alpha: true });
    blast = createBlast();
    return;
  }
  if (!blast || !ctx) return;
  if (msg.type === 'start') {
    const dpr = msg.dpr ?? 1;
    const w = msg.w ?? 1;
    const h = msg.h ?? 1;
    msg.canvas; // size lives on the transferred canvas
    const canvas = ctx.canvas;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    resetBlast(blast, {
      cx: msg.cx ?? w / 2,
      cy: msg.cy ?? h * 0.46,
      w,
      h,
      dpr,
      reduced: !!msg.reduced,
    });
    return;
  }
  if (msg.type === 'frame') {
    const target = (msg.tMs ?? 0) / 1000;
    const t0 = performance.now();
    let guard = 0;
    while (blast.t < target - 0.001 && guard++ < 8) stepBlast(blast, Math.min(0.033, target - blast.t));
    drawBlast(ctx, blast);
    const ms = performance.now() - t0;
    noteFrame(blast, ms);
    self.postMessage({ type: 'frame', tMs: blast.t * 1000, ms, budget: blast.budget, slowed: blast.slowed });
  }
};
