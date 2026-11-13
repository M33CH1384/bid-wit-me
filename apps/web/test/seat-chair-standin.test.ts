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
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, type Mesh } from 'three';
import { CHAIR_STAND_IN_MS, SIMPLE_CHAIR_SEAT, SIMPLE_CHAIR_TRIS, buildSimpleChair } from '../src/three/cubeVenue';

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

describe('stand-in wiring', () => {
  const src = read('../src/three/cubeVenue.tsx');
  it('stands in after a short wait and on a failed load, and steps aside for the model', () => {
    expect(CHAIR_STAND_IN_MS).toBeGreaterThanOrEqual(1000);
    expect(CHAIR_STAND_IN_MS).toBeLessThanOrEqual(5000);
    expect(src).toContain('window.setTimeout(standIn, CHAIR_STAND_IN_MS)');
    expect(src).toContain('} catch { window.clearTimeout(standInTimer); standIn();');
    expect(src).toContain('window.clearTimeout(standInTimer); clearStandIn();');
  });
  it('still hides the viewer’s own chair', () => {
    expect(src).toContain('addSimpleChairs(propsRef.current, cfg.chairSpots ?? studioSpots, skipOwn)');
    expect(src).toContain('if (skipOwn(spot)) continue;');
  });
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
