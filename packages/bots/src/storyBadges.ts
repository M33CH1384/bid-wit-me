/**
 * Story badges (owner, 2026-10-21): a story-only badge set, earned from
 * REAL stored story facts — per-stop attempts/clears, egg finds, feat
 * collectibles, route completion. Every condition reads data the game
 * already records (story_progress / story_finds / the result payload);
 * nothing here invents an earn state. Shown on the win (outro) moment —
 * newly unlocked lit, the rest as the visible remainder with the count —
 * and browsable on the map, tap-for-explanation in both places. Egg badge
 * hints keep the eggs' no-spoiler discipline: a nudge, never directions.
 */
import { STORY_STOPS } from './story';
import { STORY_SECRETS } from './storySecrets';

export interface StoryBadgeFacts {
  stops: { stopId: string; attempts: number; clears: number }[];
  finds: { eggs: string[]; feats: string[] };
  completed: boolean;
}

export interface StoryBadge {
  id: string;
  name: string;
  icon: string;
  /** what this badge is for (shown on tap, earned or not) */
  about: string;
  /** how to unlock it — a fair hint, spoiler-safe for egg badges */
  hint: string;
  earned: boolean;
  /** how/when it was earned, when the facts say (shown on tap when earned) */
  detail?: string;
}

interface BadgeDef {
  id: string; name: string; icon: string; about: string; hint: string;
  test: (f: StoryBadgeFacts, cleared: (stopId: string) => boolean) => string | null; // detail when earned
}

const stopName = (id: string) => STORY_STOPS.find((s) => s.id === id)?.name ?? id;
const clearBadge = (id: string, name: string, icon: string, stopId: string, about: string): BadgeDef => ({
  id, name, icon, about,
  hint: `Clear ${stopName(stopId)} (Stop ${STORY_STOPS.find((s) => s.id === stopId)?.n}).`,
  test: (_f, cleared) => (cleared(stopId) ? `Earned: cleared ${stopName(stopId)}.` : null),
});

const ALL_EGGS = Object.values(STORY_SECRETS).map((s) => s.egg.id);
const NIL_FEATS = ['story-church-pencil', 'story-roof-coin', 'story-pjs-bulb'];
const CLEAN_FEATS = ['story-porch-cap', 'story-king-crown-cap'];

export const STORY_BADGE_DEFS: BadgeDef[] = [
  clearBadge('porch-graduate', 'Porch Graduate', '🎓', 'porch', 'Cleared the Porch — the first table of the route, where Ray and Pat decide if you’re a story or a player.'),
  clearBadge('corner-respect', 'Corner Respect', '🌑', 'corner', 'Cleared the Corner and settled what the table said was owed. Quietly.'),
  clearBadge('halfway-home', 'Halfway Home', '🕯️', 'church-basement', 'Cleared the Church Basement — the halfway mark, where Mae’s own run once stopped.'),
  clearBadge('under-the-lights', 'Under the Lights', '💡', 'the-pjs', 'Cleared the Captains at their own table, under the streetlight that sees everything.'),
  clearBadge('legends-approved', 'Legends Approved', '⭐', 'legends', 'Queenie and Ace opened the last door for you. The guardrail said you were ready.'),
  {
    id: 'king-of-the-block', name: 'King of the Block', icon: '👑',
    about: 'Beat the King and finished the whole route, porch to crown.',
    hint: 'Clear every stop and beat the King of the Block (Stop 11).',
    test: (f) => (f.completed ? 'Earned: the route is complete — the crown is yours.' : null),
  },
  {
    id: 'egg-hunter', name: 'Egg Hunter', icon: '🥚',
    about: 'Found one of the route’s hidden Easter eggs.',
    hint: 'Every stop hides something. Scenes have quiet corners, Dee rewards attention, and some games keep secrets. That’s all you get.',
    test: (f) => (f.finds.eggs.length >= 1 ? `Earned: found ${f.finds.eggs.length === 1 ? 'your first hidden egg' : `${f.finds.eggs.length} hidden eggs`}.` : null),
  },
  {
    id: 'route-archivist', name: 'Route Archivist', icon: '🗝️',
    about: 'Found every Easter egg on the route — all eleven stops’ secrets.',
    hint: 'Eleven stops, eleven secrets. Some hide in scenes, some only happen mid-game, one travels with you. No directions — that’s the game.',
    test: (f) => (ALL_EGGS.every((id) => f.finds.eggs.includes(id)) ? 'Earned: every egg on the route, found.' : null),
  },
  {
    id: 'first-collectible', name: 'First Collectible', icon: '🏆',
    about: 'Earned a stop’s feat collectible — the souvenir that takes more than a clear.',
    hint: 'Every stop card names a feat harder than clearing it. Do one.',
    test: (f) => (f.finds.feats.length >= 1 ? 'Earned: your first feat collectible is on the shelf.' : null),
  },
  {
    id: 'the-collector', name: 'The Collector', icon: '🎖️',
    about: 'Earned six feat collectibles across the route.',
    hint: 'Six stops’ feats. The map card at each stop tells you exactly what its feat asks.',
    test: (f) => (f.finds.feats.length >= 6 ? `Earned: ${f.finds.feats.length} collectibles and counting.` : null),
  },
  {
    id: 'untouchable', name: 'Untouchable', icon: '🛡️',
    about: 'Cleared a table the flawless way — your side never set, start to finish.',
    hint: 'Ray’s bottle cap and the King’s crown cap both ask for a clear with zero sets against you.',
    test: (f) => (CLEAN_FEATS.some((id) => f.finds.feats.includes(id)) ? 'Earned: a no-set clear. The table never touched you.' : null),
  },
  {
    id: 'nil-believer', name: 'Nil Believer', icon: '🙏',
    about: 'Made a nil where the route prices faith highest — Church, Rooftop, or the Pj’s.',
    hint: 'Make a nil at the Church Basement, a blind nil at the Rooftop, or a nil in a winning game at the Pj’s.',
    test: (f) => (NIL_FEATS.some((id) => f.finds.feats.includes(id)) ? 'Earned: a nil, made good, at a table that respects them.' : null),
  },
  {
    id: 'run-it-back', name: 'Run It Back', icon: '🔥',
    about: 'Kept coming back — twelve or more attempts across the route. The retry is the story.',
    hint: 'Play twelve story matches, wins and losses counted together. Losses are free; the route remembers persistence.',
    test: (f) => {
      const total = f.stops.reduce((a, s) => a + s.attempts, 0);
      return total >= 12 ? `Earned: ${total} attempts deep and still running.` : null;
    },
  },
];

export function storyBadgesFor(f: StoryBadgeFacts): StoryBadge[] {
  const clears = new Map(f.stops.map((s) => [s.stopId, s.clears]));
  const cleared = (stopId: string) => (clears.get(stopId) ?? 0) > 0;
  return STORY_BADGE_DEFS.map((d) => {
    const detail = d.test(f, cleared);
    return { id: d.id, name: d.name, icon: d.icon, about: d.about, hint: d.hint, earned: detail !== null, detail: detail ?? undefined };
  });
}

export const storyBadgeCount = (f: StoryBadgeFacts): { earned: number; total: number } => {
  const badges = storyBadgesFor(f);
  return { earned: badges.filter((b) => b.earned).length, total: badges.length };
};
