import { isShot, sideCount } from '@spades/rules';
import type { GameState, HandRecord, TableRules } from '@spades/rules';

/**
 * How many times each side has been shot this game, counted from the scored hands the same way
 * the scorecard covers count a shot (the engine's isShot OR the recorded shot stamp), so
 * unstamped older saves and cutthroat's own fail stamps both count. History-derived, so a
 * resumed game restores the counts — and the stickiness they carry — exactly.
 */
export function shotArms(r: TableRules, history: readonly HandRecord[]): number[] {
  const counts = Array.from({ length: sideCount(r) }, () => 0);
  for (const hand of history) {
    for (const s of hand.sides) {
      if (s.shot === true || isShot(r, hand.bids, s)) counts[s.side] = (counts[s.side] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Sides on their SECOND notice: shot twice this game (owner, 2026-10-28). That notice is
 * STICKY — it stays up for the rest of the game, making their books no longer clears it, and
 * one more shot, whenever it comes, shoots them out.
 */
export function stickyNoticeSides(st: Pick<GameState, 'history' | 'phase' | 'rules'>): number[] {
  if (st.rules.shotOut === false || st.phase === 'gameOver') return [];
  return shotArms(st.rules, st.history).flatMap((c, side) => (c >= 2 ? [side] : []));
}

/** Sides ON NOTICE while the game goes on: shot on the last scored hand, PLUS any side on its sticky second notice (that one stays up even after a made hand). */
export function onNoticeSides(st: Pick<GameState, 'history' | 'phase' | 'rules'>): number[] {
  if (st.rules.shotOut === false || st.phase === 'gameOver') return [];
  const out = new Set(stickyNoticeSides(st));
  const last = st.history[st.history.length - 1];
  if (last) for (const s of last.sides) if (s.shot) out.add(s.side);
  return [...out].sort((a, b) => a - b);
}

/** Chat lines after a hand: who got shot, who's on notice, who's out. `label(side)` = team / player name. */
export function shotChatLines(r: TableRules, rec: HandRecord, st: Pick<GameState, 'result' | 'history'>, label: (side: number) => string): string[] {
  if (r.shotOut === false) return [];
  const out = st.result?.endReason === 'shotOut' ? st.result.shotOut ?? [] : [];
  const hist = st.history[st.history.length - 1] === rec ? st.history : [...st.history, rec];
  const arms = shotArms(r, hist);
  const prev = hist[hist.length - 2];
  return rec.sides.flatMap((s) => {
    if (!s.shot) return [];
    if (out.includes(s.side)) {
      const how = rec.handNo === 1
        ? 'got shot on the first hand'
        : prev?.sides.find((x) => x.side === s.side)?.shot
          ? 'got shot two hands in a row'
          : 'got shot while on notice for good';
      return [`💀 SHOT OUT: ${label(s.side)} ${how}`];
    }
    // The hand that arms a side's SECOND notice says so: this one never clears.
    if ((arms[s.side] ?? 0) >= 2) return [`⚠ ${label(s.side)} got shot · ON NOTICE FOR GOOD: one more shot and they're out — making their books won't clear it`];
    return [`⚠ ${label(s.side)} got shot · ON NOTICE: one more and ${r.partnerships ? "they're" : "they're"} out`];
  });
}

/** Game-over subtitle for each end reason. */
/**
 * The signature headline for a third-set ending (owner, 2026-10-21): the game-over views stamp
 * it as the banner for endReason 'third-set', and the set-animation layer fires its full-screen
 * flash on that same reason — flash fires iff result.endReason === 'third-set'.
 */
export const THIRD_SET_HEADLINE = '3 the Hard Way';

export function endReasonText(r: TableRules, st: Pick<GameState, 'result' | 'history'>, label: (side: number) => string): string {
  const res = st.result;
  if (!res) return '';
  if (res.endReason === 'shotOut') {
    // both game-over views stamp the big SHOT OUT banner directly above this
    // sentence, so the sentence carries only the detail — never the stamp again
    const who = (res.shotOut ?? []).map(label).join(' & ');
    if (st.history.length === 1) return `${who} got shot on the first hand.`;
    // "two hands in a row" only when the previous hand really was a shot for the out side;
    // a sticky second notice can end it across a gap, and the sentence must say that instead.
    const prev = st.history[st.history.length - 2];
    const inARow = (res.shotOut ?? []).every((side) => prev?.sides.find((s) => s.side === side)?.shot);
    return inARow ? `${who} got shot two hands in a row.` : `${who} got shot while on notice for good.`;
  }
  if (res.endReason === 'third-set') {
    // the views stamp the "3 the Hard Way" headline above this line, so — like the shot-out
    // sentence — this carries only the plain detail. The named side is the one knocked out by
    // the third set: result.shotOut in team games; in cutthroat that list holds everyone
    // eliminated, so prefer the final hand's own out-and-shot seats, and never name a winner.
    const last = st.history[st.history.length - 1];
    const fresh = last?.sides?.filter((s) => s.out && s.shot).map((s) => s.side) ?? [];
    const outs = (fresh.length ? fresh : res.shotOut ?? []).filter((s) => !res.winners.includes(s));
    const who = outs.map(label).join(' & ') || 'A side';
    return `${who} got set for the third time — that's the ballgame.`;
  }
  if (res.endReason === 'floor') return 'Ended by the losing floor.';
  return `First to ${r.targetScore}.`;
}
