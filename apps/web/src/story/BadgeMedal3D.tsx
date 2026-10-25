/**
 * The badge as a physical object (owner, 2026-10-25: "I really want the
 * badges to be 3d items that take precent in the modal"). The badge
 * popup's flat emoji-in-a-ring medallion becomes a thick medallion coin
 * and the hero of the sheet: a real front face with the badge's glyph
 * embossed on it, a beveled rim, a reeded edge built from segments, and
 * a back face — pure CSS 3D (layered faces + edge segments, transforms
 * and gradients for the metal). No WebGL, no assets, nothing new in the
 * entry graph: the modal opens instantly and the coin costs a few dozen
 * small divs.
 *
 * It MOVES like an object: a slow turntable rock (±26°) with the light
 * travelling across the face as it turns, a cast shadow that narrows as
 * the coin goes edge-on, and drag-to-spin — grab it, throw it, it keeps
 * its momentum, friction settles it back into the rock. Earned is full
 * gold; locked is the same coin in dark, unlit metal (the case's ghost
 * language carried into 3D). Under reduced effects (the app toggle or
 * the OS) there is no loop at all: the coin rests at a still,
 * well-lit three-quarter angle — visibly a 3D object, never a flat
 * icon swapped in its place.
 */
import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

const EDGE_SEGMENTS = 48;
/** the resting three-quarter view under reduced effects */
const STILL_TRANSFORM = 'rotateX(10deg) rotateY(-28deg)';
const TILT_X = 10;
const ROCK_AMP = 26;
const ROCK_PERIOD_MS = 9000;
const DRAG_DEG_PER_PX = 0.45;

const EDGES = Array.from({ length: EDGE_SEGMENTS }, (_, i) => i);

interface Motion { mode: 'idle' | 'drag' | 'spin'; angle: number; vel: number; lastX: number; lastT: number }

export function BadgeMedal3D({ glyph, name, earned, still }: {
  /** the badge def's own glyph, embossed on the coin's front */
  glyph: string;
  name: string;
  earned: boolean;
  /** reduced effects: rest at the still three-quarter view, no loop */
  still: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const coinRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const motion = useRef<Motion>({ mode: 'idle', angle: -18, vel: 0, lastX: 0, lastT: 0 });

  /** paint the current angle: transform + travelling light + shadow */
  const write = () => {
    const coin = coinRef.current;
    if (!coin) return;
    const a = motion.current.angle;
    coin.style.transform = `rotateX(${TILT_X}deg) rotateY(${a}deg)`;
    const rad = (a * Math.PI) / 180;
    coin.style.setProperty('--shine', Math.sin(rad).toFixed(3));
    const shadow = shadowRef.current;
    if (shadow) {
      const face = Math.abs(Math.cos(rad));
      shadow.style.transform = `translateX(-50%) scaleX(${(0.38 + 0.62 * face).toFixed(3)})`;
      shadow.style.opacity = (0.55 + 0.3 * face).toFixed(3);
    }
  };

  useEffect(() => {
    if (still) {
      const coin = coinRef.current;
      if (coin) {
        coin.style.transform = STILL_TRANSFORM;
        coin.style.setProperty('--shine', '-0.47');
      }
      return;
    }
    write();
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const m = motion.current;
      if (m.mode === 'spin') {
        m.angle += m.vel * dt;
        m.vel *= Math.pow(0.08, dt / 1000);
        if (Math.abs(m.vel) < 0.003) {
          m.mode = 'idle';
          // settle from the nearest equivalent angle, not the long way round
          m.angle = ((m.angle + 180) % 360 + 360) % 360 - 180;
        }
        write();
      } else if (m.mode === 'idle') {
        const target = ROCK_AMP * Math.sin((now / ROCK_PERIOD_MS) * Math.PI * 2);
        m.angle += (target - m.angle) * Math.min(1, dt / 140);
        write();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (still) return;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety; the drag still tracks on the stage */ }
    const m = motion.current;
    m.mode = 'drag';
    m.lastX = e.clientX;
    m.lastT = performance.now();
    m.vel = 0;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = motion.current;
    if (still || m.mode !== 'drag') return;
    const now = performance.now();
    const dx = e.clientX - m.lastX;
    const dt = Math.max(1, now - m.lastT);
    m.angle += dx * DRAG_DEG_PER_PX;
    m.vel = m.vel * 0.7 + ((dx * DRAG_DEG_PER_PX) / dt) * 0.3;
    m.lastX = e.clientX;
    m.lastT = now;
    write();
  };
  const endDrag = () => {
    const m = motion.current;
    if (m.mode !== 'drag') return;
    if (Math.abs(m.vel) > 0.02) m.mode = 'spin';
    else { m.mode = 'idle'; m.angle = ((m.angle + 180) % 360 + 360) % 360 - 180; }
  };

  return (
    <div
      ref={stageRef}
      className={`badge3d${earned ? ' earned' : ' locked'}${still ? ' still' : ''}`}
      data-testid="badge-medal-3d"
      data-motion={still ? 'still' : 'live'}
      role="img"
      aria-label={`${name} badge, shown as a metal medallion${still ? '' : ' — drag to spin it'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div ref={shadowRef} className="badge3d-shadow" aria-hidden="true" />
      <div ref={coinRef} className="badge3d-coin" aria-hidden="true">
        <div className="badge3d-face badge3d-front" data-testid="badge3d-front">
          <span className="badge3d-glyph">{glyph}</span>
        </div>
        <div className="badge3d-face badge3d-back" data-testid="badge3d-back">
          <span className="badge3d-back-glyph">{glyph}</span>
        </div>
        {EDGES.map((i) => (
          <span key={i} className="badge3d-edge" style={{ '--a': `${(i * 360) / EDGE_SEGMENTS}deg` } as CSSProperties} />
        ))}
      </div>
      {!still && <span className="badge3d-hint" aria-hidden="true">Drag to spin</span>}
    </div>
  );
}
