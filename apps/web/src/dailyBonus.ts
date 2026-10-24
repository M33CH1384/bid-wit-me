/**
 * Daily-bonus receipt (owner report, 2026-10-23): "I got a notification for
 * daily coins and tapped it and the app opened up to the profile screen
 * without any notification signifying how many I got or how many I had."
 *
 * The grant itself is server-side and automatic: cred's dailyLogin applies
 * it on the first /api/profile/me read of the UTC day — which is exactly
 * the read the push tap landing makes. The /me payload now reports the
 * grant that read performed (`dailyBonus`), and every /me consumer hands
 * its payload to noteDailyBonus() below, so whichever surface makes the
 * granting read — profile, venue unlocks, wager cred, Compete — raises
 * exactly one receipt carrying the server's own numbers: the amount
 * granted and the resulting balance (the payload's coins.balance is read
 * after the grant server-side, so it already includes it).
 *
 * Once per grant, by construction + by guard: the server reports
 * granted:true only on the granting read; the day is then remembered
 * on-device, so a re-noted copy of the same payload (StrictMode double
 * effects, a second consumer holding the same response) can never
 * double-toast, and tomorrow's grant — a new day — receipts afresh.
 */
import { useSyncExternalStore } from 'react';

export interface DailyBonusGrant {
  amount: number;
  /** the balance after the grant, from the same payload; null only if the
   *  payload somehow carried no balance — the receipt then shows the grant
   *  alone rather than a guessed total */
  balance: number | null;
  streak: number;
  /** UTC grant day, 'YYYY-MM-DD' — the receipt's identity */
  day: string;
}

const SEEN_KEY = 'bwm.dailyBonusReceipt.v1';
let current: DailyBonusGrant | null = null;
const subs = new Set<() => void>();
function emit() { subs.forEach((f) => f()); }

function seenDay(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
function markSeen(day: string) {
  try { localStorage.setItem(SEEN_KEY, day); } catch { /* storage unavailable: the server reports a grant only once, and `current` guards re-notes of the same payload */ }
}

interface MePayloadShape {
  dailyBonus?: { granted?: unknown; amount?: unknown; streak?: unknown; day?: unknown };
  coins?: { balance?: unknown };
}

/** Raise the receipt if this /api/profile/me payload performed today's
 *  grant. Anything else — a non-granting read, a public profile, another
 *  endpoint's payload, another notification kind's data — is ignored:
 *  the receipt is scoped to the daily grant and nothing else. */
export function noteDailyBonus(payload: unknown): void {
  const p = payload as MePayloadShape | null;
  const d = p?.dailyBonus;
  if (!d || d.granted !== true) return;
  if (typeof d.amount !== 'number' || typeof d.day !== 'string') return;
  if (current?.day === d.day) return;
  if (seenDay() === d.day) return;
  markSeen(d.day);
  current = {
    amount: d.amount,
    balance: typeof p?.coins?.balance === 'number' ? p.coins.balance : null,
    streak: typeof d.streak === 'number' ? d.streak : 0,
    day: d.day,
  };
  emit();
}

export function dismissDailyBonus(): void {
  if (!current) return;
  current = null;
  emit();
}

export function useDailyBonus(): DailyBonusGrant | null {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => current,
    () => current,
  );
}
