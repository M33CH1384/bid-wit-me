/**
 * The table pair of the transition family: table ENTRY ("deal" in
 * the registry) and table EXIT ("sweep"). The shared controller
 * (transitions.ts) owns their lifecycles and timings, unchanged —
 * entry still covers at nav time and lifts when the table signals
 * ready.
 *
 * What plays is THE CARD FAN (owner, 2026-11-12: "spray for menus
 * and fan to start a game" — the earlier small-cards-on-felt covers
 * "look like they were made for the Apple II", and the fan is the
 * one he loves). One look per purpose: the spray is the menus'
 * transition, the fan is the game's — in and out. This layer is the
 * fan itself (FanLayer), mounted for the two table programs.
 */
import FanLayer from './FanLayer';
import type { TransitionProgramId } from './transitions';

const TABLE_PROGRAMS: readonly TransitionProgramId[] = ['deal', 'sweep'];
/** Leaving is entering played backwards: in, the fan opens up from the
 *  bottom and lifts off the top; out, it comes down from the top and
 *  closes into the bottom. */
const LEAVING: readonly TransitionProgramId[] = ['sweep'];

export default function TableTransitionLayer() {
  return <FanLayer programs={TABLE_PROGRAMS} testId="table-transition-layer" reversed={LEAVING} />;
}
