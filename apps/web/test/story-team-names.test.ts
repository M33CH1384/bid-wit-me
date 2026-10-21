/**
 * @vitest-environment happy-dom
 *
 * Story team names (owner, 2026-10-21): a story match is billed as the people
 * actually sitting at the table — "You & Dee" against the stop's seated pair
 * ("Uncle Ray & Pat") — never the generic defaults. The mechanism that leaked:
 * Table's offline team names are the player's retired global name (his was
 * "Homies") for his side and pickTeamName(seed) from TEAM_NAME_POOL for the
 * bots (his Porch draw was "Club Kids" / "Smooth Operators"). The story flow
 * seated named characters but never overrode the billing, so the pool names
 * surfaced on the scorebug, the win screen and the box score (all of which
 * read sideName() ← Table's teamNames). The fix scopes to the story seam:
 * Table derives story team names from the stop, and only for story games.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STORY_CHARACTERS, STORY_STOPS } from '@spades/bots';
import { TEAM_NAME_MAX, TEAM_NAME_POOL } from '@spades/protocol';
import { storyPairLabel, storyTeamNames } from '../src/story/storySettings';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const labelOf = (id: string) => STORY_CHARACTERS[id]!.shortName ?? STORY_CHARACTERS[id]!.name;

describe('story team names come from the stop', () => {
  it('your side is always You & Dee — the run’s own pairing', () => {
    for (const stop of STORY_STOPS) expect(storyTeamNames(stop)[0]).toBe('You & Dee');
  });

  it('the opposing side is the seated pair’s own names, at all 11 stops', () => {
    for (const stop of STORY_STOPS) {
      expect(storyPairLabel(stop)).toBe(`${labelOf(stop.pair[0])} & ${labelOf(stop.pair[1])}`);
      expect(storyTeamNames(stop)[1]).toBe(storyPairLabel(stop));
    }
  });

  it('the Porch bills Ray & Pat — the screenshot case', () => {
    const porch = STORY_STOPS.find((s) => s.id === 'porch')!;
    expect(storyTeamNames(porch)).toEqual(['You & Dee', 'Uncle Ray & Pat']);
  });

  it('long names take their short label form so the scorebar fits', () => {
    const byId = Object.fromEntries(STORY_STOPS.map((s) => [s.id, storyPairLabel(s)]));
    expect(byId['church-basement']).toBe('Deacon & Sister Mae');
    expect(byId['high-rise']).toBe('Velvet & Accountant');
    expect(byId['the-pjs']).toBe('Capt. Block & Brick');
    expect(byId['king']).toBe('The King & Ringer');
  });

  it('every story label fits the team-name width', () => {
    for (const stop of STORY_STOPS) {
      for (const label of storyTeamNames(stop)) {
        expect(Array.from(label).length).toBeLessThanOrEqual(TEAM_NAME_MAX);
      }
    }
  });

  it('no story label is a generic pool name or the retired global default', () => {
    for (const stop of STORY_STOPS) {
      for (const label of storyTeamNames(stop)) {
        expect(TEAM_NAME_POOL).not.toContain(label);
        expect(label).not.toBe('Homies');
      }
    }
  });

  it('names derive from the stop alone — a resumed game re-derives identical names', () => {
    for (const stop of STORY_STOPS) {
      expect(storyTeamNames(stop)).toEqual(storyTeamNames(stop));
      expect(storyTeamNames(stop)).toEqual(storyTeamNames({ ...stop }));
    }
  });
});

describe('table wiring: the story override scopes to story games only', () => {
  const table = read('../src/Table.tsx');

  it('Table derives story team names from the stop when a story scene is seated', () => {
    expect(table).toContain('storyTeamNames(story.scene.stop)');
    expect(table).toContain('storyTeams ?? [myName || null, botTeam]');
  });

  it('the normal offline defaults are untouched as the non-story path', () => {
    expect(table).toContain('pickTeamName(');
    expect(table).toContain('[myName || null, botTeam]');
    // one feed for every surface that prints a side name (scorebug, results, box score, pad)
    expect(table).toContain('setTeamNames(teamNames)');
  });

  it('the loader/versus header names the stop, not the venue asset', () => {
    expect(table).toContain('storyRoomLabel ?? roomName');
    expect(table).toContain('Stop ${story.scene.stop.n} of ${STORY_STOPS.length}');
  });
});
