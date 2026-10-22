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
import type { DensityClass } from './talk';
import { makeRules, type RulesOverrides, type TableRules } from '@spades/rules';

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
  /** short label form for tight team names (scorebug / versus pair labels):
   *  used where the full name would push a pair label past the team-name
   *  width — "Deacon & Sister Mae", not "Deacon Ford & Sister Mae" */
  shortName?: string;
  personaId: PersonaId;
  gender: 'f' | 'm';
  /** short role line for the scene cast strip: who this person IS, at a glance
   *  (identity legibility — the player should never have to guess) */
  role: string;
  /** one-line character card for the map / script player */
  blurb: string;
  /** Tale of the Tape context (owner, 2026-10-21): who they are, their
   *  reputation, their honest table tell, and their bond to their partner.
   *  Dee's knownFor/style are banded by route progress at render time —
   *  see deeTapeFor in storyTape.ts. */
  tape: { who: string; knownFor: string; style: string; bond: string };
}

/**
 * Portrait art path for a story character (art pass convention, 2026-10-21):
 * /assets/story/portraits/<characterId>.webp. Surfaces render the image
 * with the initial medallion as fallback — if the art has not landed yet,
 * the medallion is exactly what shows, with no broken-image affordance.
 */
export const storyPortraitFor = (characterId: string): string => `/assets/story/portraits/${characterId}.webp`;

export const STORY_CHARACTERS: Record<string, StoryCharacter> = {
  dee: { id: 'dee', name: 'Dee', personaId: 'lilcuz', gender: 'f', role: 'Your partner on the run', blurb: 'Your partner for the run. Young, hungry, still learning — and leveling up every stop.', tape: { who: 'Ray’s late friend’s daughter — grew up counting books at other people’s tables.', knownFor: 'Being the kid from Ray’s porch with something to prove.', style: 'Watch for: a learner’s caution — she counts twice and bids once.', bond: 'Your partner for the whole run. Her name is on this route too.' } },
  uncleRay: { id: 'uncleRay', name: 'Uncle Ray', personaId: 'comedian', gender: 'm', role: 'Porch host — runs this table', blurb: 'Funny, warm, teaches by clowning. Been running this porch table since before you were born.', tape: { who: 'Forty years on this porch; half the block learned cards within earshot of his radio.', knownFor: 'Never hurrying, never losing the thread of a hand — or of a story.', style: 'Watch for: patience that is actually a trap. Bids low, books high.', bond: 'Pat’s husband. She keeps his score, and his stories, honest.' } },
  pat: { id: 'pat', name: 'Pat', personaId: 'storyteller', gender: 'f', role: 'Uncle Ray\u2019s wife — the porch historian', blurb: "Uncle Ray's partner. Every hand reminds her of a story, and the story is always true.", tape: { who: 'The porch historian — keeps every score in pencil and every story verbatim.', knownFor: 'Remembering exactly what you bid three hands ago. And three years ago.', style: 'Watch for: she reads people before cards, and her nils are family decisions.', bond: 'Uncle Ray’s wife. She runs the porch; he just lives on it (her words).' } },
  mrColeman: { id: 'mrColeman', name: 'Mr. Coleman', personaId: 'barber', gender: 'm', role: 'The barber — fifty years behind that chair', blurb: 'The barber. Fifty years of textbook Spades and neighborhood history, dispensed between cuts.', tape: { who: 'Retired teacher; the barbershop is the block’s last classroom.', knownFor: 'Dealing lessons disguised as haircuts — and turning nobody away, ever.', style: 'Watch for: textbook discipline. No jokers in his shop, no gifts at his table.', bond: 'June’s husband. She shortens his lessons when they get too fond of themselves.' } },
  june: { id: 'june', name: 'June', personaId: 'og', gender: 'f', role: 'His table partner since the shop opened', blurb: "Mr. Coleman's partner since the shop opened. Quiet, exact, and never once caught guessing.", tape: { who: 'Runs the shop’s second chair and its entire memory.', knownFor: 'Knowing whose grandfather sat where — and what he owed.', style: 'Watch for: fast, warm, exact. She bids what the mirrors show her.', bond: 'Coleman’s wife; finishes his sentences only when he’s wrong, and logs those too.' } },
  lilMan: { id: 'lilMan', name: "Lil' Man", personaId: 'lilcuz', gender: 'm', role: 'Rec Center loudmouth', blurb: 'Rec Center loudmouth. Talks at full volume, plays at full speed, never stops.', tape: { who: 'The loudest graduate the Rec ever produced — works there now, officially.', knownFor: 'Volume as a strategy. He has never lost an argument with a clock.', style: 'Watch for: blur bidding — he bets on momentum before the cards finish speaking.', bond: 'Trey is his echo and his brake. The echo usually wins.' } },
  trey: { id: 'trey', name: 'Trey', personaId: 'hype', gender: 'm', role: 'Lil\u2019 Man\u2019s hype man', blurb: "Lil' Man's hype man and partner. If there's a beat, he's on it. If there isn't, he makes one.", tape: { who: 'Rec Center staff; Lil’ Man’s partner and personal subtitle.', knownFor: 'Saying the quiet part at full volume, one beat late.', style: 'Watch for: he repeats the bid louder — and somehow that IS the strategy.', bond: 'Lil’ Man’s right hand. Nobody has seen them disagree about anything but rest.' } },
  keisha: { id: 'keisha', name: 'Keisha', personaId: 'influencer', gender: 'f', role: 'One of the Twins', blurb: 'One of the Twins. Finishes her sister\u2019s sentences — and her bids.', tape: { who: 'Half of the Twins; the cookout is their mother’s, and so is the test.', knownFor: 'Finishing her sister’s sentences — and the block’s plates.', style: 'Watch for: partnership telepathy. She bids for two like it’s one hand.', bond: 'Teisha’s twin. Cover one of them and you have covered neither.' } },
  teisha: { id: 'teisha', name: 'Teisha', personaId: 'petty', gender: 'f', role: 'The other Twin', blurb: 'The other Twin. Knows what Keisha is bidding before Keisha does. It\u2019s unsettling.', tape: { who: 'Half of the Twins; judges a partnership by whether it covers.', knownFor: 'Serving dessert and verdicts at the same time.', style: 'Watch for: she plays her sister’s hand as carefully as her own.', bond: 'Keisha’s twin. The cookout was their classroom; family is the curriculum.' } },
  smoke: { id: 'smoke', name: 'Smoke', personaId: 'smooth', gender: 'm', role: 'Runs the Corner', blurb: 'The Corner runs quiet because Smoke runs it. Cold bidder, nil hunter.', tape: { who: 'The Corner’s quiet half. Dee’s daddy owed this table, and the debt outlived him.', knownFor: 'Settling accounts without raising his voice — or his eyes.', style: 'Watch for: he counts everything, and bets like the count is the conversation.', bond: 'Redd is the warning. Smoke is what the warning means.' } },
  redd: { id: 'redd', name: 'Redd', personaId: 'hothead', gender: 'm', role: 'Smoke\u2019s enforcer', blurb: "Smoke's enforcer. Aggressive bids, short fuse, shorter memory for mercy.", tape: { who: 'The Corner’s voice — about one line an hour, and all of them land.', knownFor: 'Fencing, patience, and knowing a debt the moment it walks in.', style: 'Watch for: minimal bids, maximal reads. He lets Smoke do the arithmetic.', bond: 'Smoke’s partner. Out here, his silence is a shared language.' } },
  deaconFord: { id: 'deaconFord', name: 'Deacon Ford', shortName: 'Deacon', personaId: 'deacon', gender: 'm', role: 'The Deacon', blurb: 'Sweet as pie at the fellowship table. Ruthless the second the cards come out.', tape: { who: 'Deacon of the church upstairs; basement champion of long standing.', knownFor: 'Sermons that take requests, and games that take prisoners.', style: 'Watch for: methodical nils — a hundred a side, preached and practiced.', bond: 'Mae’s partner in the basement. She outranks him there and they both know it.' } },
  sisterMae: { id: 'sisterMae', name: 'Sister Mae', personaId: 'coach', gender: 'f', role: 'Church mother — runs the basement table', blurb: 'Runs the Church Basement like a practice. "Bless your heart" means you are already set.', tape: { who: 'Ran this route herself, decades ago — stopped one stop short and never said why. Until now.', knownFor: 'Lemonade, ledgers, and second sight about young players.', style: 'Watch for: she covers partners like family. Her faith bids are calculated, not hopeful.', bond: 'The Deacon’s partner — and the basement’s real authority.' } },
  poet: { id: 'poet', name: 'Poet', personaId: 'conspiracy', gender: 'm', role: 'Rooftop philosopher', blurb: 'Speaks in riddles and half-finished prophecies. Somehow the cards keep proving him right.', tape: { who: 'Rooftop laureate; deals in omens that keep coming true.', knownFor: 'Calling the game before it happens, in verse.', style: 'Watch for: meaning-loaded bids. He listens to a hand like weather.', bond: 'Seven is his translator, his witness, and his whole audience.' } },
  seven: { id: 'seven', name: 'Seven', personaId: 'silent', gender: 'm', role: 'The quiet one', blurb: 'Hasn\u2019t spoken since 2019. Hasn\u2019t needed to.', tape: { who: 'Says almost nothing; the rooftop treats his rare words as rulings.', knownFor: 'A nod the whole block accepts as currency.', style: 'Watch for: blind nils like scripture — stillness you can bid on.', bond: 'Poet’s partner. The words are Poet’s; the weight is Seven’s.' } },
  velvet: { id: 'velvet', name: 'Velvet', personaId: 'hustler', gender: 'f', role: 'High-Rise card sharp', blurb: 'High-Rise money energy. A card sharp in evening wear — every smile is a tell she planted.', tape: { who: 'Left this street with forty dollars. Came back owning the view.', knownFor: 'Reading a face before it finishes lying.', style: 'Watch for: positional, patient, expensive. Every bid is priced.', bond: 'The Accountant keeps her numbers. Nobody keeps Velvet.' } },
  accountant: { id: 'accountant', name: 'The Accountant', shortName: 'Accountant', personaId: 'professor', gender: 'm', role: 'Her partner — the human calculator', blurb: 'A human calculator. Counts every card, every bag, every point you owe the table.', tape: { who: 'Prices everything, including people — especially the variable.', knownFor: 'Knowing what a climber is worth before the climber does.', style: 'Watch for: he speaks in ledgers, and his nil math has ended more runs than any pair alive.', bond: 'Velvet’s partner by contract and by genuine respect — the only two currencies here.' } },
  captainBlock: { id: 'captainBlock', name: 'Captain Block', shortName: 'Capt. Block', personaId: 'coach', gender: 'm', role: 'Captain of the Pj\u2019s all-stars', blurb: 'Captain of the Pj\u2019s all-stars. Earned the chair; defends it like a title.', tape: { who: 'Holds the Captains’ table under the streetlight — fell at the Legends in his own run and took the door instead.', knownFor: 'Twenty years of first looks. Nothing crosses his fence unpriced.', style: 'Watch for: territorial and exact — home-table rules, enforced like weather.', bond: 'Brick is his wall. He is her reason the wall has a gate.' } },
  brick: { id: 'brick', name: 'Brick', personaId: 'silent', gender: 'f', role: 'The other Block Captain', blurb: 'The other Block Captain. Doesn\u2019t talk. Doesn\u2019t blink. Doesn\u2019t lose at home.', tape: { who: 'The silent muscle of the Pj’s. Speaks in blinks, counted carefully by the Captain.', knownFor: 'Never reacting — twice, supposedly, in twenty years.', style: 'Watch for: she plays like a fence — nothing through, nothing explained.', bond: 'The Captain’s partner. Her loyalty is the loudest thing on the street.' } },
  queenie: { id: 'queenie', name: 'Queenie', personaId: 'mama', gender: 'f', role: 'Retired legend of the block', blurb: 'A retired legend of the block. Ran this route before it was a route.', tape: { who: 'Beat Vegas in ’87 and has stayed gracious about it for fifty years.', knownFor: 'Reading the spaces between plays; retiring decks and doubters.', style: 'Watch for: grace at full strength — a shark with table manners.', bond: 'Ace is her mirror and her archive. They dealt the King himself, once.' } },
  ace: { id: 'ace', name: 'Ace', personaId: 'gambler', gender: 'm', role: 'Retired legend — Queenie\u2019s partner', blurb: 'The other legend. Quit counting his wins sometime in the nineties.', tape: { who: 'Queenie’s partner. Dealt the night the lights went out in ’03 — and said nothing then, either.', knownFor: 'Hands that have forgotten nothing. A cut like a signature.', style: 'Watch for: precise to the card. He gambles only on people, and is rarely wrong.', bond: 'Queenie’s other half of the sentence the Legends speak in.' } },
  king: { id: 'king', name: 'The King', personaId: 'og', gender: 'm', role: 'The King of the Block', blurb: 'The King of the Block. Undefeated since the lights went out in \u201903 — or so the story goes.', tape: { who: 'Undefeated since ’03 and bored since ’04. Keeps the old room open for one worthy game.', knownFor: 'Ending runs, reigns, and arguments — usually in that order.', style: 'Watch for: he plays the cards, not the name, and expects the same of you.', bond: 'The Ringer is his shadow and his insurance. Even the King insures.' } },
  ringer: { id: 'ringer', name: 'The Ringer', shortName: 'Ringer', personaId: 'silent', gender: 'm', role: 'The King\u2019s partner — nobody knows his name', blurb: 'The King\u2019s partner. Nobody knows his name. Nobody has ever needed it twice.', tape: { who: 'The King’s brought-in hand. Nobody on the route knows his real name — possibly including him.', knownFor: 'Stillness that makes tables confess.', style: 'Watch for: unknown — that IS the style. The archive has no page for him.', bond: 'The King’s partner. Loyalty that was purchased once and became real somewhere along the way.' } },
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
  /** the stake at this table — the same tension the intro scene plays;
   *  shown on the Tale of the Tape and the map card */
  stakes: string;
  flavor: string;
  twist: StoryTwist;
  tier: StoryTier;
  /**
   * The clear must be earned twice in a row (the King's double or
   * nothing): a first win banks nothing and opens a pending second leg;
   * only the second consecutive win clears — for double the first-clear
   * reward. Losing the second leg voids both legs.
   */
  doubleOrNothing?: boolean;
}

export const STORY_STOPS: StoryStop[] = [
  { id: 'porch', n: 1, name: 'The Porch', venueId: 'grandma', pair: ['uncleRay', 'pat'], stakes: 'Dee plays her first real table — Ray’s porch decides whether she’s a story or a player.', flavor: 'Funny, warm — the table that teaches you by clowning you.', twist: { label: 'Race to 250 · Chill timers', targetScore: 250, bidTimerSec: 45, playTimerSec: 45 }, tier: 'gentle' },
  { id: 'barbershop', n: 2, name: 'The Barbershop', venueId: 'barbershop', pair: ['mrColeman', 'june'], stakes: 'Coleman’s book says the route’s students stall here. Dee’s name is already penciled in the margin.', flavor: 'Historic — old-heads, textbook Spades, stories between hands.', twist: { label: 'Ace Down — no jokers', mode: 'aceDown' }, tier: 'easyPlus' },
  { id: 'rec-center', n: 3, name: 'The Rec Center', venueId: 'classic', pair: ['lilMan', 'trey'], stakes: 'Lil’ Man beat Dee the summer she stopped showing up. This table is personal.', flavor: 'Annoying — loud, fast, and they never, ever stop talking.', twist: { label: 'Fast timers — 20s to bid, 20s to play', bidTimerSec: 20, playTimerSec: 20 }, tier: 'mediumMinus' },
  { id: 'cookout', n: 4, name: 'The Cookout', venueId: 'backyard', pair: ['keisha', 'teisha'], stakes: 'The Twins test whether you two cover each other — Mama’s standard, no substitutes.', flavor: 'Weird — the Twins finish each other\u2019s sentences and bids.', twist: { label: 'Standard Joker table' }, tier: 'medium' },
  { id: 'corner', n: 5, name: 'The Corner', venueId: 'speakeasy', pair: ['smoke', 'redd'], stakes: 'Dee’s daddy owed this corner. The bill comes due at this table, one way or the other.', flavor: 'Dangerous — quiet, cold, aggressive. They hunt nils for sport.', twist: { label: 'Race to 500', targetScore: 500 }, tier: 'mediumPlus' },
  { id: 'church-basement', n: 6, name: 'The Church Basement', venueId: 'church', pair: ['deaconFord', 'sisterMae'], stakes: 'Mae stopped one stop short of her own run’s end, decades back. Dee is finishing what she couldn’t.', flavor: 'Sweet as pie, ruthless underneath. "Bless your heart" is a warning.', twist: { label: 'Nils worth double — 200', nilValue: 200 }, tier: 'hardMinus' },
  { id: 'rooftop', n: 7, name: 'The Rooftop', venueId: 'rooftop', pair: ['poet', 'seven'], stakes: 'Poet has already called how this ends. Seven’s nod will decide whether he was right.', flavor: 'Weird — one speaks in riddles, one hasn\u2019t spoken since 2019.', twist: { label: 'Blind nils always on, worth 300', blindNil: { availability: 'always', value: 300 } }, tier: 'hard' },
  { id: 'high-rise', n: 8, name: 'The High-Rise', venueId: 'mansion', pair: ['velvet', 'accountant'], stakes: 'Velvet left Dee’s street with forty dollars. The Accountant has priced what Dee became instead.', flavor: 'Dangerous — a card sharp and a human calculator, playing for money energy.', twist: { label: 'Race to 500', targetScore: 500 }, tier: 'hardPlus' },
  { id: 'the-pjs', n: 9, name: "The Pj's", venueId: 'blockAfterDark', pair: ['captainBlock', 'brick'], stakes: 'The Captain holds this door because the Legends closed his. Under this light, names get made — or unmade.', flavor: 'Home turf\u2019s finest — the venue\u2019s own all-stars, under the streetlight.', twist: { label: "The Pj's venue rules — standard Joker to 500", targetScore: 500 }, tier: 'eliteMinus' },
  { id: 'legends', n: 10, name: "The Legends' Table", venueId: 'vegas', pair: ['queenie', 'ace'], stakes: 'In ’03 they sent an unready kid to the King. Queenie and Ace are the guardrail now: pass, or be protected from what’s next.', flavor: 'The retired legends. Nobody sits with the King until Queenie and Ace say so.', twist: { label: 'Race to 500 — legends\u2019 rules', targetScore: 500 }, tier: 'eliteMinus' },
  { id: 'king', n: 11, name: 'The King of the Block', venueId: 'blockAfterDark', pair: ['king', 'ringer'], stakes: 'Twenty-two years undefeated. The King isn’t defending a crown — he’s waiting to hand it to someone who beats him right.', flavor: 'The legend the Level 50 title is named for. Undefeated since \u201903.', twist: { label: 'Full game to 750 · Double or nothing', targetScore: 750 }, tier: 'elite', doubleOrNothing: true },
];

export const storyStopById = (id: string): StoryStop | undefined => STORY_STOPS.find((s) => s.id === id);
export const storyStopByNumber = (n: number): StoryStop | undefined => STORY_STOPS.find((s) => s.n === n);

/**
 * Speech-density class per stop (density pass; profiles in talk.ts
 * TALK_PROFILES). The classes ARE the mood canon: the Rec and the Cookout
 * run loud, the Church and the Rooftop keep their air on purpose (slow —
 * gaps ~2× the loud stops', speech share capped), the Corner and the Pj's
 * stay tense and short, and the King runs its own climax gear.
 */
export const STOP_DENSITY_CLASS: Record<string, DensityClass> = {
  'porch': 'lively',
  'barbershop': 'steady',
  'rec-center': 'loud',
  'cookout': 'loud',
  'corner': 'tense',
  'church-basement': 'slow',
  'rooftop': 'slow',
  'high-rise': 'cold',
  'the-pjs': 'tense',
  'legends': 'steady',
  'king': 'climax',
};

/** The final stop (the King). Clearing it on a track completes that track. */
export const STORY_FINAL_STOP: StoryStop = STORY_STOPS[STORY_STOPS.length - 1]!;

/**
 * First-clear rewards scale with the stop: stop n pays n × the base in XP and
 * coins (plus the clear is what unlocks the next stop — the real prize).
 * Replays pay a small upkeep only, never the clear reward twice.
 */
export const STORY_REWARD_BASE = { xp: 25, coins: 20 } as const;
export const STORY_REPLAY_REWARD = { xp: 10, coins: 5 } as const;

/**
 * A finished story LOSS pays a small consolation: flat 5 XP, no coins
 * (owner, 2026-10-21 — "there should be small xp for losses"). It marks
 * the effort of seeing a match through; clear rewards stay win-only,
 * and it pays once per finished game like every story reward.
 */
export const STORY_LOSS_REWARD = { xp: 5, coins: 0 } as const;

export function storyReward(stopNumber: number, firstClear: boolean): { xp: number; coins: number } {
  if (!firstClear) return { ...STORY_REPLAY_REWARD };
  return { xp: STORY_REWARD_BASE.xp * stopNumber, coins: STORY_REWARD_BASE.coins * stopNumber };
}

/**
 * What a first clear actually pays at a stop. The King's double or
 * nothing doubles the standard first-clear reward — and pays it only
 * when the second consecutive win lands (server-enforced; see
 * apps/server/src/story/routes.ts).
 */
export function storyClearReward(stop: StoryStop): { xp: number; coins: number } {
  const base = storyReward(stop.n, true);
  return stop.doubleOrNothing ? { xp: base.xp * 2, coins: base.coins * 2 } : base;
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

/** The two member uids of a pair track key, in key order (sorted), or null
 *  for the solo track / an invalid key. The pair key is the membership proof:
 *  a caller belongs to the track iff their uid is one of these two. */
export function storyPairUids(track: unknown): [string, string] | null {
  if (typeof track !== 'string' || !storyTrackKeyValid(track) || track === STORY_SOLO_TRACK) return null;
  const m = /^pair:([^:]{1,64}):([^:]{1,64})$/.exec(track);
  return m ? [m[1]!, m[2]!] : null;
}

/**
 * The rules a stop plays under, built server-side from the stop alone
 * (co-op story rooms): the same object the solo client builds with
 * storyRulesFor(stop, DEFAULT_SETTINGS) — the canonical default settings
 * map onto the mode preset exactly (see apps/web settingsToRules: every
 * default it sets equals the preset's BASE), and the twist overrides are
 * applied in the same order storyRulesFor applies them (target and
 * blind-nil availability via the settings snapshot; nil value, blind-nil
 * value and per-stop timers as scoped rules overrides). A test pins this
 * function against the web's storyRulesFor for every stop, so the solo
 * and co-op tables can never drift apart.
 */
export function storyRulesForStop(stop: StoryStop): TableRules {
  const t = stop.twist;
  const mode = t.mode ?? 'joker';
  // bagsOn is explicit so the room's rules are byte-identical to the solo
  // client's derivation (settingsToRules always writes it; the engine's
  // bagsOnOf treats undefined as on, but the wire shape should match too).
  const o: RulesOverrides = { bagsOn: true };
  if (t.targetScore !== undefined) o.targetScore = t.targetScore;
  if (t.blindNil) {
    o.blindNil = {
      allowed: true,
      onlyWhenBehindBy: t.blindNil.availability === 'always' ? null : 100,
      ...(t.blindNil.value !== undefined ? { value: t.blindNil.value } : {}),
    };
  }
  if (t.nilValue !== undefined) o.nil = { value: t.nilValue };
  if (t.bidTimerSec !== undefined || t.playTimerSec !== undefined) {
    o.turnTimerSec = {
      ...(t.bidTimerSec !== undefined ? { bid: t.bidTimerSec } : {}),
      ...(t.playTimerSec !== undefined ? { play: t.playTimerSec } : {}),
    };
  }
  return makeRules(mode, o);
}
