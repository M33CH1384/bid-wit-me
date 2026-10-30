/**
 * Seat-placed player video (owner directive 2026-10-30: "when users
 * turn their camera on the video feed should be placed in the seat
 * from which they are playing").
 *
 * Each remote seated human with a live camera gets a video plane
 * anchored at their chair in the 3D scene — placed by the King
 * table's seated-figure math (seatVideoLayout.ts), behind their card
 * fan, rising from behind the apron to a seated crown. The plane yaws
 * toward the camera within a clamp, so the face reads from the
 * player's seat while the presence stays seated. Because the plane
 * lives in scene space, the adjustable tilt/zoom camera carries it
 * with the seat automatically.
 *
 * The local player's own seat is never assigned (first person: that
 * plane would sit behind their own fan, out of the sightline — their
 * feed stays the mirrored plate bubble; every other viewer sees it
 * here, at the seat). Bot seats never carry video. Spectators never
 * receive these streams (the gates live in online/seatVideoFeeds.ts).
 *
 * Discipline follows the codebase's video-plane recipe (KingRail's
 * filmed visit): VideoTexture with SRGB colour space, NO mipmaps and
 * LinearFilter (NPOT frames sample black on some drivers otherwise).
 * A seat whose camera is off / track muted or ended shows NO plane —
 * the seat keeps today's plate treatment exactly, never a black hole.
 * The canvas is frameloop="demand": while any feed is showing, a
 * 50 ms ticker keeps frames flowing (the KingRail/PorchFigures
 * cadence); with no live feed the layer costs nothing per frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LinearFilter, PlaneGeometry, ShaderMaterial, SRGBColorSpace, VideoTexture, type Group, type Mesh } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { SeatPos } from './layout';
import { assignSeatVideos, seatVideoYawAt, type SeatVideoSpot } from './seatVideoLayout';

const QUAD = new PlaneGeometry(1, 1);

interface SeatVideoUniforms {
  uTex: { value: VideoTexture | null };
  uOpacity: { value: number };
  uCrop: { value: [number, number] };
  [key: string]: { value: unknown };
}

function seatVideoMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTex: { value: null },
      uOpacity: { value: 0 },
      // cover-crop factors (x, y): 1 = full frame on that axis
      uCrop: { value: [1, 1] },
    } as SeatVideoUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform float uOpacity;
      uniform vec2 uCrop;
      varying vec2 vUv;
      float sdRoundBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      void main() {
        vec2 uv = 0.5 + (vUv - 0.5) * uCrop;
        vec3 c = texture2D(uTex, uv).rgb;
        // plane-space rounded rect (plane is 0.58 x 0.78 world units)
        vec2 p = (vUv - 0.5) * vec2(0.58, 0.78);
        float d = sdRoundBox(p, vec2(0.29, 0.39), 0.055);
        float inside = 1.0 - smoothstep(-0.006, 0.006, d);
        // a thin warm border ring just inside the edge
        float ring = smoothstep(-0.030, -0.024, d) * inside;
        c = mix(c, vec3(0.30, 0.22, 0.10), ring * 0.85);
        // gentle melt toward the seat shadow at the bottom (the
        // portraits' dim discipline) — the face stays full strength
        float shade = mix(0.62, 1.0, smoothstep(0.0, 0.38, vUv.y));
        gl_FragColor = vec4(c * shade, uOpacity * inside);
      }`,
  });
}

function trackLive(stream: MediaStream): boolean {
  return stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
}

interface PlaneProps {
  seat: number;
  stream: MediaStream;
  spot: SeatVideoSpot;
  onLive: (seat: number, live: boolean) => void;
}

function SeatVideoPlane({ seat, stream, spot, onLive }: PlaneProps) {
  const group = useRef<Group>(null!);
  const mesh = useRef<Mesh>(null!);
  const opacity = useRef(0);
  const liveRef = useRef(false);
  const [live, setLive] = useState(false);

  const video = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    return v;
  }, []);

  const tex = useMemo(() => {
    if (!video) return null;
    const t = new VideoTexture(video);
    t.colorSpace = SRGBColorSpace;
    // the video-plane recipe: NPOT frames must not build a mip chain
    t.generateMipmaps = false;
    t.minFilter = LinearFilter;
    return t;
  }, [video]);

  const mat = useMemo(() => seatVideoMaterial(), []);
  useEffect(() => {
    (mat.uniforms as SeatVideoUniforms).uTex.value = tex;
    return () => { /* material disposed with the component below */ };
  }, [mat, tex]);
  useEffect(() => () => { mat.dispose(); tex?.dispose(); }, [mat, tex]);

  /* Bind the stream, keep it playing, and track whether real frames
   * are flowing (a connected-but-silent track must show no plane). */
  useEffect(() => {
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => { /* a later frame check retries via the ticker */ });
    const check = () => {
      const on = video.videoWidth > 0 && video.readyState >= 2 && trackLive(stream);
      // cover-crop uniforms from the real frame aspect
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const texAspect = video.videoWidth / video.videoHeight;
        const planeAspect = spot.w / spot.h;
        const crop: [number, number] = texAspect > planeAspect
          ? [planeAspect / texAspect, 1]
          : [1, texAspect / planeAspect];
        (mat.uniforms as SeatVideoUniforms).uCrop.value = crop;
      }
      if (on !== liveRef.current) { liveRef.current = on; setLive(on); onLive(seat, on); }
    };
    const evs = ['loadeddata', 'playing', 'resize', 'emptied', 'pause'] as const;
    evs.forEach((e) => video.addEventListener(e, check));
    const tracks = stream.getVideoTracks();
    tracks.forEach((t) => { t.addEventListener('mute', check); t.addEventListener('unmute', check); t.addEventListener('ended', check); });
    const iv = window.setInterval(check, 600);
    check();
    return () => {
      evs.forEach((e) => video.removeEventListener(e, check));
      tracks.forEach((t) => { t.removeEventListener('mute', check); t.removeEventListener('unmute', check); t.removeEventListener('ended', check); });
      window.clearInterval(iv);
      video.pause();
      video.srcObject = null;
      if (liveRef.current) { liveRef.current = false; onLive(seat, false); }
    };
  }, [video, stream, mat, spot.w, spot.h, seat, onLive]);

  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g) return;
    // yaw: ease toward the clamped camera-facing yaw for this seat
    const target = seatVideoYawAt(spot, camera.position.x, camera.position.z);
    let rel = target - g.rotation.y;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const k = Math.min(1, Math.max(0, dt) * 7);
    g.rotation.y += rel * k;
    // opacity: fade with the frames gate
    const want = liveRef.current ? 1 : 0;
    opacity.current += (want - opacity.current) * Math.min(1, Math.max(0, dt) * 6);
    if (opacity.current < 0.01 && want === 0) opacity.current = 0;
    (mat.uniforms as SeatVideoUniforms).uOpacity.value = opacity.current;
    if (mesh.current) mesh.current.visible = opacity.current > 0.01;
  });

  return (
    <group ref={group} position={[spot.x, 0, spot.z]} rotation={[0, spot.yaw, 0]}>
      <mesh ref={mesh} geometry={QUAD} material={mat} position={[0, spot.cy, 0]} scale={[spot.w, spot.h, 1]} renderOrder={4} visible={false} />
    </group>
  );
}

export interface SeatVideoLayerProps {
  /** per local seat: the stream that belongs in that seat, or null */
  seats: readonly (MediaStream | null)[];
  positions: readonly SeatPos[];
  n: number;
  /** the local player's seat index — never assigned a plane */
  human: number;
}

export default function SeatVideoLayer({ seats, positions, n, human }: SeatVideoLayerProps) {
  const invalidate = useThree((s) => s.invalidate);
  const assignments = useMemo(() => assignSeatVideos(seats, positions, n, human), [seats, positions, n, human]);
  const liveSeats = useRef(new Set<number>());
  const [, setLiveTick] = useState(0);

  const onLive = useMemo(() => (seat: number, on: boolean) => {
    if (on) liveSeats.current.add(seat); else liveSeats.current.delete(seat);
    const w = window as unknown as { __bwmSeatVideo?: { mounted: number[]; live: number[] } };
    w.__bwmSeatVideo = { mounted: assignments.map((a) => a.seat), live: [...liveSeats.current].sort((a, b) => a - b) };
    setLiveTick((x) => x + 1);
  }, [assignments]);

  useEffect(() => {
    const w = window as unknown as { __bwmSeatVideo?: { mounted: number[]; live: number[] } };
    w.__bwmSeatVideo = { mounted: assignments.map((a) => a.seat), live: [...liveSeats.current].sort((a, b) => a - b) };
    return () => { delete (window as unknown as { __bwmSeatVideo?: unknown }).__bwmSeatVideo; };
  }, [assignments]);

  /* Demand frameloop: keep frames flowing only while a feed shows. */
  const anyLive = liveSeats.current.size > 0;
  useEffect(() => {
    if (!anyLive) return;
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 50);
    return () => window.clearInterval(id);
  }, [anyLive, invalidate]);

  if (!assignments.length) return null;
  return (
    <>
      {assignments.map((a) => (
        <SeatVideoPlane key={a.seat} seat={a.seat} stream={a.feed} spot={a.spot} onLive={onLive} />
      ))}
    </>
  );
}
