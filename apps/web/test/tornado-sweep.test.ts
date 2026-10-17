import { describe, expect, it } from 'vitest';
import { releaseTornadoCard, tornadoCardLeft } from '../src/three/tornadoSweep';

describe('a swept card stays off the felt', () => {
  it('does not put the previous trick back when the tornado clock is cleared', () => {
    // Mid-fling: the show ends (or the effect cleans up) while the card is still marked visible.
    const midFling = releaseTornadoCard({ taken: true, gone: false, visible: true });
    expect(midFling.visible).toBe(false);
    expect(midFling.gone).toBe(true);
    // Already off the table. Clearing the clock must not restore it.
    const swept = releaseTornadoCard({ taken: true, gone: false, visible: false });
    expect(swept).toEqual({ taken: true, gone: true, visible: false });
    expect(releaseTornadoCard(swept)).toEqual(swept);
  });

  it('leaves a card that the funnel has not taken', () => {
    const sitting = { taken: false, gone: false, visible: true };
    expect(releaseTornadoCard(sitting)).toEqual(sitting);
  });

  it('counts the fling and the reduced-motion shrink as leaving', () => {
    expect(tornadoCardLeft(1.89, 1)).toBe(false);
    expect(tornadoCardLeft(1.9, 1)).toBe(true);
    expect(tornadoCardLeft(0.4, 0.002)).toBe(true);
  });
});
