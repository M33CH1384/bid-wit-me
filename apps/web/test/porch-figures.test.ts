/**
 * The Porch pilot pins (character phase, step 2; owner go 2026-10-28).
 *
 * The pilot seats the rigged 3D cast at the solo Porch story table,
 * High quality only. These tests pin: the gate composition at the
 * seam (the figures' GLBs are assets the table presents, so the
 * loader's promise covers them — and ONLY there), the seam wiring
 * through Table -> Scene -> PorchFigures, the failure-fallback
 * discipline (declarative loads, error boundary, probe), the chair
 * reconciliation (the solve's seat top is the PRODUCTION Porch
 * room's, not the sandbox studio's), and the people-framing camera
 * values that ride along as the ratification candidate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PORCH_FIGURE_GLBS, roomGlbUrls } from '../src/assetGate';

const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

describe('the asset gate at the Porch seam', () => {
  it('gates exactly the three figure GLBs at grandma/high/porch', () => {
    expect(roomGlbUrls('grandma', 'high', 'porch')).toEqual([
      { label: expect.any(String), url: '/assets/figures/dee.glb' },
      { label: expect.any(String), url: '/assets/figures/uncleRay.glb' },
      { label: expect.any(String), url: '/assets/figures/pat.glb' },
    ]);
  });

  it('gates nothing for the figures anywhere else', () => {
    expect(roomGlbUrls('grandma', 'high', null)).toEqual([]); // non-story grandma
    expect(roomGlbUrls('grandma', 'high', 'barbershop')).toEqual([]);
    expect(roomGlbUrls('grandma', 'low', 'porch')).toEqual([]); // Low never mounts them
    expect(roomGlbUrls('classic', 'high', 'porch')).toEqual([]);
    expect(roomGlbUrls('blockAfterDark', 'high', 'porch').map((g) => g.url)).toEqual(['/assets/venues/blockAfterDark/sedan.glb']);
  });

  it('the figure list is Dee, Uncle Ray, Pat — the Porch trio', () => {
    expect(PORCH_FIGURE_GLBS.map((f) => f.id)).toEqual(['dee', 'uncleRay', 'pat']);
    expect(new Set(PORCH_FIGURE_GLBS.map((f) => f.label)).size).toBe(3);
  });

  it('the gated files exist in the production tree, full-size', () => {
    for (const f of PORCH_FIGURE_GLBS) {
      const st = statSync(join(process.cwd(), 'apps/web', 'public', f.url));
      // the rigged GLBs are megabytes of skinned geometry, not stubs
      expect(st.size).toBeGreaterThan(1_000_000);
    }
  });
});

describe('the pilot seam wiring', () => {
  it('Table computes the seats solo-Porch-only, player seat empty', () => {
    const table = src('src/Table.tsx');
    expect(table).toContain("story?.scene?.stop.id === 'porch' && storySeatIds");
    expect(table).toContain('seat === 0 ? null : (storySeatIds[seat] ?? null)');
    expect(table).toContain('porchFigureSeats={porchFigureSeats}');
  });

  it('Scene activates the pilot on the seam + High + the prop, and only there', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain("const porchFiguresActive = grandma && props.storyStopId === 'porch' && hi && !!(props.porchFigureSeats?.some(Boolean))");
    expect(scene).toContain('{showTable && textured && porchFiguresActive && (');
    expect(scene).toContain('<PorchFigures');
    // the King system is untouched by the pilot
    expect(scene).toContain('seated={props.seatedFigures ?? []}');
  });

  it('three.js stays out of the entry graph: neither Table nor assetGate imports the figures module', () => {
    expect(src('src/Table.tsx')).not.toMatch(/from '\.\/three\/PorchFigures'/);
    expect(src('src/assetGate.ts')).not.toMatch(/from '.*PorchFigures'/);
  });
});

describe('the figures module', () => {
  const fig = src('src/three/PorchFigures.tsx');

  it('loads declaratively off the gate list — one URL source, no drift', () => {
    expect(fig).toContain("import { PORCH_FIGURE_GLBS } from '../assetGate'");
    expect(fig).toContain('useLoader(GLTFLoader, url)');
    expect(fig).toContain('<Suspense fallback={null}>');
    expect(fig).not.toContain('new GLTFLoader');
  });

  it('a failed figure names itself on the probe and renders nothing', () => {
    expect(fig).toContain('__bwmPorchFigures');
    expect(fig).toContain('getDerivedStateFromError');
    expect(fig).toContain('return this.state.failed ? null : this.props.children');
  });

  it('solves against the PRODUCTION Porch chair, not the sandbox studio chair', () => {
    expect(fig).toContain('export const PORCH_SEAT_TOP = -0.41');
    expect(fig).not.toContain('-0.447');
    // the room's own arithmetic: seat top = FLOOR_Y + 0.49 over FLOOR_Y = -0.9
    const room = src('src/three/PorchDeckRoom.tsx');
    expect(room).toContain('const FLOOR_Y = -0.9');
    expect(room).toContain('FLOOR_Y + 0.49');
    expect(-0.9 + 0.49).toBeCloseTo(-0.41, 10);
  });

  it('carries the trio registers: statures and patient Ray', () => {
    expect(fig).toContain("dee: {\n    stature: 1.86");
    expect(fig).toContain("uncleRay: {\n    stature: 1.80");
    expect(fig).toContain("pat: {\n    stature: 1.68");
  });

  it('never fakes a blink (no morph machinery) and never travels a played card (pilot scope)', () => {
    expect(fig).not.toContain('morphTarget');
    expect(fig).not.toContain('playedCardXform');
  });
});

describe('the people-framing camera (ratification candidate)', () => {
  it('Scene carries the sandbox Phase C offsets and applies them sitting-only at the pilot seam', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain('export const PEOPLE_CAM = { raise: 0.37, lookDy: 0.48, lookDz: -0.38 } as const');
    expect(scene).toContain("people && view === 'sitting' ? peopleSpec(stockSpec) : stockSpec");
    expect(scene).toContain('<CameraRig view={props.view} people={porchFiguresActive} />');
  });

  it('the hand refit rides the same matrix family (M = V * S^-1)', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain('camMatrixOf(people.pos, people.look).multiply(camMatrixOf(stock.pos, stock.look).invert())');
    // hit quads keep the STOCK target — the refit preserves screen position
    expect(scene).toContain('poly: cardScreenQuad(aspect, targetStock, screenW, screenH, posePx(pose), !!fanOpts.short, view)');
  });
});
