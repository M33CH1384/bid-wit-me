/**
 * The story stage's 3D figures (lazy chunk; ScriptPlayer mounts it inside the living stage, beside the 2D stage
 * portraits, which stay as the immediate picture and the permanent fallback). Seat 1 stands stage left, Dee (seat 2)
 * centre, seat 3 stage right — all at the same height, chest-up with headroom, framed in the band between the cast
 * row and the dialogue card (framing.ts), measured from the live DOM in every orientation. Once the figures have
 * rendered the scene carries data-stage3d="on", which opens that band in the layout (story.css).
 */
import { useEffect, useRef } from 'react';
import { STORY_STOPS } from '@spades/bots';
import {
  CHARACTER_LOAD_TIMEOUT_MS, STAGE_TRIANGLE_BUDGET, fetchCharacterIndex, shouldPrefetch, stage3DCast, want3DCharacters,
} from './manifest';
import { expressionForBeat, morphWeights, stepWeights } from './expressions';
import { bandForWidth, bandFromRects, frameStage, type StageSlot } from './framing';
import type { CharacterHandle } from './loader';

export interface Stage3DStats { figures: string[]; triangles: number; calls: number; failed: string[]; reason?: string; frames?: unknown }
const publish = (s: Stage3DStats) => { (window as unknown as { __bwmStage3D?: Stage3DStats }).__bwmStage3D = s; };

/** The current speaker steps forward this much (scale) and is lit a touch warmer; listeners ease back. */
const SPEAKER_SCALE = 1.04;
const SPEAKER_GLOW = 0.05;

function webglOk(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export default function StageCharacters3D({ stagePair, beat }: { stagePair: string[]; beat: { speaker: string; line: string } | null }) {
  const host = useRef<HTMLDivElement>(null);
  const beatRef = useRef(beat);
  beatRef.current = beat;
  const key = stagePair.join('|');
  const stopId = STORY_STOPS.find((s) => s.pair[0] === stagePair[0] && s.pair[1] === stagePair[1])?.id ?? null;

  useEffect(() => {
    const el = host.current, stage = el?.parentElement, scene3 = stage?.parentElement;
    const cast = stage3DCast(stagePair);
    if (!el || !stage || !scene3 || !cast) return;
    const gate = want3DCharacters({
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      webgl: webglOk(),
    });
    if (!gate.ok) { publish({ figures: [], triangles: 0, calls: 0, failed: [], reason: gate.reason }); return; }
    let alive = true, raf = 0;
    const handles: CharacterHandle[] = [];
    let dispose = () => {};
    void (async () => {
      try {
        const [T, L, index] = await Promise.all([import('three'), import('./loader'), fetchCharacterIndex()]);
        if (!alive) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'story-stage-3d';
        canvas.dataset.testid = 'story-stage-3d';
        el.appendChild(canvas);
        let renderer: import('three').WebGLRenderer;
        try { renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'low-power' }); }
        catch { canvas.remove(); publish({ figures: [], triangles: 0, calls: 0, failed: [], reason: 'no-webgl' }); return; }
        renderer.outputColorSpace = T.SRGBColorSpace;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const scene = new T.Scene();
        scene.add(new T.HemisphereLight(0xfff4e6, 0x2a2030, 1.6));
        const keyL = new T.DirectionalLight(0xffffff, 2.2); keyL.position.set(0.6, 1.4, 2.2); scene.add(keyL);
        // Orthographic: equal head size across the three seats, and DOM px map 1:1 to world units (framing.ts math).
        const cam = new T.OrthographicCamera(0, 1, 0, -1, -50, 50); cam.position.set(0, 0, 10);
        const clock = new T.Clock();
        interface Placed { h: CharacterHandle; g: import('three').Group; slot: StageSlot; base: number; glow: import('three').MeshStandardMaterial[]; w: number[]; s: number }
        const placed: Placed[] = [];
        const failed: string[] = [];
        let lost = false;
        let frames: ReturnType<typeof frameStage> = [];
        canvas.addEventListener('webglcontextlost', () => { lost = true; teardown(); });

        /** Head top pinned to the band's headroom line; a speaking figure grows downward/forward from there. */
        const place = (p: Placed) => {
          const f = frames.find((x) => x.slot === p.slot);
          if (!f) return;
          const h = f.height * p.s;
          p.g.scale.setScalar(h / p.base);
          p.g.position.set(f.cx, -(f.headTop + h), (p.slot === 'dee' ? 1 : 0) + (p.s - 1) * 50);
        };
        const layout = () => {
          const sr = stage.getBoundingClientRect();
          if (sr.width < 8 || sr.height < 8) return;
          scene3.style.setProperty('--s3d-band', `${bandForWidth(sr.width)}px`);
          renderer.setSize(sr.width, sr.height, false);
          canvas.style.width = `${sr.width}px`; canvas.style.height = `${sr.height}px`;
          // y grows downward in DOM px; the camera maps stage px straight onto world units (y negated)
          cam.left = 0; cam.right = sr.width; cam.top = 0; cam.bottom = -sr.height; cam.updateProjectionMatrix();
          const castEl = scene3.querySelector<HTMLElement>('.story-cast');
          const cardEl = scene3.querySelector<HTMLElement>('.story-script-card');
          const band = bandFromRects(sr, castEl ? castEl.getBoundingClientRect().bottom : null, cardEl ? cardEl.getBoundingClientRect().top : null);
          frames = frameStage(band);
          // nothing draws below the card's top edge (+ a little under its rounded border): no legs ghosting through the glass
          const clip = Math.min(sr.height, band.bottom + 24);
          renderer.setScissorTest(true);
          renderer.setScissor(0, sr.height - clip, sr.width, clip);
          for (const p of placed) place(p);
        };
        const ro = new ResizeObserver(layout); ro.observe(stage);
        const card = scene3.querySelector('.story-script-card'); if (card) ro.observe(card);

        const want: [string, StageSlot][] = [[cast.left, 'left'], [cast.dee, 'dee'], [cast.right, 'right']];
        await Promise.all(want.map(async ([id, slot]) => {
          try {
            const h = await L.acquireCharacter(id, index, { timeoutMs: CHARACTER_LOAD_TIMEOUT_MS });
            if (!alive) { h.release(); return; }
            handles.push(h);
            const box = new T.Box3().setFromObject(h.root), size = box.getSize(new T.Vector3());
            h.root.position.y -= box.min.y; // feet on y=0, head top at y=size.y
            const g = new T.Group(); g.add(h.root);
            g.rotation.y = slot === 'right' ? -0.3 : slot === 'left' ? 0.3 : 0;
            scene.add(g);
            const idle = h.clips.idle; if (idle) h.mixer.clipAction(idle).play();
            const glow: import('three').MeshStandardMaterial[] = [];
            h.root.traverse((o) => {
              const m = (o as import('three').Mesh).material as import('three').MeshStandardMaterial | undefined;
              if (m && 'emissive' in m && !glow.includes(m)) glow.push(m);
            });
            placed.push({ h, g, slot, base: Math.max(0.01, size.y), glow, w: morphWeights('neutral'), s: 1 });
          } catch { failed.push(id); }
        }));
        if (!alive) return;
        // emissive boost is per material; the cached source shares materials across clones, so clone them per seat
        for (const p of placed) {
          const map = new Map<import('three').Material, import('three').Material>();
          p.h.root.traverse((o) => {
            const m = o as import('three').Mesh;
            if (!m.isMesh || Array.isArray(m.material)) return;
            if (!map.has(m.material)) map.set(m.material, m.material.clone());
            m.material = map.get(m.material)!;
          });
          p.glow = [...map.values()].filter((m) => 'emissive' in m) as import('three').MeshStandardMaterial[];
        }
        layout();
        const tris = handles.reduce((a, h) => a + h.triangles, 0);
        let first = true;
        const loop = () => {
          if (!alive || lost) return;
          raf = requestAnimationFrame(loop);
          if (document.hidden) return;
          const dt = Math.min(clock.getDelta(), 0.1);
          const b = beatRef.current, ease = 1 - Math.exp(-dt * 8);
          for (const p of placed) {
            p.h.mixer.update(dt);
            const speaking = !!b && b.speaker === p.h.id;
            p.w = stepWeights(p.w, morphWeights(expressionForBeat(p.h.id, b)), ease);
            p.h.setWeights(p.w);
            const ts = speaking ? SPEAKER_SCALE : 1;
            const ns = p.s + (ts - p.s) * ease;
            if (Math.abs(ns - p.s) > 1e-4) { p.s = ns; place(p); }
            const gl = (p.s - 1) / (SPEAKER_SCALE - 1) * SPEAKER_GLOW;
            for (const m of p.glow) m.emissive.setRGB(gl, gl * 0.85, gl * 0.6);
          }
          renderer.render(scene, cam);
          if (first) {
            first = false;
            stage.querySelectorAll('.story-stage-one').forEach((n) => n.setAttribute('data-3d', 'on'));
            stage.setAttribute('data-3d', 'on');
            scene3.setAttribute('data-stage3d', 'on');
            publish({ figures: handles.map((h) => h.id), triangles: tris, calls: renderer.info.render.calls, failed, frames, ...(tris > STAGE_TRIANGLE_BUDGET ? { reason: 'over-triangle-budget' } : {}) });
          }
        };
        if (handles.length) loop(); else publish({ figures: [], triangles: 0, calls: 0, failed, reason: 'load-failed' });
        const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
        if (stopId && shouldPrefetch(conn)) {
          const ix = STORY_STOPS.findIndex((s) => s.id === stopId), next = ix >= 0 ? STORY_STOPS[ix + 1] : undefined;
          next?.pair.forEach((id) => L.prefetchCharacter(id, index));
        }
        function teardown() {
          ro.disconnect(); cancelAnimationFrame(raf);
          stage!.removeAttribute('data-3d');
          scene3!.removeAttribute('data-stage3d');
          scene3!.style.removeProperty('--s3d-band');
          stage!.querySelectorAll('.story-stage-one[data-3d]').forEach((n) => n.removeAttribute('data-3d'));
          for (const p of placed) for (const m of p.glow) m.dispose();
          handles.splice(0).forEach((h) => h.release());
          renderer.dispose(); canvas.remove();
        }
        dispose = teardown;
      } catch {
        publish({ figures: [], triangles: 0, calls: 0, failed: [...stagePair, 'dee'], reason: 'load-failed' });
      }
    })();
    return () => { alive = false; cancelAnimationFrame(raf); dispose(); handles.splice(0).forEach((h) => h.release()); };
  }, [key, stopId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="story-stage-3d-host" aria-hidden />;
}
