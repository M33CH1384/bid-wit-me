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
export function endReasonText(r: TableRules, st: Pick<GameState, 'result' | 'history'>, label: (side: number) => string): string {
  const res = st.result;
  if (!res) return '';
  if (res.endReason === 'shotOut') {
    // both game-over views stamp the big SHOT OUT banner directly above this
    // sentence, so the sentence carries only the detail — never the stamp again
    const who = (res.shotOut ?? []).map(label).join(' & ');
    return `${who} ${st.history.length === 1 ? 'got shot on the first hand' : 'got shot two hands in a row'}.`;
  }
  if (res.endReason === 'floor') return 'Ended by the losing floor.';
  return `First to ${r.targetScore}.`;
}
