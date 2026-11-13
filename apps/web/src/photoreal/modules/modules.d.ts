/** Motion Director's final v2 canvas effect modules (copied verbatim from /workspace/effects/modules; built by modules/build.sh). */
export interface PhotorealFxInstance { duration: number; render(t: number): void; play(onEnd?: () => void): () => void }
export interface PhotorealFxOpts {
  seed?: number; lowPower?: boolean;
  /** ground zero, canvas px */ x?: number; y?: number;
  /** table ellipse radii, canvas px (core.js reads these; not in the module header yet) */ tableRx?: number; tableRy?: number;
  /** quake degree of fracture, 1..4 (Big Joker crack tier, 2026-11-06; other modules ignore it; absent = 2, the original fracture) */ power?: number;
  drawScene?: (ctx: CanvasRenderingContext2D, W: number, H: number, t: number) => void;
}
export declare function createFx(canvas: HTMLCanvasElement, opts?: PhotorealFxOpts): PhotorealFxInstance;
