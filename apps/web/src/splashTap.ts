/**
 * WebKit drops the click that follows removal of a backdrop-filter layer (the first-visit
 * prompt). A touch pointerup still arrives. The click right after that pointerup is ignored
 * so the wizard step is pushed once. Mouse and keyboard keep the click.
 */
export function splashAction(
  e: { type: 'pointerup' | 'click'; pointerType?: string },
  touchAt: number,
  now: number,
): 'run' | 'ignore' {
  if (e.type === 'pointerup') return e.pointerType && e.pointerType !== 'mouse' ? 'run' : 'ignore';
  // touchAt stays 0 until a touch pointerup. A fresh page's first click is a few hundred
  // milliseconds in, and must not be treated as the click that follows that touch.
  if (touchAt > 0 && now - touchAt < 800) return 'ignore';
  return 'run';
}
