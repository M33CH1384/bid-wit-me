/** THROWAWAY WebXR prototype (flag-gated: /?xr=1). Not part of the game.
 *  Goal (per docs/visionpro-vr-spike.md §6.4): enter immersive VR, sit at the table (Sitting view),
 *  look-and-pinch (or click, on desktop) plays one card, which lands FLAT on the felt
 *  (xrPlayedRest -> the 2D game's flatRest). Honestly untested on real headsets — see PR body.
 *  Sitting is the default, and a default play is GENTLE (XR_DEFAULT_INTENSITY): slam only via a
 *  V/flick-equivalent gesture per the spike mapping, never max by default.
 *  Known gap: no slam gesture in this prototype yet — pinch/click is gentle only.
 *
 *  Vision Pro black-screen fix (Oct 2026): the @react-three/xr defaults required
 *  'local-floor', attached a DOM overlay, and let three await that single reference
 *  space with no fallback — a recipe for a silent black void on visionOS Safari.
 *  This page now requests nothing as required (see ./session.ts), picks the best
 *  granted reference space at runtime, renders a visible room even before tracking
 *  is good, and logs every step to the status panel below (read it after exiting
 *  the headset — DOM is not visible in immersive VR without a DOM overlay). */
import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { XR, createXRStore, XROrigin } from '@react-three/xr';
import { Group, Quaternion, Vector3 } from 'three';
import { noteDiag } from '../diagnostics';
import { slamFeel } from '../slam';
import { XR_DEFAULT_INTENSITY, xrPlayedRest } from './restPose';
import {
  appendXrLog, buildVisionSafeSessionInit, describeXrError, originYOffset,
  pickReferenceSpace, type XrPhase,
} from './session';

const HAND = ['AS', 'KS', 'QS', 'JS', '10S', '9S', 'AH'];
const store = createXRStore({
  customSessionInit: buildVisionSafeSessionInit(),
  // frameRate:'high' (the library default) can reject enterVR() on Safari via
  // updateTargetFrameRate — leave the device's default rate alone.
  frameRate: false,
  offerSession: false,
  enterGrantedSession: false,
  emulate: false,
});

type PlayAnim = { t: number; from: Vector3; to: Vector3; fromQ: Quaternion; toQ: Quaternion; arc: number; dur: number } | null;

type GuardProps = {
  onLog: (line: string) => void;
  onPhase: (phase: XrPhase) => void;
  onRefSpace: (type: string | null) => void;
};

/** Inside-Canvas XR plumbing: safe reference space + first-frame proof. */
function XrSessionGuard({ onLog, onPhase, onRefSpace }: GuardProps) {
  const gl = useThree((s) => s.gl);
  const firstFrame = useRef(false);
  const handled = useRef<unknown>(null);
  const refType = useRef<string | null>(null);

  // three's manager is told 'local-floor' by @react-three/xr at mount and would
  // await exactly that space at session start. Re-assert the universally
  // available 'local' every non-presenting frame (last writer before Enter wins);
  // the granted floor space, when available, is layered on via setReferenceSpace.
  useFrame((state) => {
    const xr = state.gl.xr;
    if (!xr.isPresenting) {
      try { xr.setReferenceSpaceType('local'); } catch { /* best effort */ }
      return;
    }
    if (!firstFrame.current) {
      firstFrame.current = true;
      onPhase('first-frame');
      onLog(`first XR frame rendered while presenting (reference space: ${refType.current ?? "three's local fallback"}) — the table scene should now be visible`);
      (window as unknown as { __bwmXrFirstFrame?: boolean }).__bwmXrFirstFrame = true;
    }
  });

  useEffect(() => {
    const unsub = store.subscribe((state) => {
      const session = state.session as unknown as (XRSession & { enabledFeatures?: Iterable<string> }) | undefined;
      if (!session || handled.current === session) return;
      handled.current = session;
      firstFrame.current = false;
      onPhase('presenting');
      let enabled: string[] = [];
      try { enabled = session.enabledFeatures ? [...session.enabledFeatures] : []; } catch { /* opaque on some browsers */ }
      onLog(`session granted (mode=${state.mode ?? 'immersive-vr'}, enabledFeatures=[${enabled.join(', ') || 'not reported'}], visibility=${session.visibilityState ?? '?'})`);
      const onEnd = () => {
        onLog('session ended — status panel above is the full log; the 2D scene should be back');
        onPhase('ended');
        onRefSpace(null);
        refType.current = null;
        handled.current = null;
        try { (gl.xr as unknown as { setReferenceSpace(s: unknown): void }).setReferenceSpace(null); } catch { /* stale custom space is dropped with the session anyway */ }
      };
      session.addEventListener('end', onEnd);
      session.addEventListener('visibilitychange', () => onLog(`session visibility -> ${session.visibilityState ?? '?'}`));
      void pickReferenceSpace(
        session,
        (space, type) => {
          (gl.xr as unknown as { setReferenceSpace(s: unknown): void }).setReferenceSpace(space);
          refType.current = type;
          onRefSpace(type);
          onLog(`reference space granted: ${type}${type === 'local-floor' ? ' (floor-anchored)' : ' (origin lifted to seated eye height, estimate)'}`);
        },
        (type, reason) => onLog(`reference space ${type} skipped: ${reason}`),
      ).then((picked) => {
        if (!picked) {
          refType.current = null;
          onRefSpace(null);
          onLog("no chain reference space granted — keeping three's internal 'local' space (pose may still render; table height is unconfirmed)");
          noteDiag('xr', 'no reference space from fallback chain');
        }
      }).catch((e: unknown) => onLog(`reference-space pick failed: ${describeXrError(e)}`));
    });
    return unsub;
  }, [gl, onLog, onPhase, onRefSpace]);

  return null;
}

function ProtoCard({ i, id, played, onPlay }: { i: number; id: string; played: boolean; onPlay: (id: string) => void }) {
  const ref = useRef<Group>(null);
  const anim = useRef<PlayAnim>(null);
  const a = (i - (HAND.length - 1) / 2) * 0.16;
  const home = new Vector3(a, 0.86, 0.55 - Math.abs(i - 3) * 0.012);
  const rest = xrPlayedRest();
  const spot = new Vector3(...rest.position);
  useFrame((state, dt) => {
    const g = ref.current; if (!g) return;
    if (played && !anim.current) { const f = slamFeel(XR_DEFAULT_INTENSITY); anim.current = { t: 0, from: g.position.clone(), to: spot, fromQ: g.quaternion.clone(), toQ: new Quaternion(...rest.quaternion), arc: f.arc, dur: f.duration }; }
    const an = anim.current;
    if (an) {
      an.t = Math.min(1, an.t + dt / an.dur);
      g.position.lerpVectors(an.from, an.to, an.t);
      g.position.y += Math.sin(Math.PI * an.t) * an.arc * 0.35;
      g.quaternion.slerpQuaternions(an.fromQ, an.toQ, an.t); // ends exactly flat (0deg tilt)
      if (an.t >= 1) { g.position.copy(an.to); g.quaternion.copy(an.toQ); anim.current = null; }
    }
    // desktop-fallback test probe: screen coords of each unplayed card
    if (!state.gl.xr.isPresenting) {
      const w = window as unknown as { __bwmXrCards?: Record<string, { x: number; y: number }> };
      const v = g.position.clone().project(state.camera);
      const rect = state.gl.domElement.getBoundingClientRect();
      ((w.__bwmXrCards ??= {}))[id] = { x: rect.left + ((v.x + 1) / 2) * state.size.width, y: rect.top + ((1 - v.y) / 2) * state.size.height };
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

function ProtoScene({ played, onPlay, refSpace, guard }: { played: string | null; onPlay: (id: string) => void; refSpace: string | null; guard: GuardProps }) {
  return (
    <>
      {/* A visible room, never a black void: even with a rough first pose the user
          should see blue walls/floor around the green table. */}
      <color attach="background" args={['#182c46']} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#cfe6ff', '#1c2b1a', 0.7]} />
      <directionalLight position={[1, 3, 1]} intensity={1.2} />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#101c2e" />
      </mesh>
      <mesh position={[0, 1.6, -2.2]}>
        <planeGeometry args={[7, 3.2]} />
        <meshStandardMaterial color="#2b4a73" />
      </mesh>
      <mesh position={[-1.8, 1.2, -1.4]}>
        <boxGeometry args={[0.18, 2.4, 0.18]} />
        <meshStandardMaterial color="#e8a33d" />
      </mesh>
      <mesh position={[1.8, 1.2, -1.4]}>
        <boxGeometry args={[0.18, 2.4, 0.18]} />
        <meshStandardMaterial color="#3fae7a" />
      </mesh>
      {/* table: felt top at seated height, player sitting at +z (Sitting view) */}
      <mesh position={[0, 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.7, 1.1]} />
        <meshStandardMaterial color="#0d6a45" />
      </mesh>
      {/* No floating drop pad: an earlier pad hovered above the felt and hid the landed card. */}
      {HAND.map((id, i) => <ProtoCard key={id} i={i} id={id} played={played === id} onPlay={onPlay} />)}
      <XROrigin position={[0, originYOffset(refSpace), 0.95]} />
      <XrSessionGuard {...guard} />
    </>
  );
}

export default function XrPrototype() {
  const [played, setPlayed] = useState<string | null>(null);
  const [phase, setPhase] = useState<XrPhase>('boot');
  const [refSpace, setRefSpace] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const linesRef = useRef<string[]>([]);
  const log = (line: string) => {
    linesRef.current = appendXrLog(linesRef.current, line);
    setLines(linesRef.current);
  };
  // stable-ish callbacks for the guard (refs keep identity simple)
  const logRef = useRef(log); logRef.current = log;
  const guard: GuardProps = {
    onLog: (l) => logRef.current(l),
    onPhase: (p) => setPhase(p),
    onRefSpace: (t) => setRefSpace(t),
  };

  const play = (id: string) => {
    setPlayed(id);
    (window as unknown as { __bwmXr?: unknown }).__bwmXr = { played: id, intensity: XR_DEFAULT_INTENSITY, view: 'sitting' };
  };

  // Boot diagnostics: everything the next headset test needs, before any gesture.
  useEffect(() => {
    log('XR page boot — render loop is R3F/three setAnimationLoop (XR session RAF while presenting), renderer.xr enabled by <XR>');
    log(`userAgent: ${navigator.userAgent}`);
    log(`secureContext=${window.isSecureContext} location=${location.origin}${location.pathname}`);
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) {
      setPhase('no-xr');
      log('navigator.xr is ABSENT — WebXR unavailable in this browser; showing the 2D fallback scene (click a card). On Vision Pro this means Safari/WebXR did not expose XR here.');
      noteDiag('xr', 'navigator.xr absent');
      return;
    }
    setPhase('checking');
    log('navigator.xr present — checking immersive-vr support…');
    xr.isSessionSupported('immersive-vr').then((ok) => {
      if (ok) { setPhase('ready'); log('immersive-vr SUPPORTED — tap Enter VR (session is requested with NO required features; local-floor/local/viewer are optional)'); }
      else { setPhase('unsupported'); log('immersive-vr NOT supported in this browser — 2D fallback scene below; Enter VR is disabled'); noteDiag('xr', 'immersive-vr unsupported'); }
    }).catch((e: unknown) => {
      setPhase('error');
      log(`isSessionSupported('immersive-vr') threw: ${describeXrError(e)}`);
      noteDiag('xr', `isSessionSupported threw ${describeXrError(e)}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (window as unknown as { __bwmXrStatus?: unknown }).__bwmXrStatus = { phase, refSpace, lines: linesRef.current };
  }, [phase, refSpace, lines]);

  const enter = () => {
    // requestSession must stay inside the tap: enterVR() is called synchronously
    // here, with no awaited support check in between.
    log('Enter VR tapped — requesting immersive-vr session now (optionalFeatures only, no required features, no DOM overlay)…');
    setPhase('requesting');
    store.enterVR().then((session) => {
      log(session ? 'requestSession resolved — session object handed to three (watch for "session granted" + "first XR frame" lines)' : 'requestSession resolved without a session (unexpected)');
    }).catch((e: unknown) => {
      setPhase('error');
      log(`requestSession / session setup FAILED: ${describeXrError(e)} — you should still be on this 2D page; screenshot this panel`);
      noteDiag('xr', `enterVR failed ${describeXrError(e)}`);
    });
  };

  const canEnter = phase === 'ready' || phase === 'ended' || phase === 'error';
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0c0712', color: '#ffe9b0', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', zIndex: 2, position: 'relative' }}>
        <b>XR prototype (throwaway, ?xr=1)</b>
        <button type="button" onClick={enter} disabled={!canEnter}>Enter VR</button>
        <button type="button" onClick={() => { void store.getState().session?.end().catch(() => {}); }}>Exit VR</button>
        <button type="button" onClick={() => { location.href = '/'; }}>Back to game</button>
        <span data-testid="xr-phase" style={{ fontSize: 12, border: '1px solid #ffe9b0', borderRadius: 999, padding: '2px 8px' }}>status: {phase}{refSpace ? ` · space: ${refSpace}` : ''}</span>
        <span style={{ fontSize: 12 }}>{played ? `Played ${played} (gentle, flat landing)` : 'Pinch/click a hand card to play it'}</span>
      </div>
      <div data-testid="xr-status" style={{ zIndex: 2, position: 'relative', margin: '0 12px', padding: '8px 10px', background: '#141d2e', border: '1px solid #35507a', borderRadius: 8, fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5, maxHeight: 168, overflowY: 'auto' }}>
        <div style={{ opacity: 0.85, marginBottom: 4 }}>XR status log — if the headset shows black, exit VR (Digital Crown) and screenshot THIS panel:</div>
        {lines.length === 0 ? <div>starting…</div> : lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {(phase === 'no-xr' || phase === 'unsupported') && (
        <div style={{ margin: '8px 12px 0', fontSize: 12, color: '#ffd28a' }}>WebXR immersive VR is not available here, so this is the 2D fallback: the same table scene renders below and cards are clickable. Use a headset browser (visionOS Safari / Quest Browser) for immersive VR.</div>
      )}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <Canvas
          camera={{ position: [0, 1.35, 1.15], fov: 55, near: 0.05, far: 40 }}
          gl={{ antialias: true, alpha: false, xrCompatible: true }}
          onCreated={({ gl }) => {
            try { log(`WebGL renderer created (context xrCompatible attribute: ${String(gl.getContextAttributes()?.xrCompatible ?? 'not reported')})`); } catch { log('WebGL renderer created'); }
          }}
        >
          <XR store={store}>
            <Suspense fallback={null}>
              <ProtoScene played={played} onPlay={play} refSpace={refSpace} guard={guard} />
            </Suspense>
          </XR>
        </Canvas>
      </div>
    </div>
  );
}
