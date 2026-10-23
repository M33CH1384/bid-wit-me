/**
 * The King's double or nothing (owner, 2026-10-21): the between-legs
 * set-pieces. Deliberately SHORT — the King names the terms, Dee answers,
 * and the player is back at the table (or the walk-away is honored in a
 * breath). These are not scenes; they are the moment between two games,
 * played in the scene player on the between-legs screen.
 *
 * 'started' carries the owner's staging (2026-10-21): the King makes the
 * warning physical — he lays a revolver on the table as he states the
 * terms (the gun beat carries `prop: 'kingGun'`; the scene player sets
 * the piece down on that beat, and in leg 2 itself the same gun lies on
 * the felt by his seat for the whole decider, keyed to the live
 * double-pending state). Placed, never pointed, never fired — a threat
 * display, not an action. Dee's answer names it for what it is.
 */
import type { StoryBeat } from './storyScripts';

/**
 * The co-op proposal (COOP_SPEC §6.3/§8.10): when a pair holds the
 * King's double mark, he changes the terms — leg 2 becomes a
 * cutthroat — and says so in these six beats (King ×5, the Ringer ×1).
 * The scene itself is Phase 4's build; the TEXT is authored here, with
 * the rest of the King's double-or-nothing material, so the mini-bake
 * records it in the same session as the other co-op lines and the
 * scene build consumes one source. Canon per §6.3: he names what leg 2
 * usually is, that he is changing it FOR THEM — two who came together
 * get the test that pulls people apart — the gun is already on the
 * felt before he speaks (the shipped staging, reused), and the choice
 * is stated with its price. The Ringer's beat is a look in the scene
 * text; this short cast line is what his voice contributes in audio
 * (the §8.10 tally records exactly one). Dee's answer lives in
 * GUIDE_FINALE (storyGuide.ts) — "He's not testing your cards. He's
 * testing your friendship's price." — and is counted there.
 */
export const KING_PROPOSAL_LINES: readonly StoryBeat[] = [
  { speaker: 'king', line: 'The second game is usually the first one, played again. Same table. Same terms.' },
  { speaker: 'king', line: 'For you two, the terms change.' },
  { speaker: 'king', line: 'You climbed this whole route holding each other up. So my last test pulls the other way.' },
  { speaker: 'king', line: 'Cutthroat. Four seats, no partners. The hand across from you stops being yours to protect.' },
  { speaker: 'king', line: 'Take it outright and the double pays — to both names. Or keep the clear you earned and walk out together. Decide like people who know what things cost.' },
  { speaker: 'ringer', line: 'Choose carefully.' },
];

export type KingDoubleMoment = 'started' | 'lost';

export function kingDoubleBeats(moment: KingDoubleMoment): StoryBeat[] {
  if (moment === 'started') {
    return [
      { speaker: 'king', prop: 'kingGun', line: 'One win. …There. Now it sits where everybody can see it: you ain’t won yet. One is a story people tell. Two — back to back — is a crown.' },
      { speaker: 'dee', line: 'Heard him. It’s iron, partner — it don’t play a single card. We didn’t run this whole route to bank a story.' },
      { speaker: 'king', line: 'Double or nothing — that is still the wording. Run it back and take everything. Lose, and you were never here.' },
    ];
  }
  return [
    { speaker: 'king', line: 'There it is. One win is a story you tell other people. Two is a crown. You have the story.' },
    { speaker: 'dee', line: 'It hurts because it was REAL. We had him once. …So we go again — from the top, both wins, no shortcuts. That was always the deal.' },
    { speaker: 'king', line: 'My door stays open. Kings can wait. The question, as ever, is whether you can.' },
  ];
}
