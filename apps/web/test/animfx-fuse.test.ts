/**
 * @vitest-environment happy-dom
 *
 * FUSE CLOCK (animation package wave 2): TurnCountdown's own sampler burns
 * the LOCAL player's plate edge down through the final 5 seconds of their
 * turn clock. Another seat's clock — or a clock with more than 5s left —
 * grows no fuse. Visual only: the ring's deadline math is untouched.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnCountdown } from '../src/TurnRing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
function mount(mine: boolean, msLeft: number) {
  document.body.innerHTML = '';
  const plate = document.createElement('div');
  plate.className = 'plate';
  document.body.appendChild(plate);
  root = createRoot(plate);
  const now = Date.now();
  act(() => root!.render(createElement(TurnCountdown, { start: now - 26000, deadline: now + msLeft, mine })));
  return plate;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('fuse clock', () => {
  it('my clock inside 5s: the fuse is lit and burning down', () => {
    const plate = mount(true, 4000);
    const fuse = plate.querySelector('[data-testid="animfx-fuse"]');
    expect(fuse).not.toBeNull();
    expect((fuse as HTMLElement).style.opacity).toBe('1');
    const bar = plate.querySelector('.animfx-fuse-bar') as HTMLElement;
    const w = parseFloat(bar.style.width);
    expect(w).toBeGreaterThan(70);
    expect(w).toBeLessThan(85); // ~4.0s of the 5s fuse remains
  });

  it('my clock with time to spare: no fuse yet', () => {
    const plate = mount(true, 20000);
    const fuse = plate.querySelector('[data-testid="animfx-fuse"]') as HTMLElement;
    expect(fuse.style.opacity).toBe('0');
  });

  it("someone else's clock: no fuse is grown at all", () => {
    const plate = mount(false, 3000);
    expect(plate.querySelector('[data-testid="animfx-fuse"]')).toBeNull();
  });
});
