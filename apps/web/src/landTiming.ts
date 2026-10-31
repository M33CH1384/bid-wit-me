/** When a flying card visually hits the felt, as a fraction of its flight. Glide cards touch down corner-first when
 *  the toss ends (t=0.35) and flop flat over a short bite; flicked cards skim in, touch down corner-first at t=0.55
 *  and snap down; every other motion lands at the end. Landing sound and thump fire at this moment. */
export function impactFraction(motion: string | undefined): number {
  return motion === 'glide' ? 0.35 : motion === 'flick' ? 0.55 : 1;
}
