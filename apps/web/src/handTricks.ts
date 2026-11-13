/**
 * Play-by-play of the hands already scored in THIS game, so the score pad can
 * review any of them (owner, 2026-11-12: "inside the score pad i should be able
 * to review the tricks for each hand").
 *
 * The engine keeps plays only for the hand in progress — a HandRecord holds
 * counts, not cards — so the table files each hand's tricks here as the hand
 * ends. Kept per game seed, in memory and in localStorage (one game at a time:
 * a new seed replaces the old one), so a resumed game still has the hands that
 * were played before the reload. Hands played before this existed, or on
 * another device, simply have nothing to review.
 */
import type { Trick } from '@spades/rules';

const KEY = 'bwm.handTricks';
interface Stored { seed: string; hands: Record<string, Trick[]> }

let cache: Stored | null = null;

function load(): Stored | null {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Stored) : null;
    if (v && typeof v.seed === 'string' && v.hands && typeof v.hands === 'object') cache = v;
  } catch { /* unreadable: start clean */ }
  return cache;
}

/** File one finished hand's tricks. A different seed starts a fresh record. */
export function rememberHandTricks(seed: string | null | undefined, handNo: number, tricks: readonly Trick[]): void {
  if (!seed || !tricks.length) return;
  let s = load();
  if (!s || s.seed !== seed) s = cache = { seed, hands: {} };
  const have = s.hands[handNo];
  if (have && have.length >= tricks.length) return; // already filed in full
  s.hands[handNo] = tricks.map((t) => ({ ...t, plays: t.plays.map((p) => ({ ...p })) }));
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: memory still has it */ }
}

/** The tricks filed for a hand of this game, or null when there are none. */
export function handTricksFor(seed: string | null | undefined, handNo: number): Trick[] | null {
  if (!seed) return null;
  const s = load();
  if (!s || s.seed !== seed) return null;
  const t = s.hands[handNo];
  return t && t.length ? t : null;
}

/** Tests. */
export function clearHandTricks(): void {
  cache = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
