/**
 * Partner talk during BIDDING. Table rule: partners may talk books (vaguely) to agree on a team total; each still bids
 * their own number. Hints go partner-only (opponents never see them) and stop once the first card is led.
 *
 * - PARTNER_TALK_PRESETS: the human's one-tap hints.
 * - parseHint: what a hint says about the speaker's hand (presets + simple free text like "I got 3" / "weak").
 * - applyHint: how a bot that bids after (or while) its partner hinted adjusts its own number.
 *
 * The bot partner's own spoken estimate now lives in consultTalk.ts (the
 * consultation feature, CONSULT_SPEC §3): botHint() — dead, never called by
 * the app — and its "Strong in spades" line are PURGED under §7's
 * no-card-disclosure rule, and the 'Strong in spades' preset went with it
 * (a player is no longer offered a line the bots may not say). parseHint
 * keeps recognizing the phrase in free text for chat/save compatibility
 * (§11.9): we stopped GENERATING suit talk, not hearing it.
 */
import type { PlayerView } from '@spades/rules';

export const PARTNER_TALK_PRESETS = ['I got about 2', '3-ish', '4+', "I'm weak", 'I can go Nil'] as const;

export interface PartnerHint {
  /** expected books range for the speaker */
  low: number;
  high: number;
  nil?: boolean;
  spades?: boolean;
}

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** What a partner's line says about their hand (null = not a books hint). */
export function parseHint(text: string): PartnerHint | null {
  const t = text.toLowerCase();
  if (/\bnil\b/.test(t) && !/\bno nil\b|\bcan'?t go nil\b/.test(t)) return { low: 0, high: 0, nil: true };
  if (/strong in spades|lots? of spades|spade heavy|got spades/.test(t)) return { low: 3, high: 5, spades: true };
  if (/\bweak\b|nothing|garbage|trash hand|not much/.test(t)) return { low: 0, high: 1 };
  const m = /(\d{1,2}|one|two|three|four|five|six|seven|eight)\s*(\+|plus|or more)?/.exec(t);
  if (m) {
    const n = Number.isNaN(Number(m[1])) ? NUM[m[1]!]! : Number(m[1]);
    if (n > 13) return null;
    if (m[2]) return { low: n, high: n + 2 };
    return { low: Math.max(0, n - (/(ish|about|maybe|like)/.test(t) ? 1 : 0)), high: n };
  }
  return null;
}

/**
 * Adjust a bot's own bid for what its partner hinted, when the partner hasn't bid yet (a known bid already says more).
 * Keeps the team total within the books in play, and doesn't stack a second Nil on a partner who says they can go Nil.
 */
export function applyHint(bid: number, hint: PartnerHint | null | undefined, v: PlayerView): number {
  if (!hint) return bid;
  const room = v.rules.playerCount === 4 ? 13 : 17;
  const others = v.bids.reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  const partnerMid = hint.nil ? 0 : (hint.low + hint.high) / 2;
  let out = bid;
  if (hint.nil) out += 1; // covering a Nil partner: we'll be winning extra tricks
  // a strong partner + our count past the books left: trim to what the table can hold
  if (others + partnerMid + out > room) out = Math.max(1, Math.floor(room - others - partnerMid));
  return out;
}
