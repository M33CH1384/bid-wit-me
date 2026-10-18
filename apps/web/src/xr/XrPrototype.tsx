/** THROWAWAY WebXR prototype (/xr.html). Not part of the game.
 *  Goal (docs/visionpro-vr-spike.md): enter immersive VR, sit at the table, look-and-pinch
 *  (or click, on desktop) plays one card, which lands FLAT on the felt. Gentle by default.
 *
 *  Round 2 (Oct 2026, after #234 still gave a fully black headset on a real Vision Pro):
 *  @react-three/xr is GONE from this page. It re-asserted 'local-floor' as three's
 *  reference-space type behind our back, and three r180's WebXRManager.setSession()
 *  does `await session.requestReferenceSpace(type)` with no catch - if that type was
 *  not granted, setSession rejects after the headset is already immersive, the XR
 *  animation loop never starts, and the user stares at black forever. three also
 *  hardcodes XRWebGLLayer alpha:true, ignoring the canvas alpha attribute.
 *  This page now drives plain three directly:
 *   - requestSession is the first call in the tap handler (no awaits before it);
 *   - the granted session's enabledFeatures are inspected and three is handed only a
 *     reference-space type already verified grantable on that session;
 *   - setSession failures are caught, logged, and the session is ended back to 2D;
 *   - the room is anchored to the first real XR eye pose, so the table is in front of
 *     the user whatever space was granted (local-floor / local / viewer);
 *   - frame count + baseLayer size are logged; if no XR frame arrives in 3s the log
 *     says so plainly instead of implying success;
 *   - the status log PERSISTS (localStorage), the last outcome sits at the TOP of the
 *     2D page, and there is a Copy log button - one screenshot after exiting captures it.
 *  Card faces are real drawn textures here (round 1 cards were blank white boxes -
 *  by design then, fixed now). Still honestly untested on a headset from the dev
 *  side; the retry steps in the PR say exactly what the next device test proves. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AmbientLight, BoxGeometry, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster, Scene,
  Vector2, Vector3, WebGLRenderer,
} from 'three';
import { noteDiag } from '../diagnostics';
import { slamFeel } from '../slam';
import { XR_DEFAULT_INTENSITY, xrPlayedRest } from './restPose';
import {
  anchorGroupForEye, appendXrLog, buildVisionSafeSessionInit, checkImmersiveSupport,
  chooseGrantedReferenceType, describeBaseLayer, describeXrError, loadPersistedXrLog,
  pickReferenceSpace, savePersistedXrLog, yawFromForward, type XrPhase, type XrReferenceSpaceType,
} from './session';

const HAND = ['AS', 'KS', 'QS', 'JS', '10S', '9S', 'AH'];
const SUITS: Record<string, { sym: string; red: boolean }> = {
  S: { sym: '♠', red: false }, H: { sym: '♥', red: true }, D: { sym: '♦', red: true }, C: { sym: '♣', red: false },
};

function cardFaceTexture(id: string): CanvasTexture {
  const rank = id.slice(0, -1), suit = SUITS[id.slice(-1)] ?? SUITS.S!;
  const c = document.createElement('canvas'); c.width = 256; c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fdfaf2'; g.fillRect(0, 0, 256, 360);
  g.strokeStyle = '#c9c2b0'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 352);
  g.fillStyle = suit.red ? '#c0273a' : '#17233c';
  g.font = 'bold 64px system-ui'; g.textAlign = 'left'; g.fillText(rank, 18, 72);
  g.font = '56px system-ui'; g.fillText(suit.sym, 20, 132);
  g.font = '120px system-ui'; g.textAlign = 'center'; g.fillText(suit.sym, 128, 245);
  const t = new CanvasTexture(c); t.anisotropy = 4; return t;
}

function cardBackTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = '#274b8f'; g.fillRect(0, 0, 256, 360);
  g.strokeStyle = '#dfe9ff'; g.lineWidth = 10; g.strokeRect(14, 14, 228, 332);
  g.fillStyle = '#dfe9ff'; g.font = 'bold 44px system-ui'; g.textAlign = 'center'; g.fillText('BWM', 128, 195);
  return new CanvasTexture(c);
}

interface CardRt {
  id: string; group: Group; mesh: Mesh;
  anim: { t: number; from: Vector3; to: Vector3; fromQ: Quaternion; toQ: Quaternion; arc: number; dur: number } | null;
}

interface Rt {
  renderer: WebGLRenderer; room: Group; cards: CardRt[];
  session: XRSession | null; frames: number; presentingSince: number;
  anchored: boolean; pendingSelect: boolean; noFrameTimer: ReturnType<typeof setTimeout> | null;
  play: (id: string, via: string) => void; enter: () => void; exit: () => void;
}

export default function XrPrototype() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rtRef = useRef<Rt | null>(null);
  const [played, setPlayed] = useState<string | null>(null);
  const [phase, setPhase] = useState<XrPhase>('boot');
  const [lines, setLines] = useState<string[]>(() => loadPersistedXrLog(typeof localStorage !== 'undefined' ? localStorage : null));
  const linesRef = useRef(lines);
  const [copyNote, setCopyNote] = useState('');

  const log = useCallback((line: string) => {
    linesRef.current = appendXrLog(linesRef.current, line);
    setLines(linesRef.current);
    savePersistedXrLog(typeof localStorage !== 'undefined' ? localStorage : null, linesRef.current);
  }, []);

  useEffect(() => {
    (window as unknown as { __bwmXrStatus?: unknown }).__bwmXrStatus = { phase, lines: linesRef.current };
  }, [phase, lines]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    let disposed = false;
    if (linesRef.current.length) log('— new page load; the log above was restored from the previous session (it persists) —');
    log('XR page boot — round 2: plain-three WebXR driver (no @react-three/xr), room anchored to the first eye pose');
    log(`userAgent: ${navigator.userAgent}`);
    log(`secureContext=${window.isSecureContext} location=${location.origin}${location.pathname}`);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(new Color('#182c46'), 1);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local'); // safe default; enter() re-sets the verified granted type
    mount.appendChild(renderer.domElement);
    try {
      const at = renderer.getContext().getContextAttributes();
      log(`WebGL renderer created (xrCompatible=${String(at?.xrCompatible ?? 'n/a')}, alpha=${String(at?.alpha ?? 'n/a')}, antialias=${String(at?.antialias ?? 'n/a')}); three hardcodes XRWebGLLayer alpha:true, so the scene background is opaque`);
    } catch { log('WebGL renderer created'); }

    const scene = new Scene();
    scene.background = new Color('#182c46');
    const camera = new PerspectiveCamera(60, Math.max(1, mount.clientWidth / Math.max(1, mount.clientHeight)), 0.01, 100);
    camera.position.set(0, 1.55, 1.55);
    camera.lookAt(0, 0.72, -0.1);
    scene.add(camera);

    const room = new Group(); scene.add(room);
    const mat = (color: string) => new MeshStandardMaterial({ color });
    scene.add(new AmbientLight('#ffffff', 0.9));
    scene.add(new HemisphereLight('#cfe6ff', '#1c2b1a', 0.7));
    const sun = new DirectionalLight('#ffffff', 1.2); sun.position.set(1, 3, 1); scene.add(sun);
    // A visible room, never a black void: blue walls/floor around the green table.
    const floor = new Mesh(new PlaneGeometry(24, 24), mat('#101c2e')); floor.rotation.x = -Math.PI / 2; room.add(floor);
    const wall = new Mesh(new PlaneGeometry(7, 3.2), mat('#2b4a73')); wall.position.set(0, 1.6, -2.2); room.add(wall);
    const pillarL = new Mesh(new BoxGeometry(0.18, 2.4, 0.18), mat('#e8a33d')); pillarL.position.set(-1.8, 1.2, -1.4); room.add(pillarL);
    const pillarR = new Mesh(new BoxGeometry(0.18, 2.4, 0.18), mat('#3fae7a')); pillarR.position.set(1.8, 1.2, -1.4); room.add(pillarR);
    const table = new Mesh(new PlaneGeometry(1.7, 1.1), mat('#0d6a45')); table.rotation.x = -Math.PI / 2; table.position.set(0, 0.72, 0); room.add(table);

    const rest = xrPlayedRest();
    const restPos = new Vector3(...rest.position);
    const restQ = new Quaternion(...rest.quaternion);
    const backTex = cardBackTexture();
    const cards: CardRt[] = HAND.map((id, i) => {
      const a = (i - (HAND.length - 1) / 2) * 0.16;
      const group = new Group();
      group.position.set(a, 0.86, 0.55 - Math.abs(i - 3) * 0.012);
      group.rotation.set(-0.5, 0, (i - 3) * -0.06);
      const edge = mat('#e9e2cf');
      const front = new MeshStandardMaterial({ map: cardFaceTexture(id) });
      const back = new MeshStandardMaterial({ map: backTex });
      const mesh = new Mesh(new BoxGeometry(0.13, 0.185, 0.004), [edge, edge, edge, edge, front, back]);
      mesh.userData.cardId = id;
      group.add(mesh); room.add(group);
      return { id, group, mesh, anim: null };
    });

    const rt: Rt = {
      renderer, room, cards, session: null, frames: 0, presentingSince: 0,
      anchored: false, pendingSelect: false, noFrameTimer: null,
      play: () => {}, enter: () => {}, exit: () => {},
    };
    rtRef.current = rt;

    rt.play = (id, via) => {
      const card = cards.find((c) => c.id === id); if (!card || card.anim) return;
      const f = slamFeel(XR_DEFAULT_INTENSITY);
      card.anim = { t: 0, from: card.group.position.clone(), to: restPos.clone(), fromQ: card.group.quaternion.clone(), toQ: restQ.clone(), arc: f.arc, dur: f.duration };
      setPlayed(id);
      (window as unknown as { __bwmXr?: unknown }).__bwmXr = { played: id, intensity: XR_DEFAULT_INTENSITY, view: 'sitting' };
      log(`played ${id} via ${via} (gentle, flat landing)`);
    };

    rt.exit = () => { void rt.session?.end().catch(() => {}); };

    rt.enter = () => {
      const xrSys = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (!xrSys) { setPhase('no-xr'); log('Enter VR tapped but navigator.xr is absent — cannot request a session'); return; }
      // requestSession FIRST, synchronously inside the tap: nothing is awaited before this line.
      const sessionPromise = xrSys.requestSession('immersive-vr', buildVisionSafeSessionInit());
      log('Enter VR tapped — requestSession called synchronously in the tap (optionalFeatures only, no required, no DOM overlay)…');
      setPhase('requesting');
      void (async () => {
        let session: XRSession;
        try { session = await sessionPromise; } catch (e) {
          setPhase('error'); log(`requestSession FAILED: ${describeXrError(e)} — you should still be on this 2D page`); noteDiag('xr', `requestSession failed ${describeXrError(e)}`); return;
        }
        rt.session = session;
        let enabled: string[] = [];
        try { enabled = session.enabledFeatures ? [...session.enabledFeatures] : []; } catch { /* opaque on some browsers */ }
        log(`session granted (enabledFeatures=[${enabled.join(', ') || 'not reported'}], visibility=${session.visibilityState ?? '?'})`);
        // Hand three ONLY a reference-space type verified grantable on THIS session:
        // three's setSession awaits requestReferenceSpace(type) with no catch, so a
        // wrong type = immersive black forever (the round-1 failure mode).
        let chosen: XrReferenceSpaceType | null = chooseGrantedReferenceType(enabled.length ? enabled : null);
        if (chosen) {
          try { await session.requestReferenceSpace(chosen); log(`reference space pre-verified: ${chosen}`); }
          catch (e) { log(`pre-verify of ${chosen} failed (${describeXrError(e)}) — probing the chain`); chosen = null; }
        }
        if (!chosen) {
          chosen = await pickReferenceSpace(session as never, () => {}, (t, r) => log(`reference space ${t} skipped: ${r}`));
          if (chosen) log(`reference space granted by probe: ${chosen}`);
        }
        if (!chosen) { chosen = 'viewer'; log('no chain space granted — falling back to viewer (should always exist); three will use it'); }
        renderer.xr.setReferenceSpaceType(chosen);
        session.addEventListener('select', () => { rt.pendingSelect = true; });
        session.addEventListener('visibilitychange', () => log(`session visibility -> ${session.visibilityState ?? '?'}`));
        session.addEventListener('end', () => {
          if (rt.noFrameTimer) clearTimeout(rt.noFrameTimer);
          rt.session = null; rt.anchored = false; rt.frames = 0;
          room.position.set(0, 0, 0); room.quaternion.identity();
          setPhase('ended');
          log('session ENDED — the outcome box at the TOP of this page is the persistent record; screenshot it or tap Copy log');
        });
        try {
          await renderer.xr.setSession(session);
        } catch (e) {
          setPhase('error');
          log(`three setSession FAILED: ${describeXrError(e)} — ending the session back to 2D (this error was invisible/black in round 1)`);
          noteDiag('xr', `setSession failed ${describeXrError(e)}`);
          try { await session.end(); } catch { /* already gone */ }
          return;
        }
        rt.presentingSince = performance.now(); rt.frames = 0; rt.anchored = false;
        setPhase('presenting');
        log(`three setSession OK — baseLayer: ${describeBaseLayer(session as never)}; referenceSpaceType=${chosen}; waiting for XR frames…`);
        rt.noFrameTimer = setTimeout(() => {
          if (rt.session === session && rt.frames === 0) {
            setPhase('error');
            log('NO XR FRAME arrived within 3s of a granted session — the headset would show black. This is the present-path failure; screenshot this page');
            noteDiag('xr', 'session granted but no XR frames in 3s');
          }
        }, 3000);
      })();
    };

    // Support check with a deadline: a hung promise must not stick at "Checking...".
    const xrSys = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xrSys) {
      setPhase('no-xr');
      log('navigator.xr is ABSENT — WebXR unavailable in this browser; showing the 2D fallback scene (click a card)');
      noteDiag('xr', 'navigator.xr absent');
    } else {
      setPhase('checking');
      log('navigator.xr present — checking immersive-vr support (3.5s deadline)…');
      void checkImmersiveSupport(xrSys).then((outcome) => {
        if (disposed) return;
        if (outcome === 'supported') { setPhase('ready'); log('immersive-vr SUPPORTED — tap Enter VR'); }
        else if (outcome === 'unsupported') { setPhase('unsupported'); log('immersive-vr NOT supported here — 2D fallback below; Enter VR disabled'); noteDiag('xr', 'immersive-vr unsupported'); }
        else if (outcome === 'timeout') { setPhase('ready'); log('support check TIMED OUT (was stuck at Checking in round 1) — Enter VR is enabled anyway; the tap-time requestSession will decide'); }
        else { setPhase('ready'); log('support check threw — Enter VR enabled anyway; the tap-time requestSession will decide'); }
      });
    }

    const raycaster = new Raycaster();
    const onPointer = (ev: PointerEvent) => {
      if (renderer.xr.isPresenting) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(cards.map((c) => c.mesh), false)[0];
      if (hit) rt.play(hit.object.userData.cardId as string, 'click');
    };
    renderer.domElement.addEventListener('pointerdown', onPointer);

    const onResize = () => {
      const w = mount.clientWidth, h = Math.max(1, mount.clientHeight);
      if (!renderer.xr.isPresenting) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', onResize);

    const clockStart = performance.now();
    let last = clockStart;
    const eye = new Vector3(); const fwd = new Vector3();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      // played-card animation (same in 2D and XR: one scene, one canvas)
      for (const card of cards) {
        const an = card.anim; if (!an) continue;
        an.t = Math.min(1, an.t + dt / an.dur);
        card.group.position.lerpVectors(an.from, an.to, an.t);
        card.group.position.y += Math.sin(Math.PI * an.t) * an.arc * 0.35;
        card.group.quaternion.slerpQuaternions(an.fromQ, an.toQ, an.t);
        if (an.t >= 1) { card.group.position.copy(an.to); card.group.quaternion.copy(an.toQ); card.anim = null; }
      }
      const presenting = renderer.xr.isPresenting;
      if (presenting) {
        rt.frames++;
        if (rt.frames === 1) {
          setPhase('first-frame');
          (window as unknown as { __bwmXrFirstFrame?: boolean }).__bwmXrFirstFrame = true;
          log(`first XR frame rendered — baseLayer: ${describeBaseLayer(rt.session as never)}; anchoring the room to your eye pose now`);
        }
        // gaze pinch: play the card nearest the centre of view (or the centre card)
        if (rt.pendingSelect) {
          rt.pendingSelect = false;
          const xrCam = renderer.xr.getCamera();
          xrCam.getWorldDirection(fwd);
          raycaster.set(xrCam.getWorldPosition(eye), fwd);
          const hit = raycaster.intersectObjects(cards.filter((c) => !c.anim).map((c) => c.mesh), false)[0];
          rt.play(hit ? (hit.object.userData.cardId as string) : (cards.find((c) => !c.anim)?.id ?? 'QS'), hit ? 'pinch-gaze' : 'pinch (no card in gaze; centre card)');
        }
      } else {
        // desktop probe: screen coords of each card
        const w = window as unknown as { __bwmXrCards?: Record<string, { x: number; y: number }> };
        const rect = renderer.domElement.getBoundingClientRect();
        for (const card of cards) {
          const v = card.group.getWorldPosition(new Vector3()).project(camera);
          ((w.__bwmXrCards ??= {}))[card.id] = { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
        }
      }
      renderer.render(scene, camera);
      // Anchor AFTER a render, when the XR camera carries a real pose: put the
      // designed seat exactly under the user's eyes, facing the table, whatever
      // reference space was granted. One correction, then it stays put.
      if (presenting && !rt.anchored && rt.frames >= 1) {
        const xrCam = renderer.xr.getCamera();
        xrCam.getWorldPosition(eye);
        xrCam.getWorldDirection(fwd);
        if (Number.isFinite(eye.x) && Number.isFinite(fwd.x)) {
          const yaw = yawFromForward(fwd.x, fwd.z);
          const pos = anchorGroupForEye({ x: eye.x, y: eye.y, z: eye.z }, yaw);
          room.position.set(pos.x, pos.y, pos.z);
          room.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
          rt.anchored = true;
          log(`room anchored to eye pose (eye=${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)} yaw=${(yaw * 180 / Math.PI).toFixed(0)}deg, near=${camera.near} far=${camera.far}) — table should be right in front of you`);
        }
      }
    });

    return () => {
      disposed = true;
      if (rt.noFrameTimer) clearTimeout(rt.noFrameTimer);
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onResize);
      void rt.session?.end().catch(() => {});
      renderer.dispose();
      renderer.domElement.remove();
      if (rtRef.current === rt) rtRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canEnter = phase === 'ready' || phase === 'ended' || phase === 'error';
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0c0712', color: '#ffe9b0', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div data-testid="xr-outcome" style={{ zIndex: 3, margin: '10px 12px 0', padding: '10px 12px', background: '#1b2a44', border: '2px solid #f5c542', borderRadius: 10, userSelect: 'text' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Last XR outcome: {phase}</div>
        <div style={{ fontSize: 12, marginTop: 2, overflowWrap: 'anywhere' }}>{lines.length ? lines[lines.length - 1] : 'starting…'}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => rtRef.current?.enter()} disabled={!canEnter}>Enter VR</button>
          <button type="button" onClick={() => rtRef.current?.exit()}>Exit VR</button>
          <button type="button" onClick={() => { location.href = '/'; }}>Back to game</button>
          <button type="button" onClick={() => {
            const text = linesRef.current.join('\n');
            const done = (ok: boolean) => setCopyNote(ok ? 'log copied — paste it anywhere to share' : 'copy failed; long-press the log text below to select it');
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
            else done(false);
          }}>Copy log</button>
          {copyNote && <span style={{ fontSize: 12 }}>{copyNote}</span>}
        </div>
      </div>
      <div style={{ padding: '8px 12px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', zIndex: 2 }}>
        <b style={{ fontSize: 15 }}>XR prototype</b>
        <span data-testid="xr-phase" style={{ fontSize: 12, border: '1px solid #ffe9b0', borderRadius: 999, padding: '2px 8px' }}>status: {phase}</span>
        <span style={{ fontSize: 12 }}>{played ? `Played ${played} (gentle, flat landing)` : 'Pinch/click a hand card to play it'}</span>
      </div>
      <div data-testid="xr-status" style={{ userSelect: 'text', zIndex: 2, margin: '8px 12px 0', padding: '8px 10px', background: '#141d2e', border: '1px solid #35507a', borderRadius: 8, fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5, maxHeight: 150, overflowY: 'auto' }}>
        <div style={{ opacity: 0.85, marginBottom: 4 }}>XR status log (persists after exit) — if the headset shows black, exit VR (Digital Crown) and screenshot the outcome box at the very top:</div>
        {lines.length === 0 ? <div>starting…</div> : lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {(phase === 'no-xr' || phase === 'unsupported') && (
        <div style={{ margin: '8px 12px 0', fontSize: 12, color: '#ffd28a' }}>WebXR immersive VR is not available here, so this is the 2D fallback: the same table scene renders below and cards are clickable.</div>
      )}
      <div ref={mountRef} style={{ flex: 1, position: 'relative', minHeight: 0 }} />
    </div>
  );
}
