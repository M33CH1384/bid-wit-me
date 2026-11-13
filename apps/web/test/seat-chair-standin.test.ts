/**
 * Owner, 2026-11-13 (Mansion, iPhone landscape): "my opponents don't have chairs" and "the cam
 * and mic buttons look pretty odd".
 *
 * Chairs: the seated figures do not wait for the chair model, so a late or failed load left them
 * sitting on air. Built chairs now stand in after CHAIR_STAND_IN_MS or on a failed load, and step
 * aside when the model lands.
 * Rail: camera and mic are plain icon-and-label buttons like CHAT in every layout; offline only
 * the icon and label dim, never the whole button.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Box3, type Mesh } from 'three';
import { Group } from 'three';
import { CHAIR_STAND_IN_MS, SIMPLE_CHAIR_SEAT, SIMPLE_CHAIR_TRIS, buildSimpleChair, chairStandIns } from '../src/three/chairStandIn';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('the built chair', () => {
  const chair = buildSimpleChair();
  chair.updateMatrixWorld(true);
  const box = new Box3().setFromObject(chair);
  const meshes: Mesh[] = [];
  chair.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });

  it('stands on the floor and is chair-sized', () => {
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeGreaterThan(SIMPLE_CHAIR_SEAT + 0.4);
    expect(box.max.y).toBeLessThan(1.3);
    expect(box.max.x - box.min.x).toBeLessThan(0.7);
  });

  it('has its seat at the height the figures are posed to, and its back behind the sitter', () => {
    const seat = meshes.find((m) => Math.abs(m.position.y + 0.035 - SIMPLE_CHAIR_SEAT) < 1e-6 && m.position.z === 0);
    expect(seat).toBeTruthy();
    // the model faces +z, so the back is at -z
    expect(box.min.z).toBeLessThan(-0.24);
    expect(meshes.filter((m) => m.position.y > SIMPLE_CHAIR_SEAT && m.position.z < 0).length).toBeGreaterThanOrEqual(2);
  });

  it('is cheap and casts a shadow', () => {
    expect(meshes.length * 12).toBe(SIMPLE_CHAIR_TRIS);
    expect(SIMPLE_CHAIR_TRIS).toBeLessThan(200);
    expect(meshes.every((m) => m.castShadow)).toBe(true);
  });
});

describe('stand-in behaviour', () => {
  const spots = [{ x: -2.3, z: 0, ry: 1 }, { x: 2.3, z: 0, ry: -1 }];
  it('stands chairs at the seats after the wait, on the room floor', async () => {
    vi.useFakeTimers();
    const host = new Group(); let drew = 0;
    const s = chairStandIns(() => host, spots, -0.9, () => { drew++; });
    expect(host.children).toHaveLength(0);
    vi.advanceTimersByTime(CHAIR_STAND_IN_MS + 10);
    expect(host.children).toHaveLength(2);
    expect(host.children[0]!.position.toArray()).toEqual([-2.3, -0.9, 0]);
    expect(drew).toBe(1);
    s.dispose();
    expect(host.children).toHaveLength(0);
    vi.useRealTimers();
  });
  it('a model that lands in time means no stand-ins at all', () => {
    vi.useFakeTimers();
    const host = new Group();
    const s = chairStandIns(() => host, spots, -0.9, () => {});
    s.arrived();
    vi.advanceTimersByTime(CHAIR_STAND_IN_MS * 3);
    expect(host.children).toHaveLength(0);
    vi.useRealTimers();
  });
  it('a failed load stands them in at once; a late model then replaces them', () => {
    vi.useFakeTimers();
    const host = new Group();
    const s = chairStandIns(() => host, spots, -0.9, () => {});
    s.failed();
    expect(host.children).toHaveLength(2);
    s.arrived();
    expect(host.children).toHaveLength(0);
    vi.useRealTimers();
  });
  it('the wait is short', () => {
    expect(CHAIR_STAND_IN_MS).toBeGreaterThanOrEqual(1000);
    expect(CHAIR_STAND_IN_MS).toBeLessThanOrEqual(5000);
  });
});

// "We need to make sure All venues have chairs": every room that loads the chair MODEL (rather
// than building its chairs in code) goes through the stand-in, and none of them seats the viewer.
describe('every model-loading room has stand-ins', () => {
  const rooms = ['cubeVenue.tsx', 'ClassicStudio.tsx', 'BarbershopRoom.tsx', 'KingLoungeRoom.tsx'];
  it('covers every room that loads chair.glb', () => {
    const dir = new URL('../src/three/', import.meta.url);
    const loaders = readdirSync(dir).filter((f) => f.endsWith('.tsx') && readFileSync(new URL(f, dir), 'utf8').includes('/chair.glb`)'));
    expect(loaders.sort()).toEqual([...rooms].sort());
  });
  for (const f of rooms) {
    it(`${f}: arrives, fails and disposes through chairStandIns, own chair left out`, () => {
      const src = read(`../src/three/${f}`);
      expect(src).toContain('chairStandIns(() => propsRef.current, hideOwnChair ? ');
      expect(src).toContain('standIns.arrived();');
      expect(src).toContain('} catch { standIns.failed();');
      expect(src).toContain('standIns.dispose();');
    });
  }
});

describe('rail camera and mic', () => {
  const css = read('../src/uiPass.css');
  it('drop the cut-corner slab in the short layout too', () => {
    expect(css).toMatch(/\.ctl-rail \.av-btn, \.table-screen\.short \.ctl-rail \.av-btn \{[^}]*clip-path: none;[^}]*background: transparent;/);
  });
  it('offline dims the icon and label, not the button', () => {
    expect(css).toContain('.ctl-rail .av-bar.offline .av-btn { opacity: 1; filter: none; }');
    expect(css).toContain('.ctl-rail .av-bar.offline .av-btn > * { opacity: .5; }');
  });
});
