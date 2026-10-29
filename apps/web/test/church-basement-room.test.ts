import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE CHURCH BASEMENT — story Stop 6's 3D room (Batch 4). Pins
 * the story-scoped seam and the room's certified identity so the
 * basement can't silently regress: the room mounts ONLY on a
 * church story table carrying stop `church-basement` at High
 * quality; every other church table (and Low everywhere) keeps
 * the shipped ChurchRoom (the cube-venue wrapper), byte-for-byte
 * the same mount as before. The room itself is ALL CODE (the
 * owner's code-first rule) — no GLB loading anywhere — and it
 * carries the Batch 4 identity anchors: cream cinderblock with
 * high frosted windows, brown tile floor, the kitchen pass-
 * through hatch with the coffee urn, the fellowship tables, the
 * folded-chair stack, and the sage-green folding chairs as the
 * play seats (manifest CHU-02 — the one room where the art's
 * chairs and the seat spots are the same object). Standing-
 * camera discipline (2026-10-28 gate): the low ceiling is a
 * single-sided plane at floor+2.95 and the fluorescent panels
 * ring the table instead of crossing it. Exclusions pinned: no
 * crosses or religious props, no text.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/ChurchBasementRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/ChurchRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

describe('the Church Basement — story canon', () => {
  it("stop church-basement plays at the church venue against Deacon Ford & Sister Mae", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'church-basement'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'church'");
    expect(stop).toContain("pair: ['deaconFord', 'sisterMae']");
  });
});

describe('the Church Basement — the Scene seam', () => {
  it('mounts ChurchBasementRoom only for the church-basement stop at High', () => {
    expect(scene).toContain("import ChurchBasementRoom from './ChurchBasementRoom';");
    expect(scene).toContain(
      "{church && textured && (props.storyStopId === 'church-basement' && props.quality === 'high'",
    );
    expect(scene).toContain('<ChurchBasementRoom fxOn={!props.reduceFx} />');
  });

  it('keeps ChurchRoom as the fallback on the same branch', () => {
    expect(scene).toContain(
      ': <ChurchRoom quality={props.quality} handNo={props.handNo} />)}',
    );
    expect(venueRoom.length).toBeGreaterThan(0);
  });
});

describe('the Church Basement — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeTileTexture()');
    expect(room).toContain('function makeCinderTexture()');
    expect(room).toContain('function makeCeilingTexture()');
  });
});

describe('the Church Basement — identity anchors', () => {
  it('builds the hatch with its urn, the fellowship tables, and the chair stack', () => {
    expect(room).toContain('function Hatch(');
    expect(room).toContain('function FellowshipTable(');
    expect(room).toContain('function ChairStack(');
    expect(room).toContain('function WaterCooler(');
    expect(room).toContain('function StorageStack(');
    expect(room).toContain('function FrostedWindow(');
  });

  it('seats the table in the sage-green folding chairs (CHU-02)', () => {
    expect(room).toContain('function FoldingChairs(');
    expect(room).toContain('#71806a');
  });

  it('honors the exclusions: no religious props, no text', () => {
    // the header states the exclusion; what must never appear is a
    // builder for one ('across'/'no crosses' in comments are fine)
    expect(room).not.toContain('function Cross');
    expect(room).not.toContain('Crucifix');
    expect(room).not.toContain('fillText');
    expect(room).toContain('HARD EXCLUSIONS (manifest): no crosses or religious props');
  });
});

describe('the Church Basement — standing + clearance discipline', () => {
  it('keeps the low ceiling at floor+2.95 with panels ringing the table', () => {
    expect(room).toContain('const WALL_H = 2.95;');
    expect(room).toContain('function FluoroPanels(');
    expect(room).toContain('function PanelHum(');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
  });
});
