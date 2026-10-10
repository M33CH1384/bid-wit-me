import { CLASSIC_JOKER, type Mode, type RulesOverrides, type TableRules, makeRules } from '@spades/rules';
import type { BotLevel } from '@spades/bots';

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
  botLevel: BotLevel;
  speed: 'slow' | 'relaxed' | 'normal' | 'fast' | 'turbo';
  /** 3D quality: low disables shadows, HDRI and MSAA and uses smaller textures. */
  quality: 'high' | 'low';
}

function defaultQuality(): 'high' | 'low' {
  if (typeof navigator === 'undefined') return 'high';
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (mem !== undefined && mem <= 3) || (navigator.hardwareConcurrency ?? 8) <= 3 ? 'low' : 'high';
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'joker', targetScore: 'default', losingFloor: 'on', deuceOfSpadesHigh: false, jokerOrder: 'house',
  cutthroatDeck: 'joker54', spadesMustBeBroken: true, firstLead: 'leftOfDealer', minTeamBid: 0, nilAllowed: true,
  blindNil: 'behind100', blindNilExchange: 0, nilTricksCountForPartner: false, bags: '10/100', tenForTwoHundred: false,
  firstHandBidsItself: true, botLevel: 'normal', speed: 'normal', quality: defaultQuality(),
};

export const MODES: { key: ModeKey; title: string; blurb: string; players: string }[] = [
  { key: 'joker', title: 'Joker Spades', blurb: 'Big Joker › Little Joker › 2♦ › 2♠ › A♠. Partners sit across.', players: '2 v 2' },
  { key: 'cutthroat4', title: 'Cutthroat', blurb: 'Every player for themselves. Joker or standard deck, race to 300.', players: '4 players' },
  { key: 'cutthroat3', title: 'Cutthroat 3', blurb: 'Three players, 17 cards each, no partners.', players: '3 players' },
  { key: 'aceDown', title: 'Ace Down', blurb: 'Standard 52, no jokers, aces highest. Regular bidding & scoring.', players: '2 v 2' },
];


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
  };
  if (s.targetScore !== 'default') o.targetScore = s.targetScore;
  const classic = s.jokerOrder === 'classic';
  if (s.mode === 'joker' && classic) Object.assign(o, CLASSIC_JOKER, { deuceOfSpadesHigh: s.deuceOfSpadesHigh });
  if (s.mode === 'cutthroat4' || s.mode === 'cutthroat3') {
    o.playerCount = s.mode === 'cutthroat3' ? 3 : 4;
    o.deck = s.cutthroatDeck;
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

const KEY = 'spades.settings.v2';
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function modeTitle(r: TableRules): string {
  if (r.mode === 'joker') return 'Joker Spades';
  if (r.mode === 'aceDown') return 'Ace Down';
  return `Cutthroat · ${r.playerCount}p`;
}
