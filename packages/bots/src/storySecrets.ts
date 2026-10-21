/**
 * Story Mode secrets (owner, 2026-10-21): one EASTER EGG and one UNLOCKABLE
 * per stop, as content. Neither gates progress. Found state and feats are
 * recorded server-side (story_finds + the Rep unlocks table); nothing here
 * is marked on the map before it's found — the egg's name only appears once
 * discovered, and its hint only shows after the stop is cleared.
 *
 * Egg trigger types (all honestly keyed to real things):
 *  - 'sceneTap'   a hidden spot in the stop's intro scene backdrop
 *  - 'deeTap'     tapping Dee's medallion repeatedly in the scene
 *  - 'matchEvent' a real in-match event (Dee makes a nil, a side is set on
 *                 hand 1, …) — granted server-side from the result facts
 *  - 'chain'      arriving at this stop with an earlier stop's egg in hand
 *
 * Unlockable feats are evaluated server-side from the result payload's
 * honestly-computed game facts (StoryGameFacts — computed by the client
 * from the finished game's own hand history, the same trust level as the
 * offline result post). `needsWin` feats only grant on a win.
 */
import type { StoryStop } from './story';

export type StoryEggTrigger =
  | { type: 'sceneTap' }
  | { type: 'deeTap' }
  | { type: 'matchEvent'; event: StoryMatchEvent }
  | { type: 'chain'; fromStopId: string };

export type StoryMatchEvent = 'deeNilMade' | 'setOnFirstHand' | 'ourNilMade' | 'oppSetTwice';

export interface StoryEgg {
  id: string;
  /** trophy text shown on the map once found (never before) */
  name: string;
  /** 1–2 line telling of what it was, shown once found */
  tale: string;
  /** subtle hint, shown only AFTER the stop is cleared and only while unfound */
  hint: string;
  trigger: StoryEggTrigger;
  /** the secret beat(s) the scene plays when a scene-side trigger fires */
  beat?: { speaker: string; line: string }[];
}

/** Honest facts about a finished story game, computed from its hand history. */
export interface StoryGameFacts {
  margin: number; // player's side score − opponents' score at game end
  handsPlayed: number;
  setsAgainstUs: number;
  setsAgainstThem: number;
  ourNilsMade: number;
  ourBlindNilsMade: number;
  deeNilsMade: number;
  deeSteady: boolean; // every hand: Dee delivered (a trick taken, or her nil made) AND her side made its contract
  setOnFirstHand: boolean;
  oppSetTwice: boolean;
}

export type StoryFeatId =
  | 'cleanClear'        // won, your side never set
  | 'bigWin100'         // won by 100+
  | 'fastClear6'        // won in 6 hands or fewer
  | 'deeSteadyClear'    // won with Dee steady every hand
  | 'bigWin150'         // won by 150+
  | 'nilMade'           // your side made a nil (win not required)
  | 'blindNilMade'      // your side made a blind nil (win not required)
  | 'shutoutBooksClear' // won, never set, opponents set at least once
  | 'nilClear'          // won a game in which your side made a nil
  | 'fastClear7'        // won in 7 hands or fewer
  | 'kingClean'         // beat the King, never set
  ;

export interface StoryUnlockable {
  /** unlocks.item_id (also the profile Unlocks surface entry) */
  itemId: string;
  /** the collectible's name, shown on the map and in profile Unlocks */
  name: string;
  /** the feat, in plain words, shown as the chase on the map card */
  featText: string;
  feat: StoryFeatId;
  needsWin: boolean;
}

export interface StorySecret { egg: StoryEgg; unlockable: StoryUnlockable }

export const STORY_SECRETS: Record<string, StorySecret> = {
  porch: {
    egg: { id: 'porch-radio', name: "Ray's Radio Dial", tale: 'You found the loose dial on Ray’s porch radio. It only picks up one station: old games, called by Pat, who apparently commentates everything.', hint: 'Something on this porch still hums when the game goes quiet.', trigger: { type: 'sceneTap' }, beat: [
      { speaker: 'pat', line: 'Baby, you found Ray’s radio dial. Forty years that station’s played nothing but games on this porch — and my commentary, which Ray pretends not to record.' },
      { speaker: 'uncleRay', line: 'I record NOTHING. The radio has its own habits. …You heard the ’89 game, didn’t you? I was magnificent.' },
    ] },
    unlockable: { itemId: 'story-porch-cap', name: "Ray's Lucky Bottle Cap", featText: 'Clear the Porch without your side being set once', feat: 'cleanClear', needsWin: true },
  },
  barbershop: {
    egg: { id: 'shop-photo-wall', name: 'The Photo Wall', tale: 'Behind Coleman’s clippers: a wall of photographs, fifty years of heads and winners. One photo is face-down. June says some stories keep their privacy.', hint: 'The shop keeps its history where it can see it.', trigger: { type: 'sceneTap' }, beat: [
      { speaker: 'june', line: 'You found the photo wall. Every winner in this shop is up there, babies. Win or lose twice more and you’ll be a story we point at.' },
      { speaker: 'mrColeman', line: 'The face-down one is mine to know. A barber keeps some cuts private. Play well and I might tell it standing over your chair in thirty years.' },
    ] },
    unlockable: { itemId: 'story-shop-razor-case', name: "Coleman's Straight Razor Case", featText: 'Clear the Barbershop by 100 points or more', feat: 'bigWin100', needsWin: true },
  },
  'rec-center': {
    egg: { id: 'rec-dee-nil', name: "Dee's Rec Center Nil", tale: 'Dee made a nil at the loudest table on the route. Trey screamed so hard he had to sit down, which the Rec counts as a standing ovation.', hint: 'Somebody quiet could do something loud here. Watch Dee’s bids.', trigger: { type: 'matchEvent', event: 'deeNilMade' } },
    unlockable: { itemId: 'story-rec-whistle', name: "The Rec's Golden Whistle", featText: 'Clear the Rec Center in 6 hands or fewer', feat: 'fastClear6', needsWin: true },
  },
  cookout: {
    egg: { id: 'cookout-chain', name: "Mama's Reserved Seat", tale: 'You came to the family table carrying the Porch’s egg, and the Twins noticed before you said a word. There is a seat at this cookout that stays empty on purpose — for whoever the family is still waiting on.', hint: 'The Twins notice what you carry. Some tables talk to each other.', trigger: { type: 'chain', fromStopId: 'porch' }, beat: [
      { speaker: 'keisha', line: 'She’s carrying the—' },
      { speaker: 'teisha', line: '—Porch with her. Ray’s dial hums at our gate. Mama always said the route knits itself if you let it.' },
      { speaker: 'keisha', line: 'There’s a seat here we keep empty, babies. Tonight it feels a little less empty. That’s your doing.' },
    ] },
    unlockable: { itemId: 'story-cookout-beads', name: "The Twins' Matched Hair Beads", featText: 'Clear the Cookout with Dee steady every hand (she delivers — a trick taken or a nil made, contract home)', feat: 'deeSteadyClear', needsWin: true },
  },
  corner: {
    egg: { id: 'corner-first-set', name: 'First Blood on the Corner', tale: 'Somebody got set on the very first hand at the coldest table on the route. Smoke didn’t smile. Redd almost did, which out here is a parade.', hint: 'The Corner respects a fast lesson. Hand one is a statement here.', trigger: { type: 'matchEvent', event: 'setOnFirstHand' } },
    unlockable: { itemId: 'story-corner-matchbook', name: "Smoke's Unlit Matchbook", featText: 'Clear the Corner by 150 points or more', feat: 'bigWin150', needsWin: true },
  },
  'church-basement': {
    egg: { id: 'church-dee', name: "Mae's Extra Chair", tale: 'You tapped Dee’s medallion until she finally told you why this basement matters to HER: her grandmother taught her to count books at that table, on a chair too tall for her feet to touch the floor.', hint: 'Dee has a history down here she hasn’t told you. Ask her — with taps.', trigger: { type: 'deeTap' }, beat: [
      { speaker: 'dee', line: '…Okay. Okay. You keep tapping me, so here it is: my grandmother taught me books at THIS table. My feet didn’t touch the floor. Sister Mae used to slip me extra lemonade when I counted right.' },
      { speaker: 'sisterMae', line: 'I slipped it when she counted WRONG too, baby. Encouragement is a curriculum. She just never knew the syllabus.' },
    ] },
    unlockable: { itemId: 'story-church-pencil', name: "Sister Mae's Blessed Score Pencil", featText: 'Make a nil at the Church Basement (win or lose)', feat: 'nilMade', needsWin: false },
  },
  rooftop: {
    egg: { id: 'roof-our-nil', name: 'The Rooftop Nil', tale: 'Your side made a nil under the open sky. Poet said the moon co-signed it. Seven said nothing, at length, beautifully.', hint: 'The sky rewards a quiet promise kept.', trigger: { type: 'matchEvent', event: 'ourNilMade' } },
    unlockable: { itemId: 'story-roof-coin', name: "Seven's Silent Coin", featText: 'Make a blind nil at the Rooftop (win or lose)', feat: 'blindNilMade', needsWin: false },
  },
  'high-rise': {
    egg: { id: 'highrise-dee', name: "Velvet's Bus Pass", tale: 'Dee finally asked Velvet what she kept from the old street. Velvet opened her card guard: one bus pass, forty dollars’ worth of leaving, kept for thirty years — "to remember the price of staying."', hint: 'Dee has questions for Velvet that cards can’t ask. Tap her medallion.', trigger: { type: 'deeTap' }, beat: [
      { speaker: 'dee', line: 'Velvet. What did you keep, from the street? Everybody keeps something.' },
      { speaker: 'velvet', line: '…A bus pass, darling. The one I left on. I’ve carried it thirty years — not from regret. To remember the exact price of staying, so I’d never pay it by accident. …You’re the first to ask like it mattered.' },
    ] },
    unlockable: { itemId: 'story-highrise-bead', name: "The Accountant's Brass Abacus Bead", featText: 'Clear the High-Rise without being set, while setting them at least once', feat: 'shutoutBooksClear', needsWin: true },
  },
  'the-pjs': {
    egg: { id: 'pjs-opp-set-twice', name: "Brick's Second Blink", tale: 'You set the Captains twice in one game at their own table. Brick blinked — the second blink in twenty years, per the Captain, who keeps count and denied everything.', hint: 'Brick almost never reacts. Almost.', trigger: { type: 'matchEvent', event: 'oppSetTwice' } },
    unlockable: { itemId: 'story-pjs-bulb', name: "Brick's Streetlight Bulb", featText: 'Clear the Pj’s in a game where your side makes a nil', feat: 'nilClear', needsWin: true },
  },
  legends: {
    egg: { id: 'legends-tap', name: "Queenie's Reading Glasses", tale: 'Tucked by Queenie’s chair: her reading glasses, folded on a scorecard from 1989. The names on it are all legends now, and one of them — she won’t say whose — lost by a single book.', hint: 'Legends leave their tools where they sit.', trigger: { type: 'sceneTap' }, beat: [
      { speaker: 'queenie', line: 'You found my glasses, baby. And the scorecard under them. 1989. I keep the closest loss I ever dealt where I can see it — it keeps my dealing honest.' },
      { speaker: 'ace', line: 'One book, that game. One book between a legend and a lesson. She’s been both. That’s why the card stays out.' },
    ] },
    unlockable: { itemId: 'story-legends-seal', name: "Ace's Retired Deck Seal", featText: 'Clear the Legends’ Table in 7 hands or fewer', feat: 'fastClear7', needsWin: true },
  },
  king: {
    egg: { id: 'king-dee', name: "Dee's Coronation Line", tale: 'Before the King’s table, Dee finally said the quiet part out loud — tap her medallion at the last table and hear who she’s really doing this for.', hint: 'At the last table, Dee owes you one honest sentence. Tap her medallion.', trigger: { type: 'deeTap' }, beat: [
      { speaker: 'dee', line: '…Before we sit. I told everybody this run was about proving something to the BLOCK. It’s not. It’s my mama. She stopped believing our name meant anything after Daddy. I just want to watch her hear it said right, one time. …Okay. Now we can play.' },
      { speaker: 'king', line: 'The ringer heard that. So did I. Reasons are cards too, little one — and you just played yours face up, at my table, without flinching. Whatever happens next, THAT was champion’s work.' },
    ] },
    unlockable: { itemId: 'story-king-crown-cap', name: "The King's Crown Cap", featText: 'Beat the King without your side being set once', feat: 'kingClean', needsWin: true },
  },
};

/** Evaluate a stop's unlockable feat against a finished game's honest facts. */
export function storyFeatMet(stopId: string, facts: StoryGameFacts, won: boolean): boolean {
  const u = STORY_SECRETS[stopId]?.unlockable;
  if (!u) return false;
  if (u.needsWin && !won) return false;
  switch (u.feat) {
    case 'cleanClear': case 'kingClean': return facts.setsAgainstUs === 0;
    case 'bigWin100': return facts.margin >= 100;
    case 'bigWin150': return facts.margin >= 150;
    case 'fastClear6': return facts.handsPlayed <= 6;
    case 'fastClear7': return facts.handsPlayed <= 7;
    case 'deeSteadyClear': return facts.deeSteady;
    case 'nilMade': return facts.ourNilsMade >= 1;
    case 'blindNilMade': return facts.ourBlindNilsMade >= 1;
    case 'shutoutBooksClear': return facts.setsAgainstUs === 0 && facts.setsAgainstThem >= 1;
    case 'nilClear': return facts.ourNilsMade >= 1;
    default: return false;
  }
}

/** Does a recorded in-match event satisfy this stop's egg trigger? */
export function storyEggEventMet(stopId: string, event: StoryMatchEvent, facts: StoryGameFacts): boolean {
  const egg = STORY_SECRETS[stopId]?.egg;
  if (!egg || egg.trigger.type !== 'matchEvent') return false;
  if (egg.trigger.event !== event) return false;
  switch (event) {
    case 'deeNilMade': return facts.deeNilsMade >= 1;
    case 'setOnFirstHand': return facts.setOnFirstHand;
    case 'ourNilMade': return facts.ourNilsMade >= 1;
    case 'oppSetTwice': return facts.oppSetTwice || facts.setsAgainstThem >= 2;
    default: return false;
  }
}

export const storyEggById = (eggId: string): { stopId: string; egg: StoryEgg } | undefined => {
  for (const [stopId, s] of Object.entries(STORY_SECRETS)) if (s.egg.id === eggId) return { stopId, egg: s.egg };
  return undefined;
};

export const storySecretFor = (stop: StoryStop): StorySecret | undefined => STORY_SECRETS[stop.id];
