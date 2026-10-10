import { useFrame, useThree } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { type Group, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, type Texture, Vector3 } from 'three';
import { cardGeometry } from './geometry';
import type { Xform } from './layout';
import { type Sfx, sound } from '../audio';

interface Props {
  face: Texture | null; // null = we only ever see the back
  back: Texture;
  target: Xform;
  from?: Xform;
  delay?: number;
  duration?: number;
  arc?: number;
  dim?: boolean;
  glow?: boolean;
  castShadow?: boolean;
  quality: 'high' | 'low';
  onTap?: () => void;
  name?: string;
  /** Sound when this card starts moving toward its current target (e.g. dealt flick, sweep). Fires once per value. */
  sfxStart?: Sfx;
  /** Sounds when this card lands on its current target (e.g. play / cut). Fires once per value. */
  sfxLand?: string; // comma-separated Sfx names, e.g. 'play,cut'
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const edgeMat = new MeshStandardMaterial({ color: '#efe9dc', roughness: 0.75 });

function Card3D({ face, back, target, from, delay = 0, duration = 0.45, arc = 0.25, dim, glow, castShadow = true, quality, onTap, name, sfxStart, sfxLand }: Props) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geo = cardGeometry();
  const mk = (map: Texture) =>
    quality === 'high'
      ? new MeshPhysicalMaterial({ map, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.2, sheenRoughness: 0.6 })
      : new MeshStandardMaterial({ map, roughness: 0.5 });
  const frontMat = useMemo(() => (face ? mk(face) : mk(back)), [face, back, quality]); // eslint-disable-line react-hooks/exhaustive-deps
  const backMat = useMemo(() => mk(back), [back, quality]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const c = dim ? 0.5 : 1;
    frontMat.color.setRGB(c, c, c);
    frontMat.emissive.set(glow ? '#5a3a00' : '#000000');
    invalidate();
  }, [dim, glow, frontMat, invalidate]);

  const tw = useRef({
    init: false,
    key: '',
    t: 1,
    wait: delay,
    sp: new Vector3(), sq: new Quaternion(), ss: 1,
    tp: new Vector3(), tq: new Quaternion(), ts: 1,
    started: false, firedStart: '' as string, firedLand: '' as string, land: undefined as string | undefined,
  });
  const sfx = useRef({ sfxStart, sfxLand });
  sfx.current = { sfxStart, sfxLand };

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const s = tw.current;
    if (!s.init) {
      const f = from ?? target;
      g.position.set(...f.p);
      g.quaternion.set(...f.q);
      g.scale.setScalar(f.s);
      s.init = true;
    }
    const key = target.p.map((v) => v.toFixed(4)).join() + target.q.map((v) => v.toFixed(4)).join() + target.s.toFixed(4);
    if (key !== s.key) {
      // retargeted before it landed (slow frames: the trick was swept while the card was still in flight) — still make its landing sound
      if (s.key && s.started && s.t < 1) {
        const land = s.land;
        if (land && land !== s.firedLand && s.sp.distanceTo(s.tp) > 0.02) { s.firedLand = land; land.split(',').forEach((c, i) => sound.play(c as Sfx, i ? { delay: 0.02 } : {})); }
      }
      s.key = key;
      s.land = sfx.current.sfxLand; // this tween's landing cue
      s.t = 0;
      s.sp.copy(g.position); s.sq.copy(g.quaternion); s.ss = g.scale.x;
      s.tp.set(...target.p); s.tq.set(...target.q); s.ts = target.s;
      s.started = false;
    }
    if (s.t >= 1) return;
    invalidate();
    if (s.wait > 0) { s.wait -= dt; return; }
    const moving = s.sp.distanceTo(s.tp) > 0.02;
    if (!s.started) {
      // the card leaves now — animation-driven sound, so it always matches what you see (any game speed)
      s.started = true;
      const st = sfx.current.sfxStart;
      if (st && st !== s.firedStart) { s.firedStart = st; if (moving) sound.play(st); }
    }
    s.t = Math.min(1, s.t + Math.min(dt, 0.05) / duration);
    if (s.t >= 1) {
      const land = s.land;
      if (land && land !== s.firedLand) { s.firedLand = land; if (moving) land.split(',').forEach((c, i) => sound.play(c as Sfx, i ? { delay: 0.02 } : {})); }
    }
    const e = easeInOut(s.t);
    g.position.lerpVectors(s.sp, s.tp, e);
    const dist = s.sp.distanceTo(s.tp);
    g.position.y += Math.sin(Math.PI * s.t) * arc * Math.min(1, dist);
    g.quaternion.slerpQuaternions(s.sq, s.tq, e);
    g.scale.setScalar(s.ss + (s.ts - s.ss) * e);
  });

  return (
    <group
      ref={ref}
      name={name}
      onClick={onTap ? (e) => { e.stopPropagation(); onTap(); } : undefined}
      onPointerOver={onTap ? () => { document.body.style.cursor = 'pointer'; } : undefined}
      onPointerOut={onTap ? () => { document.body.style.cursor = ''; } : undefined}
    >
      <mesh geometry={geo.body} material={edgeMat} castShadow={castShadow} />
      <mesh geometry={geo.front} material={frontMat} />
      <mesh geometry={geo.back} material={backMat} />
    </group>
  );
}

export default memo(Card3D);
