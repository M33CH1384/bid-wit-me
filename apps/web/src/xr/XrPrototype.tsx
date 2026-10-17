/** THROWAWAY WebXR prototype (flag-gated: /?xr=1). Not part of the game.
 *  Goal (per docs/visionpro-vr-spike.md §6.4): enter immersive VR, sit at the table (Sitting view),
 *  look-and-pinch (or click, on desktop) plays one card with the normal slam flight.
 *  Honestly untested on real headsets — see PR body. Slam rules carry over: the play uses
 *  slamFeel(1) (Standing/max semantics, parabolic arc per #178). */
import { Suspense, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { XR, createXRStore, XROrigin } from '@react-three/xr';
import { Group, Vector3 } from 'three';
import { slamFeel } from '../slam';

const HAND = ['AS', 'KS', 'QS', 'JS', '10S', '9S', 'AH'];
const store = createXRStore({ handTracking: true });

type PlayAnim = { t: number; from: Vector3; to: Vector3; arc: number; dur: number } | null;

function ProtoCard({ i, id, played, onPlay }: { i: number; id: string; played: boolean; onPlay: (id: string) => void }) {
  const ref = useRef<Group>(null);
  const anim = useRef<PlayAnim>(null);
  const a = (i - (HAND.length - 1) / 2) * 0.16;
  const home = new Vector3(a, 0.86, 0.55 - Math.abs(i - 3) * 0.012);
  const spot = new Vector3(0, 0.765, -0.15);
  useFrame((state, dt) => {
    const g = ref.current; if (!g) return;
    if (played && !anim.current) { const f = slamFeel(1); anim.current = { t: 0, from: g.position.clone(), to: spot, arc: f.arc, dur: f.duration }; }
    const an = anim.current;
    if (an) {
      an.t = Math.min(1, an.t + dt / an.dur);
      g.position.lerpVectors(an.from, an.to, an.t);
      g.position.y += Math.sin(Math.PI * an.t) * an.arc * 0.35;
      g.rotation.x = -Math.PI / 2 + an.t * 0.5;
      if (an.t >= 1) anim.current = null;
    }
    // desktop-fallback test probe: screen coords of each unplayed card
    if (!state.gl.xr.isPresenting) {
      const w = window as unknown as { __bwmXrCards?: Record<string, { x: number; y: number }> };
      const v = g.position.clone().project(state.camera);
      ((w.__bwmXrCards ??= {}))[id] = { x: ((v.x + 1) / 2) * state.size.width, y: ((1 - v.y) / 2) * state.size.height };
    }
  });
  return (
    <group ref={ref} position={home} rotation={[-0.5, 0, (i - 3) * -0.06]}>
      <mesh onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPlay(id); }}>
        <boxGeometry args={[0.13, 0.185, 0.004]} />
        <meshStandardMaterial color={played ? '#ffe9b0' : '#f5f0e6'} />
      </mesh>
    </group>
  );
}

function ProtoScene({ played, onPlay }: { played: string | null; onPlay: (id: string) => void }) {
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[1, 3, 1]} intensity={1.2} />
      {/* table: felt top at seated height, player sitting at +z (Sitting view) */}
      <mesh position={[0, 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.7, 1.1]} />
        <meshStandardMaterial color="#0d6a45" />
      </mesh>
      <mesh position={[0, 0.755, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.16, 0.22]} />
        <meshStandardMaterial color="#0a5436" />
      </mesh>
      {HAND.map((id, i) => <ProtoCard key={id} i={i} id={id} played={played === id} onPlay={onPlay} />)}
      <XROrigin position={[0, 0, 0.95]} />
    </>
  );
}

export default function XrPrototype() {
  const [played, setPlayed] = useState<string | null>(null);
  const [support, setSupport] = useState<string>('checking…');
  const play = (id: string) => {
    setPlayed(id);
    (window as unknown as { __bwmXr?: unknown }).__bwmXr = { played: id, slam: 'standing-max (slamFeel(1))' };
  };
  const check = async () => {
    try {
      const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
      setSupport(xr ? (await xr.isSessionSupported('immersive-vr')) ? 'immersive-vr supported — Enter VR should work on this headset/browser' : 'WebXR present, immersive-vr NOT supported here' : 'no navigator.xr (desktop fallback below)');
    } catch { setSupport('support check failed'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0c0712', color: '#ffe9b0', fontFamily: 'system-ui' }}>
      <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', zIndex: 2, position: 'relative' }}>
        <b>XR prototype (throwaway, ?xr=1)</b>
        <button type="button" onClick={() => { void check(); void store.enterVR(); }}>Enter VR</button>
        <button type="button" onClick={() => { location.href = '/'; }}>Back to game</button>
        <span style={{ fontSize: 12, opacity: 0.85 }}>{support}</span>
        <span style={{ fontSize: 12 }}>{played ? `Played ${played} (max slam)` : 'Pinch/click a hand card to play it'}</span>
      </div>
      <Canvas camera={{ position: [0, 1.35, 1.15], fov: 55, near: 0.05, far: 30 }} gl={{ antialias: true }}>
        <XR store={store}>
          <Suspense fallback={null}>
            <ProtoScene played={played} onPlay={play} />
          </Suspense>
        </XR>
      </Canvas>
    </div>
  );
}
