/**
 * The King's double or nothing (owner, 2026-10-21): the between-legs
 * set-pieces. Deliberately SHORT — the King names the terms, Dee answers,
 * and the player is back at the table (or the walk-away is honored in a
 * breath). These are not scenes; they are the moment between two games,
 * played in the dialogue channel on the between-legs screen.
 */
import type { StoryBeat } from './storyScripts';

export type KingDoubleMoment = 'started' | 'lost';

export function kingDoubleBeats(moment: KingDoubleMoment): StoryBeat[] {
  if (moment === 'started') {
    return [
      { speaker: 'king', line: 'Once. …Twenty-two years, and nobody has ever beaten me twice in a row. You knew the terms when you sat down: double or nothing.' },
      { speaker: 'dee', line: 'We did not run this whole route to bank HALF a crown. Say the word, partner — or that first win never happened.' },
      { speaker: 'king', line: 'The table is still warm. Run it back and take everything. Lose, and you were never here.' },
    ];
  }
  return [
    { speaker: 'king', line: 'There it is. One win is a story you tell other people. Two is a crown. You have the story.' },
    { speaker: 'dee', line: 'It hurts because it was REAL. We had him once. …So we go again — from the top, both wins, no shortcuts. That was always the deal.' },
    { speaker: 'king', line: 'My door stays open. Kings can wait. The question, as ever, is whether you can.' },
  ];
}
