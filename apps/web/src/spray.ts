/**
 * Spray-paint screen transitions (owner, 2026-10-23) — now the
 * façade over the transition family in transitions.ts.
 *
 * The spray was the family's first program: "animations when we move
 * from screen to screen — a quick animation of black spray paint
 * covering the screen." The controller, eligibility rules, and timing
 * constants now live in transitions.ts alongside the other programs
 * (Ink Bloom, the Card Fan, the Deal, the Book Sweep, the Doorway);
 * this module re-exports them under the spray-era names so the
 * original call sites (Root, the Setup wizard, StoryHome, the Social
 * store, spraySound, SprayLayer) and their tests keep working
 * unchanged. New call sites should import from transitions.ts and pass
 * their move class to coverThen().
 */
export {
  SPRAY_COVER_MS,
  SPRAY_FAILSAFE_MS,
  SPRAY_FILL_MS,
  SPRAY_HOLD_MS,
  SPRAY_OUTLINE_MS,
  SPRAY_REVEAL_MS,
  SPRAY_SPADE_MS,
  cancelTransitions as cancelSpray,
  coverThen,
  getTransitionSnapshot as getSpraySnapshot,
  registerTransitionRenderer as registerSprayRenderer,
  routeClass as sprayRouteClass,
  routeEligible as sprayRouteEligible,
  subscribeTransitions as subscribeSpray,
  transitionsSuppressed as spraySuppressed,
} from './transitions';
export type {
  TransitionPhase as SprayPhase,
  TransitionSnapshot as SpraySnapshot,
} from './transitions';
