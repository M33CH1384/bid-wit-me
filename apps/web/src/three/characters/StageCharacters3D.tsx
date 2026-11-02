/**
 * The story stage's 3D figures (lazy chunk; ScriptPlayer mounts it beside the 2D stage portraits, which stay as the
 * immediate picture and the permanent fallback). The stage pair stand in their own `.story-stage-one.left/.right`
 * boxes and Dee stands centre-front; every figure is fitted from the live DOM layout of the stage (portrait or
 * landscape), never a fixed overlay. A figure's 2D portrait hides only once ITS 3D figure has rendered.
 */
import { useEffect, useRef } from 'react';
import { STORY_STOPS } from '@spades/bots';
import {
  CHARACTER_LOAD_TIMEOUT_MS, STAGE_TRIANGLE_BUDGET, fetchCharacterIndex, shouldPrefetch, stage3DCast, want3DCharacters,
} from './manifest';
import { expressionForBeat } from './expressions';
import type { CharacterHandle } from './loader';

export interface Stage3DStats { figures: string[]; triangles: number; calls: number; failed: string[]; reason?: string }
const publish = (s: Stage3DStats) => { (window as unknown as { __bwmStage3D?: Stage3DStats }).__bwmStage3D = s; };

function webglOk(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export default function StageCharacters3D({ stagePair, beat }: { stagePair: string[]; beat: { speaker: string; line: string } | null }) {
  const host = useRef<HTMLDivElement>(null);
  const beatRef = useRef(beat);
  beatRef.current = beat;
  const exprTick = useRef<() => void>(() => {});
  useEffect(() => { exprTick.current(); }, [beat]);
  const key = stagePair.join('|');
  const stopId = STORY_STOPS.find((s) => s.pair[0] === stagePair[0] && s.pair[1] === stagePair[1])?.id ?? null;

  useEffect(() => {
    const el = host.current, stage = el?.parentElement;
    const cast = stage3DCast(stagePair);
    if (!el || !stage || !cast) return;
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
        const key = new T.DirectionalLight(0xffffff, 2.2); key.position.set(0.6, 1.4, 2.2); scene.add(key);
        const cam = new T.PerspectiveCamera(28, 1, 0.1, 50); cam.position.set(0, 0, 10);
        const clock = new T.Clock();
        const placed: { h: CharacterHandle; slot: 'left' | 'right' | 'dee'; base: number }[] = [];
        const failed: string[] = [];
        let lost = false;
        canvas.addEventListener('webglcontextlost', () => { lost = true; teardown(); });

        const slotRect = (slot: 'left' | 'right' | 'dee', sr: DOMRect) => {
          const one = stage.querySelector<HTMLElement>(`.story-stage-one.${slot === 'dee' ? 'left' : slot}`);
          const r = one?.getBoundingClientRect();
          if (slot !== 'dee') return r ? { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height } : null;
          // Dee: centre-front between the pair, a touch smaller (she guides, she is not seated)
          const w = (r?.width ?? sr.width * 0.3) * 0.86, h = (r?.height ?? sr.height * 0.5) * 0.86;
          return { x: (sr.width - w) / 2, y: sr.height - h, w, h };
        };
        const layout = () => {
          const sr = stage.getBoundingClientRect();
          if (sr.width < 8 || sr.height < 8) return;
          renderer.setSize(sr.width, sr.height, false);
          canvas.style.width = `${sr.width}px`; canvas.style.height = `${sr.height}px`;
          cam.aspect = sr.width / sr.height; cam.updateProjectionMatrix();
          const worldH = 2 * cam.position.z * Math.tan((cam.fov * Math.PI) / 360), wpp = worldH / sr.height;
          for (const p of placed) {
            const r = slotRect(p.slot, sr);
            if (!r) continue;
            const s = (r.h * wpp) / p.base; // figure height = its slot's height
            p.h.root.scale.setScalar(s);
            p.h.root.position.set((r.x + r.w / 2 - sr.width / 2) * wpp, (sr.height / 2 - (r.y + r.h)) * wpp, p.slot === 'dee' ? 0.5 : 0);
          }
        };
        const ro = new ResizeObserver(layout); ro.observe(stage);

        const want: [string, 'left' | 'right' | 'dee'][] = [[cast.left, 'left'], [cast.right, 'right'], [cast.dee, 'dee']];
        await Promise.all(want.map(async ([id, slot]) => {
          try {
            const h = await L.acquireCharacter(id, index, { timeoutMs: CHARACTER_LOAD_TIMEOUT_MS });
            if (!alive) { h.release(); return; }
            handles.push(h);
            const box = new T.Box3().setFromObject(h.root), size = box.getSize(new T.Vector3());
            h.root.position.y -= box.min.y; // feet on y=0 before scaling
            const g = new T.Group(); g.add(h.root);
            const wrap = { ...h, root: g } as CharacterHandle;
            if (slot === 'right') g.rotation.y = -0.35; else if (slot === 'left') g.rotation.y = 0.35;
            scene.add(g);
            const idle = h.clips.idle; if (idle) h.mixer.clipAction(idle).play();
            placed.push({ h: wrap, slot, base: Math.max(0.01, size.y) });
          } catch { failed.push(id); }
        }));
        if (!alive) return;
        layout();
        const tris = handles.reduce((a, h) => a + h.triangles, 0);
        exprTick.current = () => { const b = beatRef.current; for (const h of handles) h.setExpression(expressionForBeat(h.id, b)); };
        exprTick.current();
        let first = true;
        const loop = () => {
          if (!alive || lost) return;
          raf = requestAnimationFrame(loop);
          if (document.hidden) return;
          const dt = Math.min(clock.getDelta(), 0.1);
          for (const h of handles) h.mixer.update(dt);
          renderer.render(scene, cam);
          if (first) {
            first = false;
            for (const p of placed) if (p.slot !== 'dee') stage.querySelector(`.story-stage-one.${p.slot}`)?.setAttribute('data-3d', 'on');
            stage.setAttribute('data-3d', 'on');
            publish({ figures: handles.map((h) => h.id), triangles: tris, calls: renderer.info.render.calls, failed, ...(tris > STAGE_TRIANGLE_BUDGET ? { reason: 'over-triangle-budget' } : {}) });
          }
        };
        if (handles.length) loop(); else publish({ figures: [], triangles: 0, calls: 0, failed, reason: 'load-failed' });
        // next stop's pair: warm the HTTP cache only on a fast, non-saver connection
        const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
        if (stopId && shouldPrefetch(conn)) {
          const ix = STORY_STOPS.findIndex((s) => s.id === stopId), next = ix >= 0 ? STORY_STOPS[ix + 1] : undefined;
          next?.pair.forEach((id) => L.prefetchCharacter(id, index));
        }
        function teardown() {
          ro.disconnect(); cancelAnimationFrame(raf);
          stage!.removeAttribute('data-3d');
          stage!.querySelectorAll('.story-stage-one[data-3d]').forEach((n) => n.removeAttribute('data-3d'));
          handles.splice(0).forEach((h) => h.release());
          renderer.dispose(); canvas.remove();
        }
        dispose = teardown;
      } catch {
        publish({ figures: [], triangles: 0, calls: 0, failed: [...stagePair, 'dee'], reason: 'load-failed' });
      }
    })();
    return () => { alive = false; cancelAnimationFrame(raf); dispose(); handles.splice(0).forEach((h) => h.release()); exprTick.current = () => {}; };
  }, [key, stopId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="story-stage-3d-host" aria-hidden />;
}
