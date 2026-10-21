/**
 * Story Mode: turn a stop definition into the Settings snapshot + TableRules
 * the offline table already understands. Twists ride the existing
 * settings/house-rules machinery (mode, target, blind-nil availability);
 * the parts with no Settings knob (nil value, blind-nil value, per-stop
 * timers) are applied as scoped rules overrides for THIS game only — the
 * player's saved settings are never touched, and no global rule changes.
 *
 * The house deck rides the same scoped snapshot: a story table deals the
 * stop's OWN matched deck (storyDecks' stop→deck map), not the player's
 * selected deck — it's the house's deck on their turf. Table activates
 * whatever deck its settings snapshot carries, so backs and faces match
 * for all four seats. Clearing the stop is what lets the player take the
 * deck home in the picker; playing AT the stop never required owning it.
 */
import { makeRules, type RulesOverrides, type TableRules } from '@spades/rules';
import type { StoryStop } from '@spades/bots';
import { deckForStop } from '../decks';
import { type Settings, settingsToRules } from '../settings';
import type { VenueChoice } from '../venues';

export function storySettingsFor(stop: StoryStop, base: Settings): Settings {
  const t = stop.twist;
  return {
    ...base,
    deck: deckForStop(stop.id)?.id ?? base.deck,
    mode: t.mode ?? 'joker',
    targetScore: t.targetScore ?? 'default',
    venue: stop.venueId as VenueChoice,
    blindNil: t.blindNil ? (t.blindNil.availability === 'always' ? 'always' : 'behind100') : base.blindNil,
  };
}

export function storyRulesFor(stop: StoryStop, base: Settings): TableRules {
  const r = settingsToRules(storySettingsFor(stop, base));
  const o: RulesOverrides = { ...r, nil: { ...r.nil }, blindNil: { ...r.blindNil }, turnTimerSec: { ...r.turnTimerSec } };
  if (stop.twist.nilValue !== undefined) o.nil = { ...o.nil, value: stop.twist.nilValue };
  if (stop.twist.blindNil?.value !== undefined) o.blindNil = { ...o.blindNil, value: stop.twist.blindNil.value };
  if (stop.twist.bidTimerSec !== undefined || stop.twist.playTimerSec !== undefined) {
    o.turnTimerSec = {
      bid: stop.twist.bidTimerSec ?? r.turnTimerSec.bid,
      play: stop.twist.playTimerSec ?? r.turnTimerSec.play,
    };
  }
  return makeRules(r.mode, o);
}

/** Seat names for a solo stop game: you, adversary 1, Dee (your partner, seat 2), adversary 2. */
export function storySeatNames(stop: StoryStop, pairNames: [string, string]): string[] {
  return ['You', pairNames[0], 'Dee', pairNames[1]];
}
