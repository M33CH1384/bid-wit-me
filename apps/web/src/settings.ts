import { minimumChip } from './polishText';
import { DECK_IDS } from './decks';
import { isValidSetAnimSetting } from './setAnims';
import { type VenueChoice, isVenueChoice } from '@spades/protocol';
import { CLASSIC_JOKER, cardLabel, firstHandMinOf, hostMinimum, type Mode, type RulesOverrides, type TableRules, makeRules } from '@spades/rules';
import { type BotSkillSetting, skillSettingOf } from '@spades/bots';
import { trumpLadderText } from './trumpLadder';
import { DEFAULT_VIEW_ADJUST, normalizeViewAdjust, type ViewAdjust } from './viewAdjust';
import { normalizeEyeZoomCalibration, type EyeGazeCalibration } from './eyeZoom';

export type ModeKey = 'joker' | 'cutthroat4' | 'cutthroat3' | 'aceDown';

export interface Settings {
  mode: ModeKey;
  targetScore: number | 'default';
  losingFloor: 'on' | 'off';
  deuceOfSpadesHigh: boolean;
  /** house = Demetrius's order (BJ › LJ › 2♦ › 2♠ › A♠…; 2♣ 2♥ removed); classic = BJ › LJ › A♠…2♠ (2♥ 2♦ removed). */
  jokerOrder: 'house' | 'classic';
  cutthroatDeck: 'joker54' | 'standard52';
  spadesMustBeBroken: boolean;
  firstLead: 'leftOfDealer' | 'twoOfClubs';
  minTeamBid: number;
  nilAllowed: boolean;
  blindNil: 'behind100' | 'always' | 'off';
  blindNilExchange: 0 | 2;
  nilTricksCountForPartner: boolean;
  bags: '10/100' | '10/50' | '5/50';
  tenForTwoHundred: boolean;
  /** House rule "First hand: books bid themselves" (on by default). */
  firstHandBidsItself: boolean;
  /** Bot skill: Mixed (default: each bot seat rolls its own, hidden) or one fixed level for every bot. */
  botLevel: BotSkillSetting;
  /** House rule "Shot = out": shot on hand 1, or twice in a row, loses the game. */
  shotOut: boolean;
  /** First hand (books bid themselves): fewer books than this is a shot. default = 4 in team modes, off in Cutthroat. */
  firstHandMin: 'default' | 3 | 4 | 5 | 'off';
  /** Cutthroat: minimum positive bid (1–4, default 1). A bid of 0 is always Nil. */
  cutMinBid: 1 | 2 | 3 | 4;
  /** Cutthroat: Blind Nil allowed (default off). */
  cutBlindNil: boolean;
  /** "Bags and penalties" (default on). Off: overtricks are worth nothing and there is no bag penalty. */
  bagsOn: boolean;
  /** Bot trash-talk intensity (table setting): family / cookout (default) / nomercy. */
  talkIntensity: 'family' | 'cookout' | 'nomercy';
  /** Voice Phase 3 host flag (default off, no menu yet): bots may use pre-voiced catalog lines at Getting set / Wheels / match win. */
  aiTalk?: boolean;
  speed: 'slow' | 'relaxed' | 'normal' | 'fast' | 'turbo';
  /** 3D quality: low disables shadows, HDRI and MSAA and uses smaller textures. */
  quality: 'high' | 'low';
  /** Venue (3D arena) for offline games: classic (default), one of the venues, or random (rolled per game) */
  venue: VenueChoice;
  /** Camera view: sitting = lower/closer (DEFAULT for new players, V-gesture slams); standing = higher/farther. A saved choice always wins. */
  view: 'standing' | 'sitting';
  /** Adjustable table view (owner, 2026-10-29): the player's own tilt/zoom offset on top of the
   *  stock framing, set by dragging/pinching on the table and saved with the settings. */
  viewAdjust: ViewAdjust;
  /** Motion view (owner, 2026-11-07): opt-in, OFF by default. When on, leaning the phone
   *  drives the same viewAdjust tilt and a push/pull gesture steps its zoom (motionView.ts).
   *  Turning it on asks the platform's motion permission from the toggle tap itself. */
  motionView: boolean;
  /** Eye zoom (owner, 2026-11-07): opt-in, OFF by default, SEPARATE from Motion view. When on,
   *  the front camera reads — on-device only — whether the player is looking at their cards or
   *  the table and eases the viewAdjust zoom (eyeZoom.ts). */
  eyeZoom: boolean;
  /** The player's personal eye-zoom calibration (two-look medians from eyeZoom calibration),
   *  local to this device's settings; null = never calibrated, gaze control stays inactive. */
  eyeZoomCal: EyeGazeCalibration | null;
  /** Turn up (slam mode): OFF by default for everyone. When ON, Standing plays slam at max and Sitting's V-gesture slams (sent online). When OFF, NO play slams by any route (drag, flick, V-gesture, tap/toss). */
  turnUp: boolean;
  /** Card deck art pack (Desi decks; all unlocked for now, Story/purchase lock later). */
  deck: string;
  /** Set animation (owner, 2026-10-21): 'auto' = Match the room, or a story
   *  stop id whose earned set animation is equipped. There is NO free default:
   *  an unearned or unknown choice simply never plays (see setAnims.ts). */
  setAnim: string;
}

/**
 * The load-time graphics-quality heuristic. Exported for the ink layer
 * (src/ink/mode.ts `inkLowQuality`), which compares a stored quality
 * against a fresh heuristic read to tell an explicit user pick apart from
 * this default. NOTE: its signals are weak on WebKit — Safari has no
 * `deviceMemory`, and iOS clamps `hardwareConcurrency` to 2 — so it answers
 * 'low' on every iPhone; consumers that can adapt at runtime (the ink
 * governor) should not take its word for low-end hardware.
 */
export function defaultQuality(): 'high' | 'low' {
  if (typeof navigator === 'undefined') return 'high';
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (mem !== undefined && mem <= 3) || (navigator.hardwareConcurrency ?? 8) <= 3 ? 'low' : 'high';
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'joker', targetScore: 'default', losingFloor: 'on', deuceOfSpadesHigh: false, jokerOrder: 'house',
  cutthroatDeck: 'joker54', spadesMustBeBroken: true, firstLead: 'leftOfDealer', minTeamBid: 0, nilAllowed: true,
  blindNil: 'behind100', blindNilExchange: 0, nilTricksCountForPartner: false, bags: '10/100', tenForTwoHundred: false,
  firstHandBidsItself: true, botLevel: 'mixed', shotOut: true, firstHandMin: 'default', cutMinBid: 1, cutBlindNil: false, bagsOn: true, talkIntensity: 'cookout', speed: 'normal', quality: defaultQuality(), venue: 'classic', view: 'sitting', viewAdjust: { ...DEFAULT_VIEW_ADJUST }, motionView: false, eyeZoom: false, eyeZoomCal: null, turnUp: false, deck: 'classic', setAnim: 'auto',
};

export const MODES: { key: ModeKey; title: string; blurb: string; players: string }[] = [
  { key: 'joker', title: 'Joker Spades', blurb: `${trumpLadderText(makeRules('joker'), 5, 'plain')}. Partners sit across.`, players: '2 v 2' },
  { key: 'cutthroat4', title: 'Cutthroat', blurb: 'Every player for themselves. Joker or standard deck, race to 300.', players: '4 players' },
  { key: 'cutthroat3', title: 'Cutthroat 3', blurb: 'Three players, 17 cards each, no partners.', players: '3 players' },
  { key: 'aceDown', title: 'Ace Down', blurb: 'Standard 52, no jokers, aces highest. Regular bidding & scoring.', players: '2 v 2' },
];


/**
 * The end-score choices every table surface offers (SPEC: default 500 —
 * cutthroat 300 — options 250 / 300 / 500). The mode's own preset number IS
 * the 'default' choice: picking it stores 'default', so the target follows
 * the mode if the mode changes later; the other two store the number.
 * One source for the bots form, the create-a-table form and the Settings
 * sheet's House rules (the room lobby offers the same values in its own
 * select). Owner, 2026-11-03: the end score must be settable when creating
 * a table.
 */
export function targetScoreOptions(s: Settings): [Settings['targetScore'], string][] {
  const preset = s.mode.startsWith('cutthroat') ? 300 : 500;
  return [250, 300, 500].map((x) => (x === preset ? ['default' as const, String(x)] : [x, String(x)])) as [Settings['targetScore'], string][];
}

export function settingsToRules(s: Settings): TableRules {
  const mode: Mode = s.mode === 'joker' ? 'joker' : s.mode === 'aceDown' ? 'aceDown' : 'cutthroat';
  const o: RulesOverrides = {
    spadesMustBeBroken: s.spadesMustBeBroken,
    minTeamBid: s.minTeamBid,
    nil: { allowed: s.nilAllowed },
    blindNil: { allowed: s.blindNil !== 'off', onlyWhenBehindBy: s.blindNil === 'always' ? null : 100, exchangeCards: s.blindNilExchange },
    nilTricksCountForPartner: s.nilTricksCountForPartner,
    bagsPerPenalty: s.bags === '5/50' ? 5 : 10,
    bagPenalty: s.bags === '10/100' ? 100 : 50,
    tenForTwoHundred: s.tenForTwoHundred,
    firstHandBidsItself: s.firstHandBidsItself !== false,
    losingFloor: s.losingFloor === 'on' ? -200 : null,
    shotOut: s.shotOut !== false,
    bagsOn: s.bagsOn !== false,
  };
  if ((s.mode === 'joker' || s.mode === 'aceDown') && s.firstHandMin !== undefined && s.firstHandMin !== 'default') o.firstHandMin = s.firstHandMin === 'off' ? null : s.firstHandMin;
  if (s.targetScore !== 'default') o.targetScore = s.targetScore;
  const classic = s.jokerOrder === 'classic';
  if (s.mode === 'joker' && classic) Object.assign(o, CLASSIC_JOKER, { deuceOfSpadesHigh: s.deuceOfSpadesHigh });
  if (s.mode === 'cutthroat4' || s.mode === 'cutthroat3') {
    o.playerCount = s.mode === 'cutthroat3' ? 3 : 4;
    o.deck = s.cutthroatDeck;
    // Cutthroat's minimum books / bid is this 1–4 setting. Nil and Blind Nil stay off.
    o.minTeamBid = [1, 2, 3, 4].includes(s.cutMinBid) ? s.cutMinBid : 1;
    o.firstHandMin = null;
    o.nil = { allowed: false };
    o.blindNil = { allowed: false, onlyWhenBehindBy: null, exchangeCards: 0 };
    if (s.cutthroatDeck === 'joker54' && classic) {
      o.trumpOrderTop = CLASSIC_JOKER.trumpOrderTop;
      o.removedCards = s.mode === 'cutthroat3' ? ['2C', '2H', '2D'] : CLASSIC_JOKER.removedCards;
      o.deuceOfSpadesHigh = s.deuceOfSpadesHigh;
    }
  }
  // 2♣ lead needs the 2♣ in the deck
  const tentative = { ...o, firstLead: s.firstLead };
  try {
    return makeRules(mode, tentative);
  } catch {
    return makeRules(mode, { ...o, firstLead: 'leftOfDealer' });
  }
}

/**
 * Finding E (responsive audit 2026-11-05): which house rules differ from
 * the current mode's defaults — the truth behind the setup "HOUSE RULES"
 * chip (empty = Standard, non-empty = Custom). Pure derivation from the
 * one Settings state, so the Settings sheet, in-form edits and the
 * loadSettings restore path all stay in sync with no stored flag.
 *
 * The comparison runs on EFFECTIVE rules: both sides go through
 * settingsToRules itself (the baseline is the mode's own preset built
 * the same way, keeping the mode + cutthroat deck choice, which are not
 * house rules), so the helper can never drift from the engine, and
 * facets that are inert in context mask themselves — cutthroat's forced
 * Nil/Blind Nil/firstHandMin, deuceOfSpadesHigh outside the classic
 * joker order, the 2♣ lead where 2♣ is removed. The remaining explicit
 * masks follow the sheet's own presentation: the bag penalty only
 * exists while Bags are on (scoring forces bagsAdded to 0 when off, so
 * no penalty can accrue), and the blind-nil exchange / failed-nil
 * tricks facets only exist while their parent Nil route is open.
 * Facet wording mirrors the MoreOptions row labels; order is sheet order.
 */
export function houseRulesDiff(s: Settings): string[] {
  const a = settingsToRules(s);
  const b = settingsToRules({ ...DEFAULT_SETTINGS, mode: s.mode, cutthroatDeck: s.cutthroatDeck });
  const diff: string[] = [];
  const sameCards = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((c, i) => c === y[i]);
  if (a.targetScore !== b.targetScore) diff.push(`Play to ${a.targetScore}`);
  if ((a.firstHandBidsItself !== false) !== (b.firstHandBidsItself !== false)) diff.push(`First hand bids itself ${a.firstHandBidsItself !== false ? 'on' : 'off'}`);
  if ((a.shotOut !== false) !== (b.shotOut !== false)) diff.push(`Shot = out ${a.shotOut !== false ? 'on' : 'off'}`);
  if (a.partnerships) {
    const min = firstHandMinOf(a);
    if (min !== firstHandMinOf(b)) diff.push(`Minimum books/bid ${min === null ? 'off' : min}`);
  }
  if (a.losingFloor !== b.losingFloor) diff.push(`Losing floor ${a.losingFloor === null ? 'off' : 'on'}`);
  // Joker trump order is a deck-level facet: it can only differ where a
  // joker deck is in play (the effective trump/removed sets say so).
  if (!sameCards(a.trumpOrderTop, b.trumpOrderTop) || !sameCards(a.removedCards, b.removedCards)) diff.push('Joker trump order classic');
  if (s.jokerOrder === 'classic' && a.deuceOfSpadesHigh !== b.deuceOfSpadesHigh) diff.push('2♠ under jokers');
  if (a.spadesMustBeBroken !== b.spadesMustBeBroken) diff.push(`Spades must be broken ${a.spadesMustBeBroken ? 'on' : 'off'}`);
  if (a.firstLead !== b.firstLead) diff.push('2♣ leads first trick');
  if (a.minTeamBid !== b.minTeamBid) diff.push(a.partnerships ? `Minimum team bid ${a.minTeamBid}` : `Minimum books/bid ${a.minTeamBid}`);
  if (a.partnerships) {
    if (a.nil.allowed !== b.nil.allowed) diff.push(`Nil ${a.nil.allowed ? 'on' : 'off'}`);
    if (a.blindNil.allowed !== b.blindNil.allowed || a.blindNil.onlyWhenBehindBy !== b.blindNil.onlyWhenBehindBy) {
      diff.push(a.blindNil.allowed ? (a.blindNil.onlyWhenBehindBy === null ? 'Blind Nil always' : 'Blind Nil behind 100+') : 'Blind Nil off');
    }
    if (a.blindNil.allowed && a.blindNil.exchangeCards !== b.blindNil.exchangeCards) diff.push('Blind Nil exchange');
    if ((a.nil.allowed || a.blindNil.allowed) && a.nilTricksCountForPartner !== b.nilTricksCountForPartner) diff.push('Failed-nil tricks help partner');
  }
  if ((a.bagsOn !== false) !== (b.bagsOn !== false)) diff.push(`Bags ${a.bagsOn !== false ? 'on' : 'off'}`);
  else if (a.bagsOn !== false && (a.bagsPerPenalty !== b.bagsPerPenalty || a.bagPenalty !== b.bagPenalty)) diff.push(`Bags ${a.bagsPerPenalty}/${a.bagPenalty}`);
  if (a.tenForTwoHundred !== b.tenForTwoHundred) diff.push(`10 for 200 ${a.tenForTwoHundred ? 'on' : 'off'}`);
  return diff;
}

const KEY = 'spades.settings.v2';
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}
/** Older saves: 'easy' / 'normal' bot levels ('normal' was the default → Mixed now; 'easy' → Novice). */
export function normalizeSettings(j: Omit<Partial<Settings>, 'botLevel'> & { botLevel?: string }): Settings {
  const s = { ...DEFAULT_SETTINGS, ...j } as Settings;
  s.botLevel = j.botLevel === 'normal' || j.botLevel === undefined ? 'mixed' : skillSettingOf(j.botLevel);
  if (!['family', 'cookout', 'nomercy'].includes(s.talkIntensity)) s.talkIntensity = 'cookout';
  if (!isVenueChoice(s.venue)) s.venue = 'classic';
  if (s.view !== 'sitting' && s.view !== 'standing') s.view = 'sitting'; // no saved preference (or junk) -> Sitting
  s.viewAdjust = normalizeViewAdjust(s.viewAdjust); // clamped tilt/zoom; junk -> the stock framing
  if (typeof s.motionView !== 'boolean') s.motionView = false; // motion view is opt-in; old saves start OFF
  if (typeof s.eyeZoom !== 'boolean') s.eyeZoom = false; // eye zoom is opt-in; old saves start OFF
  s.eyeZoomCal = normalizeEyeZoomCalibration(s.eyeZoomCal); // personal gaze threshold; junk -> uncalibrated
  if (typeof s.turnUp !== 'boolean') s.turnUp = false; // slam mode is opt-in; old saves start OFF
  if (!DECK_IDS.includes(s.deck) || s.deck === 'base') s.deck = 'classic';
  if (!isValidSetAnimSetting(s.setAnim)) s.setAnim = 'auto';
  return s;
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/**
 * One-line table summary for the setup screen, e.g.
 * "4 players • 13 cards each • 13 books • Minimum 1 • Nil off • Blind Nil off • Bags on" (Cutthroat 3 adds "2♣ removed").
 */
export function rulesSummary(r: TableRules): string {
  const hs = r.playerCount === 4 ? 13 : 17;
  const removed = r.removedCards.length ? `${r.removedCards.map((c) => cardLabel(c)).join(' ')} removed` : null;
  const parts = [`${r.playerCount} players`, `${hs} cards each`, `${hs} books`];
  if (r.playerCount === 3 && removed) parts.push(removed);
  const floor = hostMinimum(r);
  parts.push(minimumChip(floor, r.partnerships));
  parts.push(`Nil ${r.nil.allowed ? 'on' : 'off'}`, `Blind Nil ${r.blindNil.allowed ? 'on' : 'off'}`, `Bags ${r.bagsOn !== false ? 'on' : 'off'}`);
  return parts.join(' • ');
}

export function modeTitle(r: TableRules): string {
  if (r.mode === 'joker') return 'Joker Spades';
  if (r.mode === 'aceDown') return 'Ace Down';
  return `Cutthroat · ${r.playerCount}p`;
}
