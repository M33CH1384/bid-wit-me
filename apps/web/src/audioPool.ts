/**
 * iOS Safari keeps only a few HTMLAudioElement decoder slots. Past that, new elements fail
 * silently (no error, no sound). Elements that are never paused and `load()`ed keep their slot
 * until the page reloads, so a leak sounds the same as a dropout.
 *
 * Cap concurrent elements (two music decks, the host beat, a canPlayType probe).
 * `release` pauses, clears src, and `load()`s so the slot is freed and the element can be reused.
 * `retire` does the same but does not reuse it: `createMediaElementSource` binds an element to one
 * AudioContext, so a rebuilt context has to allocate a fresh element.
 */
export const AUDIO_ELEMENT_CAP = 4;

export interface PooledAudio {
  pause(): void;
  load(): void;
  src: string;
  removeAttribute(name: string): void;
}

export class AudioElementPool<T extends PooledAudio> {
  private free: T[] = [];
  private live = new Set<T>();
  /** acquire() calls refused because every slot was already live. */
  exhausted = 0;

  constructor(readonly cap: number, private readonly create: () => T) {}

  get inUse(): number { return this.live.size; }

  acquire(): T | null {
    const reused = this.free.pop();
    if (reused) { this.live.add(reused); return reused; }
    if (this.live.size >= this.cap) { this.exhausted++; return null; }
    const el = this.create();
    this.live.add(el);
    return el;
  }

  /** Return an element that was never passed to createMediaElementSource. */
  release(el: T): void {
    if (!this.live.has(el)) return;
    this.detach(el);
    this.live.delete(el);
    this.free.push(el);
  }

  /** Drop an element bound to a dead AudioContext. The media slot is freed; the element is not reused. */
  retire(el: T): void {
    this.detach(el);
    this.live.delete(el);
    const i = this.free.indexOf(el);
    if (i >= 0) this.free.splice(i, 1);
  }

  private detach(el: T): void {
    try { el.pause(); } catch { /* already stopped */ }
    try {
      el.removeAttribute('src');
      el.src = '';
      el.load();
    } catch { /* element already gone */ }
  }
}

let shared: AudioElementPool<HTMLAudioElement> | null = null;

/** The page-wide pool. Created on first use so tests and SSR never touch `Audio`. */
export function audioElementPool(): AudioElementPool<HTMLAudioElement> {
  if (!shared) {
    shared = new AudioElementPool(AUDIO_ELEMENT_CAP, () => {
      const el = new Audio();
      el.preload = 'none';
      el.setAttribute('playsinline', '');
      return el;
    });
  }
  return shared;
}
