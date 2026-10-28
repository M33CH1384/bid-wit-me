/**
 * The Porch room wiring pins (rooms pipeline Batch 3a).
 *
 * The Porch's story venue is `grandma`, but production `grandma`
 * is the selectable Grandma's Kitchen — a different place. The
 * story-scoped seam the Corner established applies: the Porch
 * deck room mounts only on tables carrying story stop 'porch'
 * at High quality; the grandma venue and Low keep today's
 * behavior exactly. These tests pin that seam, the code-first
 * route (zero Forge mixes, procedural textures), the
 * camera-containment ceiling discipline, and the no-own-table
 * anchor rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

describe('the Porch story-scoped mount seam', () => {
  it('story canon: the Porch stop borrows the grandma venue', () => {
    // the canonical stop table lives in the shared bots package
    const stops = readFileSync(join(process.cwd(), 'packages/bots/src/story.ts'), 'utf8');
    const i = stops.indexOf("id: 'porch'");
    expect(i).toBeGreaterThan(0);
    expect(stops.slice(i, i + 300)).toContain("venueId: 'grandma'");
  });

  it('Scene mounts PorchDeckRoom only for story stop porch at High', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain("props.storyStopId === 'porch' && props.quality === 'high'");
    expect(scene).toContain('<PorchDeckRoom />');
    // the fallback stays GrandmaRoom exactly
    expect(scene).toContain('<GrandmaRoom quality={props.quality} handNo={props.handNo} />');
  });

  it('the storyStopId plumbing already shipped with the Corner carries porch too', () => {
    const table = src('src/Table.tsx');
    expect(table).toContain('storyStopId={storyStopId ?? online?.storyStopId ?? null}');
    const online = src('src/online/OnlineTable.tsx');
    expect(online).toContain('storyStopId: room.story?.stopId ?? null');
  });
});

describe('the Porch room build', () => {
  it('is code-first: procedural canvas textures, zero Forge/GLB loads', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    expect(room).toContain('makeSidingTexture');
    expect(room).toContain('makeBeadboardTexture');
    expect(room).toContain('makeDuskSkyTexture');
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
  });

  it('carries the identity anchors: screen door, rockers, string lights, railing', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    expect(room).toContain('<ScreenDoor />');
    expect(room).toContain('throwPlaid');
    expect(room).toContain('<StringLights');
    expect(room).toContain('<RailingRun');
  });

  it('ceiling is the single-sided camera-containment plane at deck + 4.0', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    expect(room).toContain('FLOOR_Y + 4.0');
    expect(room).toContain('planeGeometry args={[7.6, 6.7]}');
  });

  it('the light-carrying header wood is raised and behind the standing camera (owner fix 2026-10-28)', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    // the fascia/header the string lights hang along: raised to
    // deck +3.88 and moved to the extended deck's front edge
    // (z +4.32) — the standing camera sits at z +3.75, so the
    // board can never band across its view of the felt again
    expect(room).toContain('position={[0, FLOOR_Y + 3.88, 4.32]}');
    // the beams rose with the ceiling
    expect(room).toContain('FLOOR_Y + 3.93');
    // and nothing of the old header line survives
    expect(room).not.toContain('FLOOR_Y + 3.08, 2.42');
    expect(room).not.toContain('FLOOR_Y + 3.13');
  });

  it('the deck extends behind the player seat and the entry moved to the east side (owner fix 2026-10-28)', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    // deck runs to z +4.3 — the player sits ON the porch
    expect(room).toContain('boxGeometry args={[7.6, 0.1, 6.7]}');
    // the front railing runs full width — no gap at his back
    expect(room).toContain('from={[-3.3, 4.0]} to={[3.3, 4.0]}');
    // the entry steps descend the EAST side, off the table axis
    expect(room).toContain('3.56 + i * 0.32');
    expect(room).not.toContain('2.62 + i * 0.3');
  });

  it('owns no table of its own and places chairs only at the game spots', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('CHAIR_SPOTS');
  });

  it('has no animated loops to gate — static at every effects setting', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    expect(room).not.toContain('useFrame');
  });
});
