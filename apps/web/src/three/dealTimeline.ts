/** Shuffle + deal timing (seconds), scaled by game speed. Shared by the 3D scene and the bots' wait. */
export interface DealTimeline { shuffle: number; step: number; fly: number; dealSpan: number; total: number }

export function dealTimeline(k: number, players: number, cards = 52): DealTimeline {
  const kk = Math.max(0.2, Math.min(1.5, k));
  const shuffle = 0.95 * kk;
  const step = 0.028 * kk; // between consecutive dealt cards
  const fly = Math.max(0.12, 0.38 * kk);
  const dealSpan = step * Math.max(0, cards - 1);
  return { shuffle, step, fly, dealSpan, total: shuffle + dealSpan + fly };
}
