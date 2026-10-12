import { useEffect } from 'react';
import { fx } from './fx';
import { HAPTIC, cancelHaptics, haptic } from './haptics';
import { BURST_MS, advanceBurst, clearBurst, getBurst, shakeOffset, startBurst, subscribeBurst } from './jokerFx';

/**
 * Detonation clock for the 3D blast in Nuke3D (including the iOS cheap path).
 * The screen shake is the whole table, HUD included. Flash, shockwave, and the
 * canvas mushroom are not drawn here — that picture is the 3D explosion.
 * t = 0 is the nuke event, which is also when the detonation haptic fires.
 */
export default function JokerBurst() {
  useEffect(() => fx.on((e) => {
    if (e.kind !== 'nuke') return;
    // "Off" is banner + boom. The 3D blast is already skipped; don't add a shake,
    // and cancel so a vibration pattern can't outlive a blast that never painted.
    if (fx.nukeMode === 'off' && !fx.osReducedMotion) { cancelHaptics('nuke-off'); return; }
    const reduced = fx.osReducedMotion || fx.reduced;
    startBurst('BJ', reduced);
    // t = 0 of the 3D blast. The pattern's on/off slots are the opening hit.
    haptic(HAPTIC.detonation, 'detonate');
  }), []);

  useEffect(() => {
    let raf = 0;
    let alive = true;
    let sawActive = false;
    let clock = 0;
    let hapticCut = false;
    const stop = () => {
      const screen = document.querySelector<HTMLElement>('.table-screen');
      if (screen) screen.style.transform = '';
    };
    const tick = () => {
      if (!alive) return;
      const b = getBurst();
      if (!b) { sawActive = false; stop(); return; }
      if (b.start !== clock) { clock = b.start; sawActive = false; hapticCut = false; }
      const warped = fx.warp;
      const t = warped !== null ? warped * 1000 : (advanceBurst()?.elapsed ?? 0);
      const nuke = (window as unknown as { __bwmNuke?: { active?: boolean } }).__bwmNuke;
      if (nuke?.active) sawActive = true;
      // The 3D blast bailed (stall watchdog, context loss, or a tap to skip). Stop vibration.
      if (!hapticCut && b.kind === 'BJ' && sawActive && nuke && nuke.active === false && t < BURST_MS.BJ - 80) {
        hapticCut = true;
        cancelHaptics('nuke-skipped');
      }
      const screen = document.querySelector<HTMLElement>('.table-screen');
      if (screen) {
        const s = shakeOffset(t, b.kind, b.reduced);
        screen.style.transform = s.x === 0 && s.y === 0 ? '' : `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px)`;
      }
      if (warped === null && t >= BURST_MS[b.kind]) { clearBurst(); stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    const unsub = subscribeBurst(() => {
      cancelAnimationFrame(raf);
      if (getBurst()) raf = requestAnimationFrame(tick);
    });
    if (getBurst()) raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); unsub(); stop(); };
  }, []);

  return null;
}

/** Little Joker wins a trick that is not a nuke: the same opening haptic, no second explosion. */
export function startLittleBurst(): void {
  const reduced = fx.osReducedMotion || fx.reduced;
  startBurst('LJ', reduced);
  haptic(HAPTIC.detonation, 'detonate-little');
}
