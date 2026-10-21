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
