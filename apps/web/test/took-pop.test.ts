/**
 * @vitest-environment happy-dom
 *
 * popPlateTook (owner 2026-10-22): when a won trick's cards land in a
 * player's pile and the plate's TOOK number ticks, the plate itself pops.
 * The hook restarts the `.took-pop` CSS animation on every copy of the
 * seat's plate (the DOM plate layer and the canvas copy share the testid)
 * and on no other seat.
 */
import { describe, expect, it } from 'vitest';
import { popPlateTook } from '../src/plateFacts';

function screen(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'table-screen';
  root.innerHTML = `
    <div class="badge-layer">
      <div class="plate" data-testid="seat-1"><div class="plate-body"></div></div>
    </div>
    <div class="plate" data-testid="seat-1"><div class="plate-body"></div></div>
    <div class="plate" data-testid="seat-3"><div class="plate-body"></div></div>
  `;
  document.body.appendChild(root);
  return root;
}

describe('popPlateTook — the plate animation hook', () => {
  it('pops every copy of the seat plate and no other seat', () => {
    const root = screen();
    expect(popPlateTook(root, 1)).toBe(true);
    root.querySelectorAll('[data-testid="seat-1"]').forEach((p) => {
      expect(p.classList.contains('took-pop')).toBe(true);
    });
    expect(root.querySelector('[data-testid="seat-3"]')!.classList.contains('took-pop')).toBe(false);
    root.remove();
  });

  it('returns false for a seat with no plate on screen', () => {
    const root = screen();
    expect(popPlateTook(root, 2)).toBe(false);
    root.remove();
  });

  it('a second pop restarts instead of stacking (class re-added, token stamped)', () => {
    const root = screen();
    popPlateTook(root, 3);
    const plate = root.querySelector('[data-testid="seat-3"]') as HTMLElement;
    expect(plate.dataset.tookPop).toBeTruthy();
    expect(popPlateTook(root, 3)).toBe(true);
    expect(plate.classList.contains('took-pop')).toBe(true);
    root.remove();
  });
});
