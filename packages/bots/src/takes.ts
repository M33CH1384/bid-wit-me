/**
 * Spoken takes for the recorded bake: how a raw (unfilled) line is actually read aloud.
 * The chat shows the line filled with real names; the clip is ONE generic take per line,
 * keyed by the raw template in the sprite manifest. These rules were reverse-engineered
 * from the shipped sprites (re-baking a line with a candidate take reproduces the shipped
 * clip's duration to the millisecond when the take is right):
 *
 *   - a trailing vocative is dropped: "fresh cut. no charge, {them}." → "fresh cut. no charge."
 *     (also "ok {opp}, you live this hand." → "ok, you live this hand." — an opener vocative
 *     in the first words drops too);
 *   - a subject {opp}/{them} becomes "y'all": "SET! {opp} going backwards" → "Set! Y'all
 *     going backwards!" (the take the voices.ts header has always documented);
 *   - {bid} as a plain reference becomes "it": "we said {bid}, we got {bid}." → "we said it,
 *     we got it." — except "{bid} total", which reads "that total";
 *   - {card} becomes "that card" (a doubled "that that" collapses), {team} "us",
 *     {partner} "partner", {their} "their", {me} "me", {gap} "a hundred";
 *   - emoji never reach the voice; asterisks neither (they're emphasis markup);
 *   - ALL-CAPS personas (the Hype Man) are read lowercased with punctuation runs collapsed
 *     ("RUN IT!!! ALL OF EM!!!" → "run it! all of em!" — in caps, Kokoro spells short words
 *     like EM as letters) and letter elongations collapsed ("LET'S GOOOO!" → "let's go!");
 *   - finally the shared pronunciation dictionary (pronounce.ts) is applied — the same one
 *     the Web Speech fallback uses, so a line sounds the same on both paths.
 *
 * Three bid lines are special (pinned by apps/web/test/voices.test.ts): they get one take
 * per bid number instead of a generic take — see BID_NUMBER_LINES / spokenBidTake.
 */
import { PERSONAS, type PersonaId } from './personas';
import { applyPronunciation } from './pronounce';

/** raw lines that are recorded once per bid value (clip keys are `${raw}#1` … `${raw}#13`) */
export const BID_NUMBER_LINES = [
  'You bid {bid} for THAT?!',
  'You bid {bid} with WHAT?!',
  "{bid}? that's a lot of books.",
];
const BID_NUMBER_SET = new Set(BID_NUMBER_LINES);

/** the take for a bid-number line at a specific bid (digits: the voice reads the number) */
export function spokenBidTake(raw: string, bid: number): string {
  return applyPronunciation(raw.replace(/\{bid\}/g, String(bid)));
}

const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu;

/** the generic spoken take of a raw line for this persona (undefined for bid-number lines) */
export function spokenTake(raw: string, persona: PersonaId): string | undefined {
  if (BID_NUMBER_SET.has(raw)) return undefined;
  let t = raw;
  // vocatives: "{them}/{opp}," inside the first three words (an opener) drops out
  t = t.replace(/^((?:\S+\s+){0,2}\S*?)\s*\{(?:them|opp)\}\s*,/, '$1,');
  // a vocative at the very end of the line drops with its comma
  t = t.replace(/,?\s*\{(?:them|opp)\}(?=\s*[.!?…]*\s*$)/, '');
  // any remaining name templates become the generic crowd
  t = t.replace(/\{(?:them|opp)\}/g, "y'all");
  t = t.replace(/\{team\}/g, 'us').replace(/\{partner\}/g, 'partner').replace(/\{their\}/g, 'their').replace(/\{me\}/g, 'me');
  t = t.replace(/\{card\}/g, 'that card').replace(/\bthat that\b/gi, 'that');
  t = t.replace(/\{bid\} total/g, 'that total').replace(/\{bid\}/g, 'it');
  t = t.replace(/\{gap\}/g, 'a hundred');
  // markup + emoji never reach the voice
  t = t.replace(/\*+/g, '').replace(EMOJI, '');
  if (PERSONAS[persona].caps) {
    t = t.toLowerCase()
      .replace(/([!?])[!?]+/g, '$1')          // !!! → !
      .replace(/([a-z])\1{3,}/g, '$1');        // goooo → go (elongations are display energy)
  }
  t = applyPronunciation(t);
  // tidy what the drops left behind
  return t.replace(/\s+([,.!?…])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
