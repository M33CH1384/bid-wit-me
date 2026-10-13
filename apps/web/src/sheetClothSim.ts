import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three';

/**
 * Draped cotton over one scorecard. A 64×64 three.js plane, top edge pinned. The free
 * bottom edge carries a low-frequency billow, a 0.6Hz ripple of mix(6.0, 10.0) px, and a
 * finer wrinkle. A key light from the upper left, crease occlusion, and a subtle
 * Blinn-Phong sheen shade the real normals. The police RIP is a multiply decal on those
 * UVs, so it bends with the folds. Two point lights, #FF2A2A on the left and #2A5BFF on
 * the right, take turns every 1.2s and catch the fold peaks. Nothing here paints a flat
 * red/blue fill. prefers-reduced-motion renders one settled still and stops.
 */
const VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uWidth;
uniform float uHeight;
varying vec2 vUv;
varying vec3 vWorld;
varying float vFold;
varying float vLow;

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
  float free = smoothstep(0.0, 0.2, down);
  float hang = pow(down, 1.65);
  float billowAmp = mix(18.0, 48.0, hang) * free * uWind;
  float rippleAmp = mix(6.0, 10.0, hang) * free * uWind;
  float wrinkleAmp = mix(5.0, 16.0, hang) * free * uWind;
  float w = 0.6 * 6.2831853;
  float billow = sin(uv.x * 2.2 + uTime * w) * 0.66
    + sin(uv.x * 3.6 + uv.y * 1.35 - uTime * w * 0.52) * 0.46;
  float ripple = sin(uv.x * 10.5 + uv.y * 4.4 + uTime * w * 1.7) * 0.62
    + sin(uv.y * 13.5 - uv.x * 2.4 - uTime * w * 2.05) * 0.38;
  float n1 = noise(uv * vec2(7.4, 5.2) + vec2(uTime * 0.09, 0.2));
  float n2 = noise(uv * vec2(16.0, 11.5) + vec2(1.7, uTime * 0.13));
  float wrinkle = (n1 - 0.5) * 1.7 + (n2 - 0.5) * 0.85;
  // Fine wrinkles ease off under the RIP so the letters stay whole. The billow still carries them.
  float ripCalm = smoothstep(0.08, 0.36, length((uv - vec2(0.5, 0.46)) * vec2(1.1, 1.8)));
  float detail = mix(0.28, 1.0, ripCalm);
  float zPx = billow * billowAmp + (ripple * rippleAmp + wrinkle * wrinkleAmp) * detail;
  vec3 p = position;
  p.z += zPx / uWidth;
  p.y += billow * hang * (36.0 / uHeight) + ripple * detail * hang * (8.0 / uHeight);
  p.x += sin(uv.y * 2.2 + uTime * w * 0.85) * hang * (30.0 / uWidth);
  p.x += wrinkle * detail * hang * (wrinkleAmp * 0.22 / uWidth);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vFold = zPx;
  vLow = billow * billowAmp;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uLightL;
uniform vec3 uLightR;
uniform sampler2D uRip;
varying vec2 vUv;
varying vec3 vWorld;
varying float vFold;
varying float vLow;

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
  N = normalize(N + vec3(sin(vUv.y * 240.0), sin(vUv.x * 240.0), 0.0) * 0.1);
  vec3 cotton = vec3(0.933, 0.941, 0.953);
  cotton *= 0.88 + 0.12 * weft + 0.05 * warp;

  vec3 keyDir = normalize(vec3(-0.66, 0.74, 0.62));
  float ndlK = pow(max(dot(N, keyDir), 0.0), 0.9);
  float depth = clamp(-vLow / 36.0, 0.0, 1.0);
  float cavity = clamp((vLow - vFold) / 14.0, 0.0, 1.0);
  float ao = clamp(1.0 - 0.52 * depth - 0.4 * cavity, 0.4, 1.0);
  vec3 col = cotton * (0.22 + 1.05 * ndlK) * ao;

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(keyDir + V);
  float spec = pow(max(dot(N, H), 0.0), 20.0);
  float sheen = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  float peak = smoothstep(-6.0, 16.0, vFold);
  col += vec3(1.0, 0.96, 0.9) * (spec * 0.2 + sheen * 0.045) * peak;

  vec3 toL = normalize(uLightL - vWorld);
  vec3 toR = normalize(uLightR - vWorld);
  float ndlL = pow(max(dot(N, toL), 0.0), 1.5);
  float ndlR = pow(max(dot(N, toR), 0.0), 1.5);
  float redAmt = 0.5 + 0.5 * cos(uTime * 6.2831853 / 1.2);
  float blueAmt = 1.0 - redAmt;
  col += vec3(1.0, 0.1647, 0.1647) * ndlL * peak * ao * redAmt;
  col += vec3(0.1647, 0.3569, 1.0) * ndlR * peak * ao * blueAmt;

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
      uniforms.uLightL.value.set(-w * 0.78, h * 0.48, 150);
      uniforms.uLightR.value.set(w * 0.78, -h * 0.36, 150);
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
