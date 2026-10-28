/**
 * The Corner street room (rooms pipeline Batch 2, owner route
 * 2026-10-28: code-first, mix when necessary; roll in as ready).
 *
 * Story Stop 5 (Smoke & Redd) plays at venueId `speakeasy` — but the
 * production speakeasy venue is the Speakeasy LOUNGE, a different
 * place. The Corner street environment is therefore STORY-SCOPED:
 * it mounts only when the table carries story stop `corner` at High
 * quality, in place of SpeakeasyRoom. These pins hold that seam:
 *  - Scene's speakeasy branch swaps rooms on (storyStopId ===
 *    'corner' && quality high) and NOTHING else — non-story tables,
 *    other stops, and Low quality keep SpeakeasyRoom exactly.
 *  - Table feeds the prop from the solo story scene first, then the
 *    online (co-op) room prop — the kingGunSeat precedence pattern.
 *  - OnlineTable carries the room's stop id through.
 *  - The room itself stays code-first (procedural textures/geometry)
 *    with the ONE justified mix: the Pj's Forge sedan, reused from
 *    SEDAN_URL, loaded declaratively — never imperatively — and
 *    tinted darker per the Corner manifest (COR-07). Effects-off
 *    (fxOn false) collapses the flicker/ticker to a static frame.
 *  - The story canon agrees: the corner stop's venueId IS speakeasy
 *    (the borrowed venue the seam keys on).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORY_STOPS } from '@spades/bots';

const src = (rel: string) => readFileSync(join(process.cwd(), 'apps/web', rel), 'utf8');

describe('The Corner — story-scoped street room', () => {
  it('story canon: the corner stop borrows the speakeasy venue', () => {
    const corner = STORY_STOPS.find((s) => s.id === 'corner')!;
    expect(corner.venueId).toBe('speakeasy');
  });

  it('Scene swaps the speakeasy room only for a corner story table at High', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain("import CornerStreetRoom from './CornerStreetRoom';");
    expect(scene).toContain('storyStopId?: string | null;');
    const branch = scene.slice(scene.indexOf('{speakeasy && textured'), scene.indexOf('{grandma && textured'));
    expect(branch).toContain("props.storyStopId === 'corner' && props.quality === 'high'");
    expect(branch).toContain('<CornerStreetRoom fxOn={!props.reduceFx} />');
    expect(branch).toContain('<SpeakeasyRoom quality={props.quality} handNo={props.handNo} />');
  });

  it('Table feeds storyStopId: solo story scene first, then the co-op room prop', () => {
    const table = src('src/Table.tsx');
    expect(table).toContain('storyStopId={storyStopId ?? online?.storyStopId ?? null}');
    expect(table).toContain('storyStopId?: string | null;');
  });

  it('OnlineTable carries the room stop id into the table props', () => {
    const online = src('src/online/OnlineTable.tsx');
    expect(online).toContain('storyStopId: room.story?.stopId ?? null,');
  });

  it('the room is code-first: procedural textures, no image assets', () => {
    const room = src('src/three/CornerStreetRoom.tsx');
    expect(room).toContain('makeShopWindowTexture');
    expect(room).toContain('makeAwningTexture');
    expect(room).not.toMatch(/url\(|assets\/venues\/speakeasy/);
    // the shop windows carry silhouettes only — no lettering path exists
    expect(room).toContain('NO readable text');
  });

  it('the one mix: the Pj\'s Forge sedan, reused + declarative + tinted darker', () => {
    const room = src('src/three/CornerStreetRoom.tsx');
    expect(room).toContain("import { SEDAN_URL } from './PjsStreetRoom';");
    expect(room).toContain('useLoader(GLTFLoader, SEDAN_URL)');
    expect(room).toContain('CornerSedanBoundary');
    expect(room).toContain('multiplyScalar(0.55)');
    // never the imperative loader that intermittently dropped the car
    expect(room).not.toContain('GLTFLoader().load');
    expect(room).not.toContain('new GLTFLoader');
  });

  it('the fence is chain-link — the owner\'s 2026-10-28 pick over the picket reuse', () => {
    const room = src('src/three/CornerStreetRoom.tsx');
    expect(room).toContain('makeChainLinkTexture');
    expect(room).toContain('alphaTest: 0.45');
    expect(room).toContain('<ChainLinkFence />');
    expect(room).not.toContain('picketFenceGeo');
  });

  it('effects discipline: fxOn gates the flicker and the frame ticker', () => {
    const room = src('src/three/CornerStreetRoom.tsx');
    expect(room).toContain('export default function CornerStreetRoom({ fxOn }: { fxOn: boolean })');
    expect(room).toContain('if (!fxOn) return; // steady burn');
    expect(room).toContain('<RoomTicker fxOn={fxOn} />');
  });

  it('the anchor never moves: the room builds no table of its own', () => {
    const room = src('src/three/CornerStreetRoom.tsx');
    expect(room).not.toContain('TableModel');
    expect(room).not.toContain('tableBody');
    // chairs ride the game's own seat layout
    expect(room).toContain("import { CHAIR_SPOTS } from './classicStudioLayout';");
  });
});
