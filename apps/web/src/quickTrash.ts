/**
 * Quick-chat "Talk trash" presets for human players (no typing): a contextual tab for what just happened plus a
 * general tab. Lines come from the trash-talk pack, filtered by the table's intensity. Sent as a normal chat line;
 * every client also pops it as a callout bubble by the sender's plate.
 */
import { LINE_META, PACK, type TalkIntensity, type TalkKind, lineAllowed } from '@spades/bots';

const clean = (raw: string) => raw.replace(/^\[[a-z,]+\]\s*/, '').replace(/^!+/, '').replace(/ @\w+$/, '');
/** pack lines by event (templates and condition-gated lines left out: a human picks them blind) */
const BY_KIND: Partial<Record<TalkKind, string[]>> = {};
for (const sec of PACK) for (const raw of sec.lines) {
  const l = clean(raw);
  if (l.includes('{') || LINE_META[l]?.cond) continue;
  (BY_KIND[sec.kind] ??= []).push(l);
}
/** Demetrius's own line sits at the top of every tab it fits (big bid, partner, and the general tab via loud talk) */
export const PINNED_TRASH = 'Slow your roll, cowboy!';
for (const arr of Object.values(BY_KIND)) {
  const i = arr!.indexOf(PINNED_TRASH);
  if (i > 0) { arr!.splice(i, 1); arr!.unshift(PINNED_TRASH); }
}
export const QUICK_CONTEXTS: { kind: TalkKind; label: string }[] = [
  { kind: 'cut', label: 'Cut' }, { kind: 'slam', label: 'Big book' }, { kind: 'setThem', label: 'They got set' },
  { kind: 'bidTooHigh', label: 'Big bid' }, { kind: 'bags', label: 'Bags' }, { kind: 'nilBid', label: 'Nil bid' },
  { kind: 'nilBust', label: 'Nil busted' }, { kind: 'blindNil', label: 'Blind Nil' }, { kind: 'joker', label: 'Joker' },
  { kind: 'boston', label: 'Boston' }, { kind: 'slow', label: 'Slow' }, { kind: 'badHand', label: 'My hand' },
  { kind: 'partnerBlunder', label: 'Partner' }, { kind: 'win', label: 'Game' },
];
const GENERAL_KINDS: TalkKind[] = ['roast', 'slam', 'loudLoser', 'hypePartner', 'prePlay'];
export function quickLines(kind: TalkKind, intensity: TalkIntensity): string[] {
  return (BY_KIND[kind] ?? []).filter((l) => lineAllowed(l, intensity));
}
export function generalLines(intensity: TalkIntensity): string[] {
  return [...new Set([PINNED_TRASH, ...GENERAL_KINDS.flatMap((k) => quickLines(k, intensity))])].filter((l) => lineAllowed(l, intensity));
}
/** every preset (to recognise a callout in the chat) */
export const QUICK_TRASH_SET = new Set(Object.values(BY_KIND).flat() as string[]);
/** one quick line per ~4 s */
export const QUICK_COOLDOWN_MS = 4000;
