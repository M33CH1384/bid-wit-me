/**
 * Story Mode (owner brief, 2026-10-21) — the route across the block, as DATA.
 *
 * One definition per stop: venue, adversary pair, house-rule twist, script id,
 * reward tier, difficulty tier. New stops are content, not code: add a row to
 * STORY_STOPS (and its script in storyScripts.ts) and the map, the progress
 * API's unlock math and the solo launcher all pick it up.
 *
 * Characters are built on the existing persona system: each character carries
 * a fixed personaId (see NAME_PERSONA in personas.ts, which pins name →
 * persona), so their recorded voice, talkativeness and play-style lean travel
 * with them everywhere. No new PersonaIds here on purpose — a new persona has
 * no recorded voice sprite, and every character must sound like themselves
 * from their first line.
 *
 * NOTE on the count: the brief's route table lists 9 stops + the boss, while
 * its phasing section (and the Phase 1 order) says "all 11 tables". Stop 10,
 * The Legends' Table, is the added table that makes the route 11: you don't
 * walk straight up to the King — the block's retired legends test you first.
 */
import type { PersonaId } from './personas';
import type { BotSkill } from './bidding';

export type StoryTier =
  | 'gentle' | 'easyPlus' | 'mediumMinus' | 'medium' | 'mediumPlus'
  | 'hardMinus' | 'hard' | 'hardPlus' | 'eliteMinus' | 'elite';

export const STORY_TIER_LABEL: Record<StoryTier, string> = {
  gentle: 'Gentle', easyPlus: 'Easy+', mediumMinus: 'Medium−', medium: 'Medium', mediumPlus: 'Medium+',
  hardMinus: 'Hard−', hard: 'Hard', hardPlus: 'Hard+', eliteMinus: 'Elite−', elite: 'Elite',
};

/** Bot play skill per difficulty tier (the existing bot-skill wiring). */
export const STORY_TIER_SKILL: Record<StoryTier, BotSkill> = {
  gentle: 'novice', easyPlus: 'regular', mediumMinus: 'regular', medium: 'pro', mediumPlus: 'pro',
  hardMinus: 'pro', hard: 'shark', hardPlus: 'shark', eliteMinus: 'shark', elite: 'shark',
};

export interface StoryCharacter {
  id: string;
  /** plate name — also the NAME_PERSONA key that pins this character's persona */
  name: string;
  personaId: PersonaId;
  gender: 'f' | 'm';
  /** one-line character card for the map / script player */
  blurb: string;
}

export const STORY_CHARACTERS: Record<string, StoryCharacter> = {
  dee: { id: 'dee', name: 'Dee', personaId: 'lilcuz', gender: 'f', blurb: 'Your partner for the run. Young, hungry, still learning — and leveling up every stop.' },
  uncleRay: { id: 'uncleRay', name: 'Uncle Ray', personaId: 'comedian', gender: 'm', blurb: 'Funny, warm, teaches by clowning. Been running this porch table since before you were born.' },
  pat: { id: 'pat', name: 'Pat', personaId: 'storyteller', gender: 'f', blurb: "Uncle Ray's partner. Every hand reminds her of a story, and the story is always true." },
  mrColeman: { id: 'mrColeman', name: 'Mr. Coleman', personaId: 'barber', gender: 'm', blurb: 'The barber. Fifty years of textbook Spades and neighborhood history, dispensed between cuts.' },
  june: { id: 'june', name: 'June', personaId: 'og', gender: 'f', blurb: "Mr. Coleman's partner since the shop opened. Quiet, exact, and never once caught guessing." },
  lilMan: { id: 'lilMan', name: "Lil' Man", personaId: 'lilcuz', gender: 'm', blurb: 'Rec Center loudmouth. Talks at full volume, plays at full speed, never stops.' },
  trey: { id: 'trey', name: 'Trey', personaId: 'hype', gender: 'm', blurb: "Lil' Man's hype man and partner. If there's a beat, he's on it. If there isn't, he makes one." },
  keisha: { id: 'keisha', name: 'Keisha', personaId: 'influencer', gender: 'f', blurb: 'One of the Twins. Finishes her sister\u2019s sentences — and her bids.' },
  teisha: { id: 'teisha', name: 'Teisha', personaId: 'petty', gender: 'f', blurb: 'The other Twin. Knows what Keisha is bidding before Keisha does. It\u2019s unsettling.' },
  smoke: { id: 'smoke', name: 'Smoke', personaId: 'smooth', gender: 'm', blurb: 'The Corner runs quiet because Smoke runs it. Cold bidder, nil hunter.' },
  redd: { id: 'redd', name: 'Redd', personaId: 'hothead', gender: 'm', blurb: "Smoke's enforcer. Aggressive bids, short fuse, shorter memory for mercy." },
  deaconFord: { id: 'deaconFord', name: 'Deacon Ford', personaId: 'deacon', gender: 'm', blurb: 'Sweet as pie at the fellowship table. Ruthless the second the cards come out.' },
  sisterMae: { id: 'sisterMae', name: 'Sister Mae', personaId: 'coach', gender: 'f', blurb: 'Runs the Church Basement like a practice. "Bless your heart" means you are already set.' },
  poet: { id: 'poet', name: 'Poet', personaId: 'conspiracy', gender: 'm', blurb: 'Speaks in riddles and half-finished prophecies. Somehow the cards keep proving him right.' },
  seven: { id: 'seven', name: 'Seven', personaId: 'silent', gender: 'm', blurb: 'Hasn\u2019t spoken since 2019. Hasn\u2019t needed to.' },
  velvet: { id: 'velvet', name: 'Velvet', personaId: 'hustler', gender: 'f', blurb: 'High-Rise money energy. A card sharp in evening wear — every smile is a tell she planted.' },
  accountant: { id: 'accountant', name: 'The Accountant', personaId: 'professor', gender: 'm', blurb: 'A human calculator. Counts every card, every bag, every point you owe the table.' },
  captainBlock: { id: 'captainBlock', name: 'Captain Block', personaId: 'coach', gender: 'm', blurb: 'Captain of the Pj\u2019s all-stars. Earned the chair; defends it like a title.' },
  brick: { id: 'brick', name: 'Brick', personaId: 'silent', gender: 'f', blurb: 'The other Block Captain. Doesn\u2019t talk. Doesn\u2019t blink. Doesn\u2019t lose at home.' },
  queenie: { id: 'queenie', name: 'Queenie', personaId: 'mama', gender: 'f', blurb: 'A retired legend of the block. Ran this route before it was a route.' },
  ace: { id: 'ace', name: 'Ace', personaId: 'gambler', gender: 'm', blurb: 'The other legend. Quit counting his wins sometime in the nineties.' },
  king: { id: 'king', name: 'The King', personaId: 'og', gender: 'm', blurb: 'The King of the Block. Undefeated since the lights went out in \u201903 — or so the story goes.' },
  ringer: { id: 'ringer', name: 'The Ringer', personaId: 'silent', gender: 'm', blurb: 'The King\u2019s partner. Nobody knows his name. Nobody has ever needed it twice.' },
};

/** Dee, your solo partner. */
export const DEE: StoryCharacter = STORY_CHARACTERS.dee!;

/**
 * Dee's play skill by stop number (1-based): she literally levels up stop to
 * stop — early Dee is a nervous Novice, late Dee calls shots like a Shark.
 */
export function deeSkillForStop(stopNumber: number): BotSkill {
  if (stopNumber <= 2) return 'novice';
  if (stopNumber <= 4) return 'regular';
  if (stopNumber <= 7) return 'pro';
  return 'shark';
}

export interface StoryTwist {
  /** the one-line twist shown on the map and at the table */
  label: string;
  mode?: 'joker' | 'aceDown';
  /** race target (default: the mode's standard target) */
  targetScore?: number;
  bidTimerSec?: number;
  playTimerSec?: number;
  /** nil contract value (standard 100; the Church Basement doubles it) */
  nilValue?: number;
  /** blind nil: 'always' lifts the behind-by-100 gate; value overrides the standard 200 */
  blindNil?: { availability: 'behind100' | 'always'; value?: number };
}

export interface StoryStop {
  id: string;
  /** 1-based position on the route */
  n: number;
  name: string;
  /** venue id (apps/web venues / protocol VENUES) */
  venueId: string;
  /** the adversary pair, in seat order (seat 1, then seat 3) */
  pair: [string, string];
  flavor: string;
  twist: StoryTwist;
  tier: StoryTier;
}

export const STORY_STOPS: StoryStop[] = [
  { id: 'porch', n: 1, name: 'The Porch', venueId: 'grandma', pair: ['uncleRay', 'pat'], flavor: 'Funny, warm — the table that teaches you by clowning you.', twist: { label: 'Race to 250 · Chill timers', targetScore: 250, bidTimerSec: 45, playTimerSec: 45 }, tier: 'gentle' },
  { id: 'barbershop', n: 2, name: 'The Barbershop', venueId: 'barbershop', pair: ['mrColeman', 'june'], flavor: 'Historic — old-heads, textbook Spades, stories between hands.', twist: { label: 'Ace Down — no jokers', mode: 'aceDown' }, tier: 'easyPlus' },
  { id: 'rec-center', n: 3, name: 'The Rec Center', venueId: 'classic', pair: ['lilMan', 'trey'], flavor: 'Annoying — loud, fast, and they never, ever stop talking.', twist: { label: 'Fast timers — 20s to bid, 20s to play', bidTimerSec: 20, playTimerSec: 20 }, tier: 'mediumMinus' },
  { id: 'cookout', n: 4, name: 'The Cookout', venueId: 'backyard', pair: ['keisha', 'teisha'], flavor: 'Weird — the Twins finish each other\u2019s sentences and bids.', twist: { label: 'Standard Joker table' }, tier: 'medium' },
  { id: 'corner', n: 5, name: 'The Corner', venueId: 'speakeasy', pair: ['smoke', 'redd'], flavor: 'Dangerous — quiet, cold, aggressive. They hunt nils for sport.', twist: { label: 'Race to 500', targetScore: 500 }, tier: 'mediumPlus' },
  { id: 'church-basement', n: 6, name: 'The Church Basement', venueId: 'church', pair: ['deaconFord', 'sisterMae'], flavor: 'Sweet as pie, ruthless underneath. "Bless your heart" is a warning.', twist: { label: 'Nils worth double — 200', nilValue: 200 }, tier: 'hardMinus' },
  { id: 'rooftop', n: 7, name: 'The Rooftop', venueId: 'rooftop', pair: ['poet', 'seven'], flavor: 'Weird — one speaks in riddles, one hasn\u2019t spoken since 2019.', twist: { label: 'Blind nils always on, worth 300', blindNil: { availability: 'always', value: 300 } }, tier: 'hard' },
  { id: 'high-rise', n: 8, name: 'The High-Rise', venueId: 'mansion', pair: ['velvet', 'accountant'], flavor: 'Dangerous — a card sharp and a human calculator, playing for money energy.', twist: { label: 'Race to 500', targetScore: 500 }, tier: 'hardPlus' },
  { id: 'the-pjs', n: 9, name: "The Pj's", venueId: 'blockAfterDark', pair: ['captainBlock', 'brick'], flavor: 'Home turf\u2019s finest — the venue\u2019s own all-stars, under the streetlight.', twist: { label: "The Pj's venue rules — standard Joker to 500", targetScore: 500 }, tier: 'eliteMinus' },
  { id: 'legends', n: 10, name: "The Legends' Table", venueId: 'vegas', pair: ['queenie', 'ace'], flavor: 'The retired legends. Nobody sits with the King until Queenie and Ace say so.', twist: { label: 'Race to 500 — legends\u2019 rules', targetScore: 500 }, tier: 'eliteMinus' },
  { id: 'king', n: 11, name: 'The King of the Block', venueId: 'blockAfterDark', pair: ['king', 'ringer'], flavor: 'The legend the Level 50 title is named for. Undefeated since \u201903.', twist: { label: 'Full game to 750', targetScore: 750 }, tier: 'elite' },
];

export const storyStopById = (id: string): StoryStop | undefined => STORY_STOPS.find((s) => s.id === id);
export const storyStopByNumber = (n: number): StoryStop | undefined => STORY_STOPS.find((s) => s.n === n);

/** The final stop (the King). Clearing it on a track completes that track. */
export const STORY_FINAL_STOP: StoryStop = STORY_STOPS[STORY_STOPS.length - 1]!;

/**
 * First-clear rewards scale with the stop: stop n pays n × the base in XP and
 * coins (plus the clear is what unlocks the next stop — the real prize).
 * Replays pay a small upkeep only, never the clear reward twice.
 */
export const STORY_REWARD_BASE = { xp: 25, coins: 20 } as const;
export const STORY_REPLAY_REWARD = { xp: 10, coins: 5 } as const;

export function storyReward(stopNumber: number, firstClear: boolean): { xp: number; coins: number } {
  if (!firstClear) return { ...STORY_REPLAY_REWARD };
  return { xp: STORY_REWARD_BASE.xp * stopNumber, coins: STORY_REWARD_BASE.coins * stopNumber };
}

/** Sequential unlock: stop n is unlocked on a track when every earlier stop is cleared there. */
export function storyStopUnlocked(stopNumber: number, clearedStopNumbers: ReadonlySet<number>): boolean {
  for (let i = 1; i < stopNumber; i++) if (!clearedStopNumbers.has(i)) return false;
  return true;
}

/** The current stop of a track: the first uncleared stop, or null when the route is complete. */
export function storyCurrentStop(clearedStopNumbers: ReadonlySet<number>): number | null {
  for (const s of STORY_STOPS) if (!clearedStopNumbers.has(s.n)) return s.n;
  return null;
}

export type StoryStopState = 'cleared' | 'current' | 'locked';
export function storyStopState(stopNumber: number, clearedStopNumbers: ReadonlySet<number>): StoryStopState {
  if (clearedStopNumbers.has(stopNumber)) return 'cleared';
  return storyStopUnlocked(stopNumber, clearedStopNumbers) ? 'current' : 'locked';
}

/**
 * Track keys (Phase 2-ready): 'solo' for the solo run with Dee; a co-op pair
 * track is 'pair:<uidA>:<uidB>' with the two user ids sorted, so the same pair
 * always lands on the same track from either side. Phase 1 plays solo only —
 * the key shape is fixed now so pair tracks need no storage rewrite later.
 */
export const STORY_SOLO_TRACK = 'solo';
export function storyPairTrackKey(uidA: string, uidB: string): string {
  const [a, b] = [uidA, uidB].sort();
  return `pair:${a}:${b}`;
}
export function storyTrackKeyValid(key: unknown): key is string {
  if (key === STORY_SOLO_TRACK) return true;
  if (typeof key !== 'string') return false;
  const m = /^pair:([^:]{1,64}):([^:]{1,64})$/.exec(key);
  return !!m && m[1] !== m[2];
}
