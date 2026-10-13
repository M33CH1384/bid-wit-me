import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three';

/**
 * Draped cotton over one scorecard. A 64×64 three.js plane, top edge pinned, the free
 * bottom edge in a vertex-shader wind (layered sine plus noise, 0.6Hz, 6–10px). The police
 * RIP is a multiply decal on those UVs, so it bends with the folds. Two point lights,
 * #FF2A2A on the left and #2A5BFF on the right, take turns every 1.2s. Nothing here paints
 * a flat red/blue fill. prefers-reduced-motion renders one settled still and stops.
 */
const VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uWidth;
uniform float uHeight;
varying vec2 vUv;
varying vec3 vWorld;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vUv = uv;
  float down = 1.0 - uv.y;
  float free = smoothstep(0.0, 0.16, down);
  float amp = mix(6.0, 10.0, down) * free * uWind;
  float w = 0.6 * 6.2831853;
  float n = noise(uv * vec2(3.2, 2.1) + vec2(uTime * 0.17, 0.0));
  float wave = sin(uv.x * 5.2 + uTime * w) * 0.62
    + sin(uv.x * 11.4 - uTime * w * 0.73 + uv.y * 3.1) * 0.28
    + (n - 0.5) * 0.5;
  vec3 p = position;
  p.y += wave * 0.35 * (amp / uHeight);
  p.x += sin(uv.y * 3.4 + uTime * w) * free * (amp * 0.18 / uWidth);
  p.z += wave * (amp / uWidth);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uLightL;
uniform vec3 uLightR;
uniform sampler2D uRip;
varying vec2 vUv;
varying vec3 vWorld;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (N.z < 0.0) N = -N;
  float warp = sin(vUv.x * 240.0) * 0.55 + sin(vUv.y * 240.0) * 0.55;
  float weft = sin(vUv.x * 240.0 + 1.7) * sin(vUv.y * 240.0);
  N = normalize(N + vec3(sin(vUv.y * 240.0), sin(vUv.x * 240.0), 0.0) * 0.16);
  vec3 cotton = vec3(0.933, 0.941, 0.953);
  cotton *= 0.9 + 0.1 * weft + 0.04 * warp;

  vec3 toL = normalize(uLightL - vWorld);
  vec3 toR = normalize(uLightR - vWorld);
  float ndlL = max(dot(N, toL), 0.0);
  float ndlR = max(dot(N, toR), 0.0);
  float wrapL = pow(max(dot(N, toL) * 0.5 + 0.5, 0.0), 1.6);
  float wrapR = pow(max(dot(N, toR) * 0.5 + 0.5, 0.0), 1.6);
  float redAmt = 0.5 + 0.5 * cos(uTime * 6.2831853 / 1.2);
  float blueAmt = 1.0 - redAmt;
  vec3 col = cotton * (0.58 + 0.22 * ndlL + 0.22 * ndlR);
  col += vec3(1.0, 0.1647, 0.1647) * (ndlL * 0.85 + wrapL * 0.22) * redAmt;
  col += vec3(0.1647, 0.3569, 1.0) * (ndlR * 0.85 + wrapR * 0.22) * blueAmt;

  vec2 c = vUv - vec2(0.5, 0.46);
  float ang = -4.0 * 0.017453292;
  float cs = cos(ang);
  float sn = sin(ang);
  c = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
  vec2 ripUv = c / vec2(0.78, 0.5) + 0.5;
  float inside = step(0.0, ripUv.x) * step(ripUv.x, 1.0) * step(0.0, ripUv.y) * step(ripUv.y, 1.0);
  vec4 rip = texture2D(uRip, ripUv);
  col = mix(col, col * rip.rgb, rip.a * inside * 0.92);

  float side = min(vUv.x, 1.0 - vUv.x);
  float hem = smoothstep(0.0, 0.035, side) * smoothstep(0.0, 0.055, vUv.y);
  hem *= smoothstep(0.0, 0.9, hem + (noise(vUv * 14.0) - 0.5) * 0.08);
  float alpha = hem * 0.9;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export function mountSheet(canvas: HTMLCanvasElement, wait: boolean): () => void {
    const host = canvas.parentElement;
    if (!host) return () => {};
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    } catch {
      return () => {};
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    camera.position.set(0, 0, 800);
    const geo = new PlaneGeometry(1, 1, 64, 64);
    const ripTex = new Texture();
    ripTex.colorSpace = SRGBColorSpace;
    const uniforms = {
      uTime: { value: reduce ? 0.35 : 0 },
      uWind: { value: reduce ? 1 : 0 },
      uWidth: { value: 300 },
      uHeight: { value: 220 },
      uLightL: { value: new Vector3() },
      uLightR: { value: new Vector3() },
      uRip: { value: ripTex },
    };
    const mat = new ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(geo, mat);
    scene.add(mesh);

    const img = new Image();
    img.src = '/shot/rip.png';
    const arm = () => {
      ripTex.image = img;
      ripTex.needsUpdate = true;
    };
    if (img.complete && img.naturalWidth) arm();
    else img.addEventListener('load', arm);

    const fit = () => {
      const w = Math.max(2, host.clientWidth);
      const h = Math.max(2, host.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.left = -w / 2;
      camera.right = w / 2;
      camera.top = h / 2;
      camera.bottom = -h / 2;
      camera.updateProjectionMatrix();
      mesh.scale.set(w, h, w);
      uniforms.uWidth.value = w;
      uniforms.uHeight.value = h;
      uniforms.uLightL.value.set(-w * 0.62, h * 0.18, 120);
      uniforms.uLightR.value.set(w * 0.62, -h * 0.08, 120);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);

    let raf = 0;
    const t0 = performance.now();
    const hold = reduce ? 0 : (wait ? 400 + 600 : 600);
    const draw = (now: number) => {
      if (!reduce) {
        const elapsed = now - t0;
        uniforms.uTime.value = elapsed / 1000;
        uniforms.uWind.value = Math.min(1, Math.max(0, (elapsed - hold) / 280));
      }
      renderer.render(scene, camera);
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    const paintStill = () => { if (reduce) renderer.render(scene, camera); };
    img.addEventListener('load', paintStill);
    if (reduce) renderer.render(scene, camera);
    else raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      img.removeEventListener('load', arm);
      img.removeEventListener('load', paintStill);
      geo.dispose();
      mat.dispose();
      ripTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
}
