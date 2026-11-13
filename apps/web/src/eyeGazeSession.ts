/**
 * Eye zoom's camera session — the ONLY module that imports MediaPipe, and
 * eyeZoom.ts reaches it exclusively through a dynamic import at the moment
 * the driver first starts. A player who never enables Eye zoom never
 * downloads this chunk, the WASM fileset, or the model.
 *
 * PRIVACY: the stream is local-only and never leaves this object. Frames
 * are drawn to a small canvas, read for landmarks, and dropped — nothing
 * is recorded, stored, or sent anywhere. stop() closes the camera.
 *
 * Library: @mediapipe/tasks-vision FaceLandmarker (already in the repo's
 * dependency tree via drei; promoted to a direct dep for this feature).
 * Its face_landmarker.task model yields the refined 478-landmark mesh with
 * iris centres — the exact signal the classifier reads. CPU delegate on
 * purpose: the game's WebGL context is already the top crash class, and
 * 10 Hz on a ≤256 px frame is light CPU work. WASM + model are same-origin
 * static files under /mediapipe/, fetched only when this session starts.
 */
import {
  EYE_FRAME_WIDTH, EYE_SAMPLE_INTERVAL_MS, gazeVerticalFromLandmarks,
  type EyeGazeSessionLike,
} from './eyeZoom';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/face_landmarker.task';

export function createEyeGazeSession(): EyeGazeSessionLike {
  return new MediaPipeEyeSession();
}

class MediaPipeEyeSession implements EyeGazeSessionLike {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private landmarker: FaceLandmarker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTs = -1;
  private stopped = true;

  async start(onReading: (gazeV: number | null) => void): Promise<void> {
    this.stopped = false;
    const { FilesetResolver, FaceLandmarker: FaceLandmarkerCtor } = await import('@mediapipe/tasks-vision');
    if (this.stopped) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    if (this.stopped) return;
    const landmarker = await FaceLandmarkerCtor.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    if (this.stopped) { try { landmarker.close(); } catch { /* ignore */ } return; }
    this.landmarker = landmarker;

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('no camera API');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: EYE_FRAME_WIDTH },
        height: { ideal: EYE_FRAME_WIDTH },
        frameRate: { ideal: 15, max: 15 },
      },
    });
    if (this.stopped) {
      for (const t of stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
      return;
    }
    this.stream = stream;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.video = video;
    try { await video.play(); } catch { /* frames may still flow; sampling guards readyState */ }
    if (this.stopped) return;

    this.canvas = document.createElement('canvas');
    this.timer = setInterval(() => this.sample(onReading), EYE_SAMPLE_INTERVAL_MS);
  }

  private sample(onReading: (gazeV: number | null) => void): void {
    const video = this.video, landmarker = this.landmarker, canvas = this.canvas;
    if (this.stopped || !video || !landmarker || !canvas) return;
    if (video.readyState < 2 || video.videoWidth === 0) return; // not a lost face — just not ready
    try {
      let ts = performance.now();
      if (ts <= this.lastTs) ts = this.lastTs + 1;
      this.lastTs = ts;
      let result;
      if (video.videoWidth <= EYE_FRAME_WIDTH) {
        result = landmarker.detectForVideo(video, ts);
      } else {
        // The camera ignored the low-res ask: downscale before inference
        // so frames stay ≤256 px wide, per the feature's CPU bound.
        const scale = EYE_FRAME_WIDTH / video.videoWidth;
        canvas.width = EYE_FRAME_WIDTH;
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { onReading(null); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        result = landmarker.detectForVideo(canvas as unknown as HTMLVideoElement, ts);
      }
      const lm = result.faceLandmarks?.[0];
      onReading(lm ? (gazeVerticalFromLandmarks(lm)?.gazeV ?? null) : null);
    } catch {
      onReading(null); // a bad frame reads as no face — never throws into the driver
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.stream) {
      for (const t of this.stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
      this.stream = null;
    }
    if (this.video) { try { this.video.srcObject = null; } catch { /* ignore */ } this.video = null; }
    this.canvas = null;
    if (this.landmarker) { try { this.landmarker.close(); } catch { /* ignore */ } this.landmarker = null; }
  }
}
