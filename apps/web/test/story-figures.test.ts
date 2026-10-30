/**
 * The character rollout pins — Batch 1 (owner, 2026-10-29: "add the
 * characters to all the tables").
 *
 * The Porch pilot's seated-figures layer generalized to the story
 * route. These tests pin: the gate's per-stop figure rows (the loader
 * waits on exactly the GLBs the table presents, at High, at the
 * stop's own venue — and nowhere else), the per-stop seat configs
 * against the PRODUCTION rooms' chair geometry (the solve seats on
 * the room's chairs, not a shared guess), the cast registers, the
 * GLBs' full-quality body textures (the q95 fleet recipe — the
 * squeezed first-pass textures fail these floors), and the co-op
 * scoping (pair figures only; Dee never seats in co-op).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STORY_FIGURE_SEAMS, SEDAN_GLB_URL, roomGlbUrls, storyFigureGlbs } from '../src/assetGate';
import { FIGURE_SEAT_CONFIGS, FOLDING_SEAT_TOP, KIT_SEAT_TOP, LEGENDS_SEAT_TOP, PENTHOUSE_SEAT_TOP } from '../src/three/figureSeats';

const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');
const pub = (url: string) => join(process.cwd(), 'apps/web', 'public', url);

const BATCH1: Record<string, { venue: string; ids: string[] }> = {
  barbershop: { venue: 'barbershop', ids: ['dee', 'mrColeman', 'june'] },
  'rec-center': { venue: 'classic', ids: ['dee', 'lilMan', 'trey'] },
  cookout: { venue: 'backyard', ids: ['dee', 'keisha', 'teisha'] },
};

describe('the gate figure rows (Batch 1 stops)', () => {
  it('each Batch 1 stop gates exactly Dee + its pair, at its own venue, High only', () => {
    for (const [stop, { venue, ids }] of Object.entries(BATCH1)) {
      expect(storyFigureGlbs(venue, stop).map((f) => f.id)).toEqual(ids);
      expect(roomGlbUrls(venue, 'high', stop).map((g) => g.url))
        .toEqual(ids.map((id) => `/assets/figures/${id}.glb`));
      expect(roomGlbUrls(venue, 'low', stop)).toEqual([]);
      // a stop id at the wrong venue gates nothing
      expect(storyFigureGlbs('grandma', stop)).toEqual([]);
    }
    expect(roomGlbUrls('classic', 'high', null)).toEqual([]);
  });

  it('the seam table covers the Porch pilot row unchanged', () => {
    const porch = STORY_FIGURE_SEAMS.find((s) => s.stop === 'porch')!;
    expect(porch.venue).toBe('grandma');
    expect(porch.figures.map((f) => f.id)).toEqual(['dee', 'uncleRay', 'pat']);
  });

  it('the King stop has no figure row — its seated figures ride KingRail', () => {
    expect(STORY_FIGURE_SEAMS.find((s) => s.stop === 'king')).toBeUndefined();
    expect(FIGURE_SEAT_CONFIGS['king']).toBeUndefined();
  });
});

describe('the Batch 1 GLBs', () => {
  it('exist in the production tree, full-size', () => {
    for (const { ids } of Object.values(BATCH1)) {
      for (const id of ids) {
        const st = statSync(pub(`/assets/figures/${id}.glb`));
        expect(st.size, id).toBeGreaterThan(1_000_000);
      }
    }
  });

  it('carry full-quality body textures (q95 recipe), not the squeezed first pass', () => {
    // Floors sit between the sandbox -opt squeeze (89–173 KB) and the
    // q95 re-encode from the Forge source PNGs (216–434 KB).
    const floors: Record<string, number> = {
      mrColeman: 200_000, june: 300_000, lilMan: 200_000,
      trey: 150_000, keisha: 180_000, teisha: 200_000,
    };
    for (const [id, floor] of Object.entries(floors)) {
      const buf = readFileSync(pub(`/assets/figures/${id}.glb`));
      const jsonLen = buf.readUInt32LE(12);
      const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
      const largest = Math.max(...gltf.images.map((im: { bufferView: number }) => gltf.bufferViews[im.bufferView].byteLength));
      expect(largest, `${id} body texture`).toBeGreaterThan(floor);
    }
  });
});

describe('the cast registers', () => {
  const fig = src('src/three/PorchFigures.tsx');

  it('carries a register for every Batch 1 character, statures in the pilot band', () => {
    const statures: Record<string, number> = {
      mrColeman: 1.78, june: 1.70, lilMan: 1.72, trey: 1.80, keisha: 1.75, teisha: 1.74,
    };
    for (const [id, s] of Object.entries(statures)) {
      expect(fig).toContain(`${id}: {\n    stature: ${s.toFixed(2)}`);
    }
  });

  it('every gated figure id resolves to a register + URL in the module', () => {
    for (const seam of STORY_FIGURE_SEAMS) {
      for (const f of seam.figures) {
        expect(fig).toContain(`${f.id}: {`);
        expect(f.url).toBe(`/assets/figures/${f.id}.glb`);
      }
    }
  });
});

describe('the per-stop seat configs', () => {
  it('the Porch row is the pilot geometry (classic anchors, PORCH_SEAT_TOP)', () => {
    // PORCH_SEAT_TOP itself is pinned in porch-figures.test.ts.
    expect(src('src/three/PorchFigures.tsx')).toContain('export const PORCH_SEAT_TOP = -0.41');
    expect(FIGURE_SEAT_CONFIGS['porch']!.seatTop).toBe(-0.41);
    expect(FIGURE_SEAT_CONFIGS['porch']!.spots.top).toEqual({ x: 0, z: -2.45, ry: 0 });
    expect(FIGURE_SEAT_CONFIGS['porch']!.spots.bottom).toEqual({ x: 0, z: 2.8, ry: Math.PI });
  });

  it('the kit-chair seat top is the rooms’ own arithmetic (FLOOR_Y + 0.49 + half the box)', () => {
    expect(KIT_SEAT_TOP).toBeCloseTo(-0.9 + 0.49 + 0.014, 10);
    for (const stop of ['barbershop', 'rec-center', 'cookout']) {
      expect(FIGURE_SEAT_CONFIGS[stop]!.seatTop).toBe(KIT_SEAT_TOP);
    }
    // the kit seat box, identical in all three room sources
    for (const room of ['BarbershopMirrorRoom.tsx', 'RecCenterGymRoom.tsx', 'CookoutYardRoom.tsx']) {
      expect(src(`src/three/${room}`)).toContain('box(0.42, 0.028, 0.40, 0, 0.49, 0.02)');
    }
  });

  it('Barbershop + Cookout configs match the rooms’ LOCAL chair spots', () => {
    for (const stop of ['barbershop', 'cookout']) {
      const spots = FIGURE_SEAT_CONFIGS[stop]!.spots;
      expect(spots.top).toEqual({ x: 0, z: -1.98, ry: 0 });
      expect(spots.bottom).toEqual({ x: 0, z: 1.98, ry: Math.PI });
      expect(spots.left).toEqual({ x: -2.14, z: 0, ry: Math.PI / 2 });
      expect(spots.right).toEqual({ x: 2.14, z: 0, ry: -Math.PI / 2 });
    }
    for (const room of ['BarbershopMirrorRoom.tsx', 'CookoutYardRoom.tsx']) {
      const text = src(`src/three/${room}`);
      expect(text).toContain('{ pos: [0, FLOOR_Y, -1.98], ry: 0 }');
      expect(text).toContain('{ pos: [0, FLOOR_Y, 1.98], ry: Math.PI }');
      expect(text).toContain('{ pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 }');
      expect(text).toContain('{ pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 }');
    }
  });

  it('the Rec Center config uses the shared studio anchors its room imports', () => {
    const spots = FIGURE_SEAT_CONFIGS['rec-center']!.spots;
    expect(spots.top).toEqual({ x: 0, z: -2.45, ry: 0 });
    expect(spots.left).toEqual({ x: -2.3, z: 0, ry: Math.PI / 2 });
    expect(spots.right).toEqual({ x: 2.3, z: 0, ry: -Math.PI / 2 });
    expect(src('src/three/RecCenterGymRoom.tsx')).toContain("import { CHAIR_SPOTS } from './classicStudioLayout'");
    expect(src('src/three/classicStudioLayout.ts')).toContain('{ x: 0, z: -2.45, ry: 0 }');
  });

  it('Scene only mounts figures where a seat config exists', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain('const figureSeatConfig = props.storyStopId ? FIGURE_SEAT_CONFIGS[props.storyStopId] : undefined');
    expect(scene).toContain('seatConfig={figureSeatConfig}');
  });
});

const BATCH2: Record<string, { venue: string; ids: string[] }> = {
  corner: { venue: 'speakeasy', ids: ['dee', 'smoke', 'redd'] },
  'church-basement': { venue: 'church', ids: ['dee', 'deaconFord', 'sisterMae'] },
  rooftop: { venue: 'rooftop', ids: ['dee', 'poet', 'seven'] },
  'high-rise': { venue: 'mansion', ids: ['dee', 'velvet', 'accountant'] },
};

describe('the gate figure rows (Batch 2 stops)', () => {
  it('each Batch 2 stop gates exactly Dee + its pair, at its own venue, High only', () => {
    for (const [stop, { venue, ids }] of Object.entries(BATCH2)) {
      expect(storyFigureGlbs(venue, stop).map((f) => f.id)).toEqual(ids);
      expect(roomGlbUrls(venue, 'low', stop)).toEqual([]);
      expect(storyFigureGlbs('grandma', stop)).toEqual([]);
    }
    // sedan-free stops: the figure GLBs are the whole room list
    for (const stop of ['church-basement', 'rooftop', 'high-rise']) {
      const { venue, ids } = BATCH2[stop]!;
      expect(roomGlbUrls(venue, 'high', stop).map((g) => g.url))
        .toEqual(ids.map((id) => `/assets/figures/${id}.glb`));
    }
    // the Corner keeps its Forge sedan ahead of the figure seam
    expect(roomGlbUrls('speakeasy', 'high', 'corner').map((g) => g.url)).toEqual([
      SEDAN_GLB_URL,
      ...BATCH2['corner']!.ids.map((id) => `/assets/figures/${id}.glb`),
    ]);
  });

  it('the Batch 2 GLBs exist full-size with q95 body textures', () => {
    const floors: Record<string, number> = {
      smoke: 150_000, redd: 150_000, deaconFord: 200_000, sisterMae: 200_000,
      poet: 250_000, seven: 130_000, velvet: 200_000, accountant: 200_000,
    };
    for (const { ids } of Object.values(BATCH2)) {
      for (const id of ids) {
        expect(statSync(pub(`/assets/figures/${id}.glb`)).size, id).toBeGreaterThan(1_000_000);
      }
    }
    for (const [id, floor] of Object.entries(floors)) {
      const buf = readFileSync(pub(`/assets/figures/${id}.glb`));
      const jsonLen = buf.readUInt32LE(12);
      const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
      const largest = Math.max(...gltf.images.map((im: { bufferView: number }) => gltf.bufferViews[im.bufferView].byteLength));
      expect(largest, `${id} body texture`).toBeGreaterThan(floor);
    }
  });

  it('carries a register for every Batch 2 character, statures in the pilot band', () => {
    const fig = src('src/three/PorchFigures.tsx');
    const statures: Record<string, number> = {
      smoke: 1.85, redd: 1.88, deaconFord: 1.82, sisterMae: 1.69,
      poet: 1.79, seven: 1.84, velvet: 1.78, accountant: 1.76,
    };
    for (const [id, s] of Object.entries(statures)) {
      expect(fig).toContain(`${id}: {\n    stature: ${s.toFixed(2)}`);
    }
  });
});

describe('the per-stop seat configs (Batch 2)', () => {
  it('Corner + Rooftop: classic anchors, the folding-chair top from the rooms’ own box', () => {
    expect(FOLDING_SEAT_TOP).toBeCloseTo(-0.9 + 0.478 + 0.014, 10);
    for (const stop of ['corner', 'rooftop']) {
      const cfg = FIGURE_SEAT_CONFIGS[stop]!;
      expect(cfg.seatTop).toBe(FOLDING_SEAT_TOP);
      expect(cfg.spots.top).toEqual({ x: 0, z: -2.45, ry: 0 });
      expect(cfg.spots.left).toEqual({ x: -2.3, z: 0, ry: Math.PI / 2 });
    }
    for (const room of ['CornerStreetRoom.tsx', 'RooftopDuskRoom.tsx']) {
      const text = src(`src/three/${room}`);
      expect(text).toContain('box(0.43, 0.028, 0.40, 0, 0.478, 0)');
      expect(text).toContain("import { CHAIR_SPOTS } from './classicStudioLayout'");
    }
  });

  it('Church Basement: kit anchors + kit top, matching the room’s LOCAL spots', () => {
    const cfg = FIGURE_SEAT_CONFIGS['church-basement']!;
    expect(cfg.seatTop).toBe(KIT_SEAT_TOP);
    expect(cfg.spots.top).toEqual({ x: 0, z: -1.98, ry: 0 });
    expect(cfg.spots.bottom).toEqual({ x: 0, z: 1.98, ry: Math.PI });
    expect(cfg.spots.left).toEqual({ x: -2.14, z: 0, ry: Math.PI / 2 });
    expect(cfg.spots.right).toEqual({ x: 2.14, z: 0, ry: -Math.PI / 2 });
    const text = src('src/three/ChurchBasementRoom.tsx');
    expect(text).toContain('{ pos: [0, FLOOR_Y, -1.98], ry: 0 }');
    expect(text).toContain('{ pos: [0, FLOOR_Y, 1.98], ry: Math.PI }');
    expect(text).toContain('{ pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 }');
    expect(text).toContain('{ pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 }');
    expect(text).toContain('box(0.42, 0.028, 0.40, 0, 0.49, 0.02)');
  });

  it('High-Rise: classic anchors, the armchair cushion top the room documents', () => {
    expect(PENTHOUSE_SEAT_TOP).toBeCloseTo(-0.9 + 0.45, 10);
    const cfg = FIGURE_SEAT_CONFIGS['high-rise']!;
    expect(cfg.seatTop).toBe(PENTHOUSE_SEAT_TOP);
    expect(cfg.spots.top).toEqual({ x: 0, z: -2.45, ry: 0 });
    const text = src('src/three/HighRisePenthouseRoom.tsx');
    expect(text).toContain('box(0.56, 0.10, 0.52, 0, 0.40, 0.0)');
    expect(text).toContain("import { CHAIR_SPOTS } from './classicStudioLayout'");
  });
});

/* ------------------------------------------------------------------ */
/* Batch 3: Stops 9-10 (the Pj's, Legends). The King (Stop 11) keeps  */
/* its shipped KingRail seated portrait planes — no seam row, no      */
/* seat config, no registers for king/ringer under this rollout.      */
/* ------------------------------------------------------------------ */

const BATCH3: Record<string, { venue: string; pair: [string, string]; total: number }> = {
  'the-pjs': { venue: 'blockAfterDark', pair: ['captainBlock', 'brick'], total: 8734652 },
  legends: { venue: 'vegas', pair: ['queenie', 'ace'], total: 11032772 },
};

describe('the gate figure rows (Batch 3 stops)', () => {
  it('each batch-3 stop gates Dee + its pair, sized exactly, and nowhere else', () => {
    for (const [stop, { venue, pair, total }] of Object.entries(BATCH3)) {
      const rows = storyFigureGlbs(venue, stop);
      expect(rows.map((f) => f.url)).toEqual([
        '/assets/figures/dee.glb',
        `/assets/figures/${pair[0]}.glb`,
        `/assets/figures/${pair[1]}.glb`,
      ]);
      let sum = 0;
      for (const f of rows) sum += statSync(pub(f.url)).size;
      expect(sum).toBe(total);
      expect(storyFigureGlbs(venue, null)).toEqual([]);
      expect(storyFigureGlbs('classic', stop)).toEqual([]);
    }
  });

  it("the Pj's figures ride behind the sedan; Legends carries no sedan", () => {
    expect(roomGlbUrls('blockAfterDark', 'high', 'the-pjs').map((g) => g.url)).toEqual([
      SEDAN_GLB_URL,
      '/assets/figures/dee.glb',
      '/assets/figures/captainBlock.glb',
      '/assets/figures/brick.glb',
    ]);
    expect(roomGlbUrls('vegas', 'high', 'legends').map((g) => g.url)).toEqual([
      '/assets/figures/dee.glb',
      '/assets/figures/queenie.glb',
      '/assets/figures/ace.glb',
    ]);
  });

  it('the King stop has NO figure seam — its seated planes are the shipped system', () => {
    expect(storyFigureGlbs('blockAfterDark', 'king')).toEqual([]);
    expect(FIGURE_SEAT_CONFIGS.king).toBeUndefined();
    const fig = src('src/three/PorchFigures.tsx');
    expect(fig).not.toContain('king: {\n    stature');
    expect(fig).not.toContain('ringer: {\n    stature');
  });

  it('batch-3 GLBs exist at honest sizes with q95 texture floors', () => {
    const floors: Record<string, number> = {
      captainBlock: 250000, brick: 200000, queenie: 300000, ace: 170000,
    };
    for (const [id, floor] of Object.entries(floors)) {
      expect(statSync(pub(`/assets/figures/${id}.glb`)).size, id).toBeGreaterThan(1_000_000);
      const buf = readFileSync(pub(`/assets/figures/${id}.glb`));
      const jsonLen = buf.readUInt32LE(12);
      const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
      const largest = Math.max(...gltf.images.map((im: { bufferView: number }) => gltf.bufferViews[im.bufferView].byteLength));
      expect(largest, `${id} body texture`).toBeGreaterThan(floor);
    }
  });

  it('carries a register for every Batch 3 character, statures in the pilot band', () => {
    const fig = src('src/three/PorchFigures.tsx');
    const statures: Record<string, number> = {
      captainBlock: 1.90, brick: 1.73, queenie: 1.72, ace: 1.81,
    };
    for (const [id, s] of Object.entries(statures)) {
      expect(fig).toContain(`${id}: {\n    stature: ${s.toFixed(2)}`);
    }
  });
});

describe('the per-stop seat configs (Batch 3)', () => {
  it("the Pj's: classic anchors, the folding-chair top from the room's own box", () => {
    const cfg = FIGURE_SEAT_CONFIGS['the-pjs']!;
    expect(cfg.seatTop).toBe(FOLDING_SEAT_TOP);
    expect(cfg.spots.top).toEqual({ x: 0, z: -2.45, ry: 0 });
    expect(cfg.spots.left).toEqual({ x: -2.3, z: 0, ry: Math.PI / 2 });
    const text = src('src/three/PjsStreetRoom.tsx');
    expect(text).toContain('box(0.43, 0.028, 0.40, 0, 0.478, 0), // seat — top at 0.492');
    expect(text).toContain("import { CHAIR_SPOTS } from './classicStudioLayout'");
  });

  it('Legends: classic anchors, the leather cushion top from the room’s own box', () => {
    expect(LEGENDS_SEAT_TOP).toBeCloseTo(-0.9 + 0.475 + 0.0275, 10);
    const cfg = FIGURE_SEAT_CONFIGS.legends!;
    expect(cfg.seatTop).toBe(LEGENDS_SEAT_TOP);
    expect(cfg.spots.top).toEqual({ x: 0, z: -2.45, ry: 0 });
    expect(cfg.spots.left).toEqual({ x: -2.3, z: 0, ry: Math.PI / 2 });
    const text = src('src/three/LegendsTableRoom.tsx');
    expect(text).toContain('box(0.48, 0.055, 0.48, 0, 0.475, 0)');
    expect(text).toContain("import { CHAIR_SPOTS } from './classicStudioLayout'");
  });
});

describe('the co-op scoping', () => {
  it('OnlineTable seats the pair at the bot seats for non-King story stops, humans never', () => {
    const online = src('src/online/OnlineTable.tsx');
    expect(online).toContain("figureSeats: room.story && room.story.stopId !== 'king'");
    expect(online).toContain('STORY_STOPS.find((s) => s.id === room.story!.stopId)!.pair[srv === 1 ? 0 : 1]');
    expect(online).toContain("room.seats[srv]?.kind === 'bot'");
  });
});
