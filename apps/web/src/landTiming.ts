/** When a flying card visually hits the felt, as a fraction of its flight. Glide cards touch down when the toss ends
 *  (t=0.35) and then slide; flicked cards skim in, touch down at t=0.55 and skid the rest; every other motion lands
 *  at the end. Landing sound and thump fire at this moment. */
export function impactFraction(motion: string | undefined): number {
  return motion === 'glide' ? 0.35 : motion === 'flick' ? 0.55 : 1;
}
