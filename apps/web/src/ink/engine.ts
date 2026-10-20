/**
 * Neon Royale ink engine — WebGL dye advection.
 *
 * What this is, accurately: a **fluid-style dye advection** renderer. Two small
 * off-screen fields (colored dye + velocity) ping-pong through a handful of
 * shader passes per frame:
 *
 *   1. splat  — pointer injections add dye and velocity (gaussian stamps),
 *   2. advect — each field is resampled backward along the local velocity
 *      (semi-Lagrangian advection); the dye pass adds an analytic curl flow
 *      (the derivative of a sine stream function) so idle ink keeps a slow
 *      current and drags visibly curl instead of smearing in straight lines,
 *   3. decay  — both fields fade exponentially, so a released trail keeps
 *      drifting on its imparted velocity while it dissipates.
 *
 * It is NOT a Navier–Stokes solver: there is no pressure projection or
 * incompressibility solve. A stable-fluids solve costs 20+ passes a frame;
 * for a background at ~256 px that budget is wasted, and the visual result —
 * bloom, pull, curl, drift, decay — is what the design actually asks for.
 *
 * Discipline: one shared canvas, sim at governor-controlled resolution,
 * display DPR capped, no per-frame allocations (ring buffers and uniform
 * arrays are preallocated), and destroy() releases the GL context outright
 * (WEBGL_lose_context) so the table's Three.js scene never shares the iOS
 * WebGL budget with a leaked background context.
 */
import {
  AMBIENT_MAX_RADIUS,
  AMBIENT_MIN_RADIUS,
  AMBIENT_STRENGTH,
  DYE_DECAY_RATE,
  VEL_DECAY_RATE,
  decayFactor,
  inkColor,
  type InkSplat,
} from './splat';
import { createGovernor, governorFrame, simSizeFor, type GovernorState } from './governor';

const MAX_DPR = 1.5;
const MAX_PIXELS = 1_500_000;
const MAX_SPLATS_PER_FRAME = 16;
const SPLAT_BATCH = 8;
const QUEUE_CAP = 64;
/** Byte-encoded velocity fields store world velocity in ±this range. */
const VEL_BYTE_RANGE = 3.0;
/** Ambient curl-flow strength in the dye pass (field-units/sec at peak). */
const FLOW_AMP = 0.05;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Adds a batch of gaussian splats to a field (mode 0 = dye color, 1 = velocity). */
const SPLAT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAspect;
uniform float uCount;
uniform vec4 uPos[${SPLAT_BATCH}];
uniform vec4 uVel[${SPLAT_BATCH}];
uniform vec4 uCol[${SPLAT_BATCH}];
uniform float uMode;
uniform float uEncA;
void main() {
  vec4 base = texture2D(uTex, vUv);
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec3 addDye = vec3(0.0);
  vec2 addVel = vec2(0.0);
  for (int i = 0; i < ${SPLAT_BATCH}; i++) {
    float on = 1.0 - step(uCount, float(i));
    vec4 sp = uPos[i];
    vec2 d = p - sp.xy;
    float fall = exp(-dot(d, d) / max(sp.z * sp.z, 0.00001) * 3.0) * sp.w * on;
    addDye += uCol[i].rgb * fall;
    addVel += uVel[i].xy * fall;
  }
  if (uMode < 0.5) gl_FragColor = vec4(base.rgb + addDye, 1.0);
  else gl_FragColor = vec4(base.rg + addVel * uEncA, base.ba);
}
`;

/** Semi-Lagrangian advection: sample the field backward along the velocity. */
const ADVECT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform sampler2D uVelTex;
uniform float uAspect;
uniform float uDt;
uniform float uDecay;
uniform float uTime;
uniform float uFlow;
uniform float uEncA;
uniform float uEncB;
vec2 flowAt(vec2 p, float t) {
  float x = p.x;
  float y = p.y;
  float dpsiDy = -2.2 * sin(1.9 * x + 0.31 * t) * sin(2.2 * y - 0.23 * t)
               + 1.62 * cos(2.7 * y + 0.19 * t) * cos(1.5 * x + 0.13 * t);
  float dpsiDx = 1.9 * cos(1.9 * x + 0.31 * t) * cos(2.2 * y - 0.23 * t)
               - 0.9 * sin(2.7 * y + 0.19 * t) * sin(1.5 * x + 0.13 * t);
  return vec2(dpsiDy, -dpsiDx);
}
void main() {
  vec2 vel = (texture2D(uVelTex, vUv).rg - uEncB) / uEncA;
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vel += flowAt(p, uTime) * uFlow;
  vec2 backP = p - vel * uDt;
  vec2 backUv = clamp(vec2(backP.x / uAspect, backP.y), vec2(0.0015), vec2(0.9985));
  gl_FragColor = texture2D(uField, backUv) * uDecay;
}
`;

/** Palette shaping: dye over the midnight-navy base, hot-core glow, vignette, dither. */
const DISPLAY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uDye;
void main() {
  vec3 dye = texture2D(uDye, vUv).rgb;
  vec3 col = vec3(0.0275, 0.0353, 0.0784);
  col += dye * 0.85;
  float e = max(dye.r, max(dye.g, dye.b));
  col += vec3(0.35, 0.55, 1.0) * (e * e) * 0.4;
  float d = distance(vUv, vec2(0.5, 0.42));
  col *= 1.0 - 0.32 * smoothstep(0.55, 1.05, d);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * 0.0078;
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Field {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

interface Prog {
  prog: WebGLProgram;
  aPos: number;
  u: Record<string, WebGLUniformLocation | null>;
}

export interface InkEngineCallbacks {
  /** Governor exhausted or the context died: the layer should fall back to the gradient. */
  onExhausted: () => void;
}

type FieldType = 'half' | 'byte';

function makeProg(gl: WebGLRenderingContext | WebGL2RenderingContext, fsSrc: string, uniforms: string[]): Prog {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('ink: shader alloc failed');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`ink: shader compile failed: ${log ?? 'unknown'}`);
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('ink: program alloc failed');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('ink: program link failed');
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
  return { prog, aPos: gl.getAttribLocation(prog, 'aPos'), u };
}

export class InkEngine {
  private canvas: HTMLCanvasElement;
  private cb: InkEngineCallbacks;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private isGl2: boolean;
  private halfFloatOes: number | null = null;
  private loseExt: { loseContext: () => void } | null = null;

  private progSplat: Prog;
  private progAdvect: Prog;
  private progDisplay: Prog;
  private quad: WebGLBuffer | null;

  private fieldType: FieldType = 'byte';
  private encA = 1;
  private encB = 0;
  private dyeFields: [Field, Field] | null = null;
  private velFields: [Field, Field] | null = null;
  private dyeRead = 0;
  private velRead = 0;
  private simW = 0;
  private simH = 0;
  private aspect = 1;

  private gov: GovernorState = createGovernor();
  private queue: InkSplat[] = [];
  private qHead = 0;
  private qCount = 0;
  private posArr = new Float32Array(SPLAT_BATCH * 4);
  private velArr = new Float32Array(SPLAT_BATCH * 4);
  private colArr = new Float32Array(SPLAT_BATCH * 4);
  private scratch: InkSplat = { x: 0, y: 0, vx: 0, vy: 0, radius: 0.2, strength: 0, r: 0, g: 0, b: 0 };

  private raf = 0;
  private running = false;
  private destroyed = false;
  private resizeDirty = true;
  private lastNow = 0;
  private time = 0;
  private nextAmbient = 0;

  /** Creates an engine, or null when WebGL (or a shader, or a field) is unavailable. */
  static create(canvas: HTMLCanvasElement, cb: InkEngineCallbacks): InkEngine | null {
    try {
      return new InkEngine(canvas, cb);
    } catch {
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, cb: InkEngineCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    const attrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: false,
    };
    const gl2 = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null;
    const gl = gl2 ?? (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);
    if (!gl) throw new Error('ink: no webgl context');
    this.gl = gl;
    this.isGl2 = !!gl2;
    if (this.isGl2) {
      const renderable = gl.getExtension('EXT_color_buffer_half_float') ?? gl.getExtension('EXT_color_buffer_float');
      if (!renderable) this.fieldType = 'byte';
      else this.fieldType = 'half';
    } else {
      const half = gl.getExtension('OES_texture_half_float') as { HALF_FLOAT_OES: number } | null;
      if (half) {
        this.halfFloatOes = half.HALF_FLOAT_OES;
        this.fieldType = 'half';
      }
    }
    this.setEncoding();
    this.loseExt = gl.getExtension('WEBGL_lose_context');

    this.progSplat = makeProg(gl, SPLAT_FRAG, ['uTex', 'uAspect', 'uCount', 'uPos[0]', 'uVel[0]', 'uCol[0]', 'uMode', 'uEncA']);
    this.progAdvect = makeProg(gl, ADVECT_FRAG, ['uField', 'uVelTex', 'uAspect', 'uDt', 'uDecay', 'uTime', 'uFlow', 'uEncA', 'uEncB']);
    this.progDisplay = makeProg(gl, DISPLAY_FRAG, ['uDye']);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    for (let i = 0; i < QUEUE_CAP; i++) this.queue.push({ x: 0, y: 0, vx: 0, vy: 0, radius: 0, strength: 0, r: 0, g: 0, b: 0 });

    canvas.addEventListener('webglcontextlost', this.onCtxLost);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVis);
    this.resizeIfNeeded(true);
    // Seed a little life so the first frame isn't a flat field.
    this.pushAmbient();
    this.pushAmbient();
  }

  private setEncoding(): void {
    if (this.fieldType === 'half') {
      this.encA = 1;
      this.encB = 0;
    } else {
      this.encA = 1 / (2 * VEL_BYTE_RANGE);
      this.encB = 0.5;
    }
  }

  /** Queues a splat (copied — the caller's object stays theirs). Drops when full. */
  addSplat(s: InkSplat): void {
    if (this.destroyed || this.qCount >= QUEUE_CAP) return;
    const slot = this.queue[(this.qHead + this.qCount) % QUEUE_CAP]!;
    slot.x = s.x;
    slot.y = s.y;
    slot.vx = s.vx;
    slot.vy = s.vy;
    slot.radius = s.radius;
    slot.strength = s.strength;
    slot.r = s.r;
    slot.g = s.g;
    slot.b = s.b;
    this.qCount++;
  }

  start(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    this.lastNow = performance.now();
    this.nextAmbient = this.lastNow + 1400;
    if (!document.hidden) this.kick();
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
    this.canvas.removeEventListener('webglcontextlost', this.onCtxLost);
    const gl = this.gl;
    this.deleteFields();
    for (const p of [this.progSplat, this.progAdvect, this.progDisplay]) gl.deleteProgram(p.prog);
    if (this.quad) gl.deleteBuffer(this.quad);
    this.quad = null;
    this.loseExt?.loseContext();
  }

  private onCtxLost = (): void => {
    this.stop();
    this.cb.onExhausted();
  };

  private onResize = (): void => {
    // Cheap flag only; the frame loop does the (layout-reading) work. Note a
    // mobile URL-bar collapse also lands here — it resizes the display canvas
    // but must not rebuild (and visibly restart) the sim fields.
    this.resizeDirty = true;
  };

  private onVis = (): void => {
    if (document.hidden) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (this.running && !this.destroyed) {
      this.lastNow = performance.now();
      this.kick();
    }
  };

  private kick(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private exhaust(): void {
    this.stop();
    this.cb.onExhausted();
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (!this.running || this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtMs = now - this.lastNow;
    this.lastNow = now;
    // A long stall (tab was hidden, hitch) says nothing about throughput and
    // would teleport the ink: skip the step, keep the loop.
    if (!(dtMs > 0) || dtMs > 250) return;
    const action = governorFrame(this.gov, dtMs);
    if (action === 'fallback') {
      this.exhaust();
      return;
    }
    if (action === 'step') this.buildFields();
    if (this.resizeDirty) {
      this.resizeDirty = false;
      this.resizeIfNeeded(false);
    }
    if (!this.dyeFields || !this.velFields) return;
    const dt = Math.min(dtMs / 1000, 1 / 30);
    this.time += dt;
    if (now >= this.nextAmbient) {
      this.pushAmbient();
      this.nextAmbient = now + 2600 + Math.random() * 1900;
    }
    this.drainSplats();
    this.velRead = this.advect(this.velFields!, this.velRead, this.velRead, 0, dt, VEL_DECAY_RATE);
    this.dyeRead = this.advect(this.dyeFields!, this.dyeRead, this.velRead, FLOW_AMP, dt, DYE_DECAY_RATE);
    this.display();
  };

  private pushAmbient(): void {
    const s = this.scratch;
    s.x = (0.12 + Math.random() * 0.76) * this.aspect;
    s.y = 0.12 + Math.random() * 0.76;
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.02 + Math.random() * 0.03;
    s.vx = Math.cos(ang) * sp;
    s.vy = Math.sin(ang) * sp;
    s.radius = AMBIENT_MIN_RADIUS + Math.random() * (AMBIENT_MAX_RADIUS - AMBIENT_MIN_RADIUS);
    s.strength = AMBIENT_STRENGTH;
    const c = inkColor(Math.random() * 0.5);
    s.r = c[0];
    s.g = c[1];
    s.b = c[2];
    this.addSplat(s);
  }

  private drainSplats(): void {
    let drained = 0;
    while (this.qCount > 0 && drained < MAX_SPLATS_PER_FRAME) {
      const batch = Math.min(SPLAT_BATCH, this.qCount, MAX_SPLATS_PER_FRAME - drained);
      for (let i = 0; i < batch; i++) {
        const s = this.queue[this.qHead]!;
        this.qHead = (this.qHead + 1) % QUEUE_CAP;
        this.qCount--;
        this.posArr[i * 4] = s.x;
        this.posArr[i * 4 + 1] = s.y;
        this.posArr[i * 4 + 2] = s.radius;
        this.posArr[i * 4 + 3] = s.strength;
        this.velArr[i * 4] = s.vx;
        this.velArr[i * 4 + 1] = s.vy;
        this.velArr[i * 4 + 2] = 0;
        this.velArr[i * 4 + 3] = 0;
        this.colArr[i * 4] = s.r;
        this.colArr[i * 4 + 1] = s.g;
        this.colArr[i * 4 + 2] = s.b;
        this.colArr[i * 4 + 3] = 0;
      }
      this.splatPass(this.dyeFields!, this.dyeRead, 0, batch);
      this.splatPass(this.velFields!, this.velRead, 1, batch);
      this.dyeRead = 1 - this.dyeRead;
      this.velRead = 1 - this.velRead;
      drained += batch;
    }
  }

  private bindQuad(aPos: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  private splatPass(fields: [Field, Field], read: number, mode: number, count: number): void {
    const gl = this.gl;
    const P = this.progSplat;
    gl.useProgram(P.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fields[read].tex);
    gl.uniform1i(P.u.uTex!, 0);
    gl.uniform1f(P.u.uAspect!, this.aspect);
    gl.uniform1f(P.u.uCount!, count);
    gl.uniform4fv(P.u['uPos[0]']!, this.posArr);
    gl.uniform4fv(P.u['uVel[0]']!, this.velArr);
    gl.uniform4fv(P.u['uCol[0]']!, this.colArr);
    gl.uniform1f(P.u.uMode!, mode);
    gl.uniform1f(P.u.uEncA!, this.encA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fields[1 - read].fbo);
    gl.viewport(0, 0, this.simW, this.simH);
    this.bindQuad(P.aPos);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Advects `fields[read]` (velocity read from the vel field) into the other target; returns the new read index. */
  private advect(fields: [Field, Field], read: number, velRead: number, flow: number, dt: number, decayRate: number): number {
    const gl = this.gl;
    const P = this.progAdvect;
    gl.useProgram(P.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fields[read].tex);
    gl.uniform1i(P.u.uField!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velFields![velRead].tex);
    gl.uniform1i(P.u.uVelTex!, 1);
    gl.uniform1f(P.u.uAspect!, this.aspect);
    gl.uniform1f(P.u.uDt!, dt);
    gl.uniform1f(P.u.uDecay!, decayFactor(decayRate, dt));
    gl.uniform1f(P.u.uTime!, this.time);
    gl.uniform1f(P.u.uFlow!, flow);
    gl.uniform1f(P.u.uEncA!, this.encA);
    gl.uniform1f(P.u.uEncB!, this.encB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fields[1 - read].fbo);
    gl.viewport(0, 0, this.simW, this.simH);
    this.bindQuad(P.aPos);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return 1 - read;
  }

  private display(): void {
    const gl = this.gl;
    const P = this.progDisplay;
    gl.useProgram(P.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dyeFields![this.dyeRead].tex);
    gl.uniform1i(P.u.uDye!, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.bindQuad(P.aPos);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private resizeIfNeeded(force: boolean): void {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    let tw = Math.round(cw * dpr);
    let th = Math.round(ch * dpr);
    if (tw * th > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (tw * th));
      tw = Math.round(tw * k);
      th = Math.round(th * k);
    }
    if (tw !== this.canvas.width || th !== this.canvas.height) {
      this.canvas.width = tw;
      this.canvas.height = th;
    }
    const aspect = cw / ch;
    const sim = simSizeFor(this.gov.level, aspect);
    if (force || sim.w !== this.simW || sim.h !== this.simH) {
      this.aspect = aspect;
      this.buildFields();
    } else {
      this.aspect = aspect;
    }
  }

  private makeField(w: number, h: number): Field | null {
    const gl = this.gl;
    const types: FieldType[] = this.fieldType === 'half' ? ['half', 'byte'] : ['byte'];
    for (const type of types) {
      const tex = gl.createTexture();
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.isGl2) {
        const gl2 = gl as WebGL2RenderingContext;
        if (type === 'half') gl.texImage2D(gl.TEXTURE_2D, 0, gl2.RGBA16F, w, h, 0, gl.RGBA, gl2.HALF_FLOAT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl2.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      } else if (type === 'half') {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, this.halfFloatOes!, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      const fbo = gl.createFramebuffer();
      if (!fbo) {
        gl.deleteTexture(tex);
        continue;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        continue;
      }
      if (type !== this.fieldType) {
        this.fieldType = type;
        this.setEncoding();
      }
      return { tex, fbo };
    }
    return null;
  }

  private clearField(f: Field, isVel: boolean): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
    gl.viewport(0, 0, this.simW, this.simH);
    // Byte velocity fields rest at the encode bias (world velocity 0 = 0.5).
    if (isVel && this.fieldType === 'byte') gl.clearColor(0.5, 0.5, 0, 1);
    else gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private buildFields(): void {
    const sim = simSizeFor(this.gov.level, this.aspect);
    this.simW = sim.w;
    this.simH = sim.h;
    this.deleteFields();
    const d0 = this.makeField(sim.w, sim.h);
    const d1 = this.makeField(sim.w, sim.h);
    const v0 = this.makeField(sim.w, sim.h);
    const v1 = this.makeField(sim.w, sim.h);
    if (!d0 || !d1 || !v0 || !v1) {
      for (const f of [d0, d1, v0, v1]) {
        if (f) {
          this.gl.deleteTexture(f.tex);
          this.gl.deleteFramebuffer(f.fbo);
        }
      }
      throw new Error('ink: field alloc failed');
    }
    this.dyeFields = [d0, d1];
    this.velFields = [v0, v1];
    this.dyeRead = 0;
    this.velRead = 0;
    this.clearField(d0, false);
    this.clearField(d1, false);
    this.clearField(v0, true);
    this.clearField(v1, true);
  }

  private deleteFields(): void {
    const gl = this.gl;
    for (const pair of [this.dyeFields, this.velFields]) {
      if (!pair) continue;
      for (const f of pair) {
        gl.deleteTexture(f.tex);
        gl.deleteFramebuffer(f.fbo);
      }
    }
    this.dyeFields = null;
    this.velFields = null;
  }
}
