import { useFrame, useThree } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { type Group, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, type Texture, Vector3 } from 'three';
import { cardGeometry } from './geometry';
import type { Xform } from './layout';

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
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const edgeMat = new MeshStandardMaterial({ color: '#efe9dc', roughness: 0.75 });

function Card3D({ face, back, target, from, delay = 0, duration = 0.45, arc = 0.25, dim, glow, castShadow = true, quality, onTap, name }: Props) {
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
  });

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
      s.key = key;
      s.t = 0;
      s.sp.copy(g.position); s.sq.copy(g.quaternion); s.ss = g.scale.x;
      s.tp.set(...target.p); s.tq.set(...target.q); s.ts = target.s;
    }
    if (s.t >= 1) return;
    invalidate();
    if (s.wait > 0) { s.wait -= dt; return; }
    s.t = Math.min(1, s.t + Math.min(dt, 0.05) / duration);
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
