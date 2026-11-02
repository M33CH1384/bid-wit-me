import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VENUES } from '../src/venues';
import { FELT_KEY_SEATED, SEAT_LIGHT_TUNE, SEAT_HEAD_Y, rimColor, seatRig, tuneFor } from '../src/three/seatLights';

const here = dirname(fileURLToPath(import.meta.url));
const cam = new Vector3(0, 1.95, 3.45); // the sitting camera the preview probe reported (classic, 844x390)
const right = new Vector3(1, 0, 0);

describe('seated-player lighting rig (SPEC §1)', () => {
  it('has a tuning row for every venue', () => {
    for (const v of VENUES) expect(SEAT_LIGHT_TUNE[v], v).toBeDefined();
    expect(tuneFor('nope')).toBe(SEAT_LIGHT_TUNE.classic);
  });
  it('key sits ~30° up, ~1 m out, in front of the face and on the camera side; rim behind the head', () => {
    const seats = { left: { x: -2.3, z: 0, out: new Vector3(-1, 0, 0) }, right: { x: 2.3, z: 0, out: new Vector3(1, 0, 0) }, top: { x: 0, z: -2.45, out: new Vector3(0, 0, -1) } };
    for (const [name, s] of Object.entries(seats)) {
      const r = seatRig(s, s.out, cam, right);
      expect(r.head.y).toBe(SEAT_HEAD_Y);
      const d = r.key.clone().sub(r.head);
      const flat = Math.hypot(d.x, d.z);
      expect(flat, name).toBeCloseTo(1, 5);
      expect((Math.atan2(d.y, flat) * 180) / Math.PI, name).toBeGreaterThan(25);
      expect((Math.atan2(d.y, flat) * 180) / Math.PI, name).toBeLessThan(35);
      const toTable = s.out.clone().negate();
      expect(new Vector3(d.x, 0, d.z).normalize().dot(toTable), `${name} key in front`).toBeGreaterThan(0);
      const toCam = new Vector3(cam.x - r.head.x, 0, cam.z - r.head.z).normalize();
      expect(new Vector3(d.x, 0, d.z).normalize().dot(toCam), `${name} key camera side`).toBeGreaterThan(0.5);
      const rd = r.rim.clone().sub(r.head);
      expect(new Vector3(rd.x, 0, rd.z).normalize().dot(toCam), `${name} rim behind`).toBeLessThan(0);
    }
  });
  it('side seats mirror each other', () => {
    const l = seatRig({ x: -2.3, z: 0 }, new Vector3(-1, 0, 0), cam, right), r = seatRig({ x: 2.3, z: 0 }, new Vector3(1, 0, 0), cam, right);
    expect(l.key.x).toBeCloseTo(-r.key.x); expect(l.key.z).toBeCloseTo(r.key.z);
  });
  it('steep venues raise the key (chandelier, streetlight)', () => {
    const a = seatRig({ x: 0, z: -2.45 }, new Vector3(0, 0, -1), cam, right, 0), b = seatRig({ x: 0, z: -2.45 }, new Vector3(0, 0, -1), cam, right, 15);
    expect(b.key.y).toBeGreaterThan(a.key.y);
  });
  it('rim colour is the venue tint pulled toward warm white', () => {
    expect(rimColor(SEAT_LIGHT_TUNE.classic!)).not.toBe('#9b5cff');
    expect(rimColor({ ...SEAT_LIGHT_TUNE.classic!, rimWhite: 0 })).toBe('#9b5cff');
  });
  it('Scene drops the felt spot and the back rim only while figures are seated; PersonaFigures has no chest uplight', () => {
    const scene = readFileSync(join(here, '../src/three/Scene.tsx'), 'utf8');
    expect(scene).toContain('(hi ? (seated ? FELT_KEY_SEATED : 70) : 55) * def.keyK');
    expect(scene).toContain('{!seated && <pointLight position={[0, 1.6, -4.2]}');
    expect(scene).toContain('seated={personaFiguresActive}');
    expect(FELT_KEY_SEATED).toBe(45);
    const pf = readFileSync(join(here, '../src/three/PersonaFigures.tsx'), 'utf8');
    expect(pf).not.toContain('FIGURE_FILL_INTENSITY');
    expect(pf).toContain('<SeatLights ');
  });
});
