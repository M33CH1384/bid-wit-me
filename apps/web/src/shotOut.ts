import type { GameState, HandRecord, TableRules } from '@spades/rules';

/** Sides that got shot on the last scored hand while the game goes on: they're ON NOTICE (one more shot and they're out). */
export function onNoticeSides(st: Pick<GameState, 'history' | 'phase' | 'rules'>): number[] {
  if (st.rules.shotOut === false || st.phase === 'gameOver') return [];
  const last = st.history[st.history.length - 1];
  return last ? last.sides.flatMap((s) => (s.shot ? [s.side] : [])) : [];
}

/** Chat lines after a hand: who got shot, who's on notice, who's out. `label(side)` = team / player name. */
export function shotChatLines(r: TableRules, rec: HandRecord, st: Pick<GameState, 'result'>, label: (side: number) => string): string[] {
  if (r.shotOut === false) return [];
  const out = st.result?.endReason === 'shotOut' ? st.result.shotOut ?? [] : [];
  return rec.sides.flatMap((s) => {
    if (!s.shot) return [];
    if (out.includes(s.side)) return [`💀 SHOT OUT: ${label(s.side)} ${rec.handNo === 1 ? 'got shot on the first hand' : 'got shot two hands in a row'}`];
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
    return `${who} ${st.history.length === 1 ? 'got shot on the first hand' : 'got shot two hands in a row'}.`;
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
