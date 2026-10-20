/**
 * iMessage-style time separators + sender grouping for the Social chats (global + DMs).
 * Pure render-time derivation from the per-message `at` timestamps the wire already
 * carries — nothing is stored, so separators and groups stay correct across history
 * backfill, refresh-restore and live appends alike.
 */

/** Same sender within this gap renders as one visual group (tight spacing, one name/avatar). */
export const CHAT_GROUP_GAP_MS = 5 * 60_000;
/** A silence at least this long (or any day change) opens a new segment with a time separator. */
export const CHAT_SEP_GAP_MS = 30 * 60_000;

/** "7:21 AM" */
function timePart(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a); const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * The centered separator label, iMessage format:
 * today → "Today 7:21 AM" · yesterday → "Yesterday 9:03 PM" · older → "Mon Oct 13 4:15 PM".
 */
export function chatTimeLabel(at: number, now = Date.now()): string {
  const time = timePart(at);
  if (sameDay(at, now)) return `Today ${time}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (sameDay(at, y.getTime())) return `Yesterday ${time}`;
  const d = new Date(at);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${month} ${d.getDate()} ${time}`;
}

/** A separator opens a segment: the first line, a new day, or a long silence. */
export function chatNeedsSeparator(prevAt: number | undefined, at: number): boolean {
  if (prevAt === undefined) return true;
  if (!sameDay(prevAt, at)) return true;
  return at - prevAt >= CHAT_SEP_GAP_MS;
}

export interface ChatGroupInfo { separator: boolean; groupStart: boolean; groupEnd: boolean }

/**
 * Where line `i` sits: does a time separator precede it, and is it the first/last line
 * of its sender group? A separator always breaks the group (the new segment re-opens
 * with name + avatar).
 */
export function chatGroupInfo<T extends { from: string; at: number }>(lines: readonly T[], i: number): ChatGroupInfo {
  const l = lines[i]!;
  const prev = lines[i - 1];
  const next = lines[i + 1];
  const separator = chatNeedsSeparator(prev?.at, l.at);
  const groupStart = separator || !prev || prev.from !== l.from || l.at - prev.at >= CHAT_GROUP_GAP_MS;
  const groupEnd = !next || next.from !== l.from || next.at - l.at >= CHAT_GROUP_GAP_MS || chatNeedsSeparator(l.at, next.at);
  return { separator, groupStart, groupEnd };
}
