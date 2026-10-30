/**
 * Seat-placed player video (owner directive 2026-10-30: the feed belongs
 * in the seat the player is playing from).
 *
 * Pins, without a real camera:
 * - the gate (seatVideoFeedsFor): which local seats carry a stream into
 *   the scene — seated clients only, never the viewer's own seat, never
 *   bots, never camera-off / disconnected / hidden players;
 * - the mapping (assignSeatVideos + seatVideoSpot): a feed lands at ITS
 *   seat's chair coordinates (partner top, opponents left/right), the
 *   human seat is never assigned, spots are the KingRail seated math;
 * - the yaw clamp (seatVideoYawAt): the plane turns toward the camera
 *   but stays seated (≤ maxYawRad from its facing);
 * - the wiring (source pins): OnlineTable builds the feeds and passes
 *   them through Table into the Scene's SeatVideoLayer; SeatMedia
 *   collapses its bubble while the scene carries the feed; spectators
 *   and the watch app never receive seat streams.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeatInfo } from '@spades/protocol';
import { seatVideoFeedsFor } from '../src/online/seatVideoFeeds';
import { assignSeatVideos, clampYawToFacing, seatVideoSpot, seatVideoYawAt, SEAT_VIDEO } from '../src/three/seatVideoLayout';
import type { SeatPos } from '../src/three/layout';

const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

const fakeStream = (id: string) => ({ id, getVideoTracks: () => [] }) as unknown as MediaStream;
const human = (playerId: string, cam = true, connected = true): SeatInfo => ({
  kind: 'human', playerId, name: playerId, connected, media: { cam, mic: false },
});
const bot: SeatInfo = { kind: 'bot', name: 'Bot', level: 'regular' };

/* server seats: 0 = me, 1 = partner (top), 2/3 = opponents. The viewer
 * sits at server seat 0, so local = server for this fixture's rot. */
const identity = (l: number) => l;

describe('the gate: which seats carry a feed into the scene', () => {
  const partner = fakeStream('partner');
  const opp = fakeStream('opp');
  const base = {
    spectator: false,
    seats: [human('me'), human('partner'), human('opp'), bot] as (SeatInfo | undefined)[],
    remote: { partner, opp },
    hidden: [] as string[],
    realOfLocal: identity,
    n: 4,
  };

  it('maps each remote stream to ITS seat (partner top, opponent side)', () => {
    const feeds = seatVideoFeedsFor(base);
    expect(feeds[0]).toBeNull(); // never my own seat
    expect(feeds[1]).toBe(partner);
    expect(feeds[2]).toBe(opp);
    expect(feeds[3]).toBeNull(); // bots never have video
  });

  it('spectators get nothing (no new spectator video surface)', () => {
    expect(seatVideoFeedsFor({ ...base, spectator: true })).toEqual([null, null, null, null]);
  });

  it('camera off, disconnected, hidden, or streamless seats stay empty', () => {
    const seats = [human('me'), human('partner', false), human('opp', true, false), human('fourth')] as (SeatInfo | undefined)[];
    expect(seatVideoFeedsFor({ ...base, seats, hidden: ['fourth'], remote: { partner, opp, fourth: fakeStream('fourth') } }))
      .toEqual([null, null, null, null]);
  });

  it('a rotated view maps by server seat, not by screen position', () => {
    // viewer is server seat 2: local 0 = server 2, local 1 = server 3, ...
    const rot = (l: number) => (l + 2) % 4;
    const seats = [human('a'), human('b'), human('me'), human('d')] as (SeatInfo | undefined)[];
    const sb = fakeStream('b');
    const feeds = seatVideoFeedsFor({ spectator: false, seats, remote: { b: sb }, hidden: [], realOfLocal: rot, n: 4 });
    // server seat 1 ('b') is local seat 3 in this rotation
    expect(feeds).toEqual([null, null, null, sb]);
  });
});

describe('the mapping: a feed lands at its own seat', () => {
  const positions: SeatPos[] = ['bottom', 'top', 'left', 'right'];

  it('assigns partner/opponent feeds to their chairs, never the human seat', () => {
    const partner = fakeStream('p');
    const left = fakeStream('l');
    const mine = fakeStream('me');
    const got = assignSeatVideos([mine, partner, left, null], positions, 4, 0);
    expect(got.map((a) => a.seat)).toEqual([1, 2]);
    expect(got[0]!.feed).toBe(partner);
    expect(got[1]!.feed).toBe(left);
  });

  it('spots are the seated-presence math: beyond the felt edge, crown clears the fan', () => {
    const top = seatVideoSpot('top', 4);
    expect(top.x).toBeCloseTo(0, 5);
    expect(top.z).toBeLessThan(-2.7); // felt edge −1.78 plus the top seat's 1.05 out
    expect(top.cy + SEAT_VIDEO.h / 2).toBeCloseTo(SEAT_VIDEO.crown, 5);
    const left = seatVideoSpot('left', 4);
    expect(left.x).toBeLessThan(-1.8);
    expect(left.z).toBeCloseTo(0, 5);
    const right = seatVideoSpot('right', 4);
    expect(right.x).toBeGreaterThan(1.8);
    // facing = toward the table centre
    expect(top.yaw).toBeCloseTo(Math.atan2(-top.x, -top.z), 10);
  });

  it('3-player side seats use their diagonal directions', () => {
    const left = seatVideoSpot('left', 3);
    expect(left.x).toBeLessThan(0);
    expect(left.z).toBeLessThan(0); // 3P sides sit on the far diagonal
  });
});

describe('the yaw: turned toward the camera, still seated', () => {
  it('clamps to maxYawRad from the facing', () => {
    const facing = Math.PI / 2; // left seat faces +x (table centre)
    const behind = facing + Math.PI; // a camera directly behind the chair
    expect(Math.abs(clampYawToFacing(facing, behind) - facing)).toBeCloseTo(SEAT_VIDEO.maxYawRad, 10);
    expect(clampYawToFacing(facing, facing + 0.3)).toBeCloseTo(facing + 0.3, 10);
  });

  it('from the real camera (on +Z), side seats end up near face-on', () => {
    const spot = seatVideoSpot('left', 4);
    const yaw = seatVideoYawAt(spot, 0, 3.5);
    const camYaw = Math.atan2(0 - spot.x, 3.5 - spot.z);
    expect(Math.abs(yaw - camYaw)).toBeLessThan(0.25); // residual after the clamp
    expect(Math.abs(yaw - spot.yaw)).toBeLessThanOrEqual(SEAT_VIDEO.maxYawRad + 1e-9);
  });
});

describe('the wiring (source pins)', () => {
  it('OnlineTable builds the feeds and hands them to the table + bubble', () => {
    const ot = src('src/online/OnlineTable.tsx');
    expect(ot).toContain('seatVideoFeedsFor({ spectator, seats: room.seats, remote: vs.remote, hidden: vs.hidden');
    expect(ot).toContain('seatVideos,');
    expect(ot).toContain('sceneVideo={!!seatVideos[local]}');
  });

  it('Table forwards them to the Scene; the Scene mounts the layer in the scene chunk', () => {
    const table = src('src/Table.tsx');
    expect(table).toContain('seatVideos?: (MediaStream | null)[]');
    expect(table).toContain('seatVideos={online?.seatVideos}');
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain("import SeatVideoLayer from './SeatVideo';");
    expect(scene).toContain('seatVideos?: readonly (MediaStream | null)[]');
    expect(scene).toContain('<SeatVideoLayer');
  });

  it('the layer uses the video-plane recipe and the frames gate', () => {
    const layer = src('src/three/SeatVideo.tsx');
    expect(layer).toContain('new VideoTexture(video)');
    expect(layer).toContain('generateMipmaps = false');
    expect(layer).toContain('minFilter = LinearFilter');
    expect(layer).toContain('trackLive(stream)');
    expect(layer).toContain('__bwmSeatVideo');
  });

  it('SeatMedia stands its bubble down while the scene carries the feed', () => {
    const media = src('src/online/Media.tsx');
    expect(media).toContain('sceneVideo = false');
    expect(media).toContain("const inScene = sceneVideo && camOn && !hidden && frames;");
    expect(media).toContain("' in-scene'");
    const css = src('src/online/online.css');
    expect(css).toContain('.vbubble.in-scene');
  });
});
