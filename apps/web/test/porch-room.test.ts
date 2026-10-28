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

  it('ceiling is the single-sided camera-containment plane at deck + 3.2', () => {
    const room = src('src/three/PorchDeckRoom.tsx');
    expect(room).toContain('FLOOR_Y + 3.2');
    expect(room).toContain('planeGeometry args={[7.6, 4.8]}');
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
