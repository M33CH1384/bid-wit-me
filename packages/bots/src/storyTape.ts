/**
 * Story Tale of the Tape (owner, 2026-10-21): the Big Bank tape's shape,
 * filled with NARRATIVE context instead of player stats — who each
 * character is, what they're known for, their honest table tell, and the
 * bond the scene plays on. The stakes line is the stop's own. Dee's entry
 * EVOLVES with the route (banded by stop number — stored-fact-driven via
 * the same facts the scene selector uses). One history row, and only when
 * a stored fact (attempts/clears at this stop) supports it: no fabricated
 * records, no invented numbers for bots. Threat is design data, in plain
 * language.
 */
import { STORY_CHARACTERS, STORY_TIER_LABEL, STORY_TIER_SKILL, type StoryStop } from './story';
import type { StoryBeatFacts } from './storyScripts';

export interface StoryTapeEntry {
  id: string;
  name: string;
  role: string;
  who: string;
  knownFor: string;
  style: string;
  bond: string;
}

export interface StoryTape {
  stopId: string;
  stakes: string;
  threat: string;
  /** present ONLY when a stored fact supports it */
  history?: string;
  you: StoryTapeEntry;
  dee: StoryTapeEntry;
  pair: [StoryTapeEntry, StoryTapeEntry];
}

const THREAT_BY_SKILL: Record<string, string> = {
  novice: 'they’ll teach you — if you let them',
  regular: 'seasoned hands; no free books here',
  pro: 'they take runs apart for a living',
  shark: 'legends of the game — bring your best hand of the route',
};

/** Dee's tape voice by route band — she is a different entry late than early. */
export function deeTapeFor(stopNumber: number): { knownFor: string; style: string } {
  if (stopNumber <= 3) return {
    knownFor: 'Being the kid from Ray’s porch with something to prove.',
    style: 'Watch for: a learner’s caution — she counts twice and bids once.',
  };
  if (stopNumber <= 7) return {
    knownFor: 'Finishing reads she used to ask about. The route is starting to say her name right.',
    style: 'Watch for: growing nerve — she calls her own shots now, mostly.',
  };
  return {
    knownFor: 'Being the reason pairs warn each other about the quiet seat.',
    style: 'Watch for: a shark in a familiar face. She plays like she belongs, because she does.',
  };
}

const entryFor = (id: string): StoryTapeEntry => {
  const c = STORY_CHARACTERS[id]!;
  return { id, name: c.name, role: c.role, who: c.tape.who, knownFor: c.tape.knownFor, style: c.tape.style, bond: c.tape.bond };
};

export function buildStoryTape(stop: StoryStop, facts: StoryBeatFacts): StoryTape {
  const dee = entryFor('dee');
  const band = deeTapeFor(stop.n);
  dee.knownFor = band.knownFor;
  dee.style = band.style;
  let history: string | undefined;
  if (facts.cleared) {
    history = `You hold this table — cleared ${facts.clears ?? 1}×. They remember it too.`;
  } else if (facts.attempts > 0) {
    history = `Last meeting: they turned you back. This is attempt ${facts.attempts + 1}.`;
  }
  return {
    stopId: stop.id,
    stakes: stop.stakes,
    threat: `${STORY_TIER_LABEL[stop.tier]} table · Threat: ${THREAT_BY_SKILL[STORY_TIER_SKILL[stop.tier]] ?? ''}`,
    history,
    you: {
      id: 'you', name: 'You', role: 'The one running the route',
      who: 'Nobody on the block knows your ceiling yet. That is the only fact anyone here agrees on.',
      knownFor: 'Showing up. So far, that’s the whole file.',
      style: 'Watch for: whatever you brought with you. The table will find out at the same time you do.',
      bond: 'Dee chose to ride with you. The route is grading that choice, too.',
    },
    dee,
    pair: [entryFor(stop.pair[0]), entryFor(stop.pair[1])],
  };
}
