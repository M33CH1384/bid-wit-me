import { describe, expect, it } from 'vitest';
import { fitToTable, overlayPlacement } from '../src/photoreal/host';

/**
 * Full-viewport coverage contract (owner, 2026-11-05): "When the screen
 * animations happen in landscape it doesn't cover the full screen."
 *
 * The photoreal canvas used to be CSS-scaled by fitToTable's k about
 * ground zero. In landscape the projected table is narrower than the
 * modules' assumed table, so k < 1 and the whole canvas — including the
 * modules' full-canvas dim/flash paints (lightning's pre-strike dim,
 * meteor's fade, quake's wash) — displayed as a bounded rectangle over
 * the table with the bright room showing around all four edges.
 *
 * The contract now: quake / lightning / meteor / goldrain are NOT
 * css-scaled (scale 1) and draw at the TRUE table radii, so their table
 * art lands exactly where it lands today while their full-canvas paints
 * cover the full viewport in every orientation. The nuke alone keeps
 * its world-scale: the NUKE_ENGULF scale IS the effect (the cap
 * engulfs the table), its k is > 1 by construction, and its draw radii
 * stay compensated by that scale.
 */

// The owner's landscape case (932×430): projected table half-width
// 290 px against the module's assumed 408.5 px → fitToTable k ≈ 0.71.
const LAND = { table: { cx: 466, cy: 185, x0: 176, x1: 756, y0: 40, y1: 330 }, trick: [{ x: 452, y: 165, w: 30, h: 40 }] };

describe('photoreal overlays: full-viewport coverage', () => {
  it('the landscape fit really is a shrink (the defect precondition)', () => {
    expect(fitToTable('quake', 932, 430, LAND).k).toBeLessThan(0.8);
  });

  it('non-nuke overlays are not css-scaled in landscape', () => {
    for (const name of ['quake', 'lightning', 'meteor', 'goldrain'] as const) {
      expect(overlayPlacement(name, 932, 430, LAND).scale).toBe(1);
    }
  });

  it('non-nuke overlays are not css-scaled in portrait either', () => {
    for (const name of ['quake', 'lightning', 'meteor', 'goldrain'] as const) {
      expect(overlayPlacement(name, 390, 844, null).scale).toBe(1);
    }
  });

  it('non-nuke overlays draw at the true table radii, ground zero unchanged', () => {
    for (const name of ['quake', 'lightning', 'meteor', 'goldrain'] as const) {
      const f = fitToTable(name, 932, 430, LAND);
      const p = overlayPlacement(name, 932, 430, LAND);
      expect(p.drawRx).toBe(f.rx);
      expect(p.drawRy).toBe(f.ry);
      expect([p.gx, p.gy]).toEqual([f.gx, f.gy]);
    }
  });

  it('the nuke keeps its engulf world-scale and compensated draw radii', () => {
    const f = fitToTable('nuke', 932, 430, LAND);
    const p = overlayPlacement('nuke', 932, 430, LAND);
    expect(p.scale).toBe(f.k);
    expect(p.scale).toBeGreaterThan(1); // NUKE_ENGULF: covers the viewport by construction
    expect(p.drawRx).toBeCloseTo(f.rx / f.k, 6);
    expect(p.drawRy).toBeCloseTo(f.ry / f.k, 6);
    expect([p.gx, p.gy]).toEqual([f.gx, f.gy]);
  });
});
