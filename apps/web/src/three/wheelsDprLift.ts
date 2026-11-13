/**
 * wheelsDprLift — the moment-scoped DPR lift for the Wheels car IN the
 * table scene (owner pick 2026-11-08: "Chase the in-table car too").
 *
 * The conviction (round 3, e5bf6bdd — the results stage's identical
 * disease, fixed there): the table Canvas backs at the load ramp's
 * 1.75 ceiling, trimmed further by the adaptive governor, so on the
 * owner's DPR-3 phone every table frame — the car included — is
 * upscaled ~1.71x by the compositor (x2 / x2.4 / x3 under governor
 * levels 1-3). The car's texture was never the bottleneck.
 *
 * The lift: while the 3D car's show is presenting in the scene, the
 * canvas DPR ceiling rises to WHEELS_DPR_LIFT_CAP (R3F clamps the
 * [1, cap] range to the device, so the backing reaches
 * min(devicePixelRatio, 3) — native on his phone). The governor rule
 * is exact: the governor keeps sampling during the show and may step
 * its level on what it sees, but its DPR caps do not bind while the
 * lift is active; the instant the show ends, applyCaps' output (ramp
 * ceiling + governor level) owns the DPR again. No permanent
 * exemption, and outside the moment the returned cap is the
 * governor's untouched — the pre-change path, value for value.
 *
 * The engage/release signals are the car rig's own show state
 * (WheelsCar3D): engage when a show starts, release from the show
 * effect's cleanup, which also fires on skip and on unmount
 * (quality flip, context-restore remount, scene teardown). There is
 * deliberately no timer in this mechanism — nothing here can strand
 * the renderer at the lifted ratio.
 *
 * Cost, bounded by the show's own length (~2.5 s + 0.9 s linger,
 * seconds more if a blast sweeps the car): fill scales with pixel
 * count, so the window costs ~(3/1.75)^2 ≈ 2.9x the ceiling path's
 * fill (~3.6 Mpx vs ~1.2 Mpx backing on his phone), plus one buffer
 * realloc at engage and one at release. Steady state is untouched.
 */

/** Canvas DPR ceiling while the Wheels show is presenting. R3F
 *  clamps the [1, cap] range against the device's own ratio, so the
 *  effective backing is min(devicePixelRatio, this cap). */
export const WHEELS_DPR_LIFT_CAP = 3;

/** The table Canvas's DPR ceiling: the governor/ramp cap untouched
 *  outside the car moment; the lift cap while the show presents. */
export function effectiveCanvasDprCap(govDprCap: number, wheelsShowActive: boolean): number {
  return wheelsShowActive ? WHEELS_DPR_LIFT_CAP : govDprCap;
}
