import { booksStillNeeded, isNilBid, isShot, sideCount, sideOf, tkoOutSides } from '@spades/rules';
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

/**
 * First-notice sides that have already made their books THIS hand (owner, 2026-11-13: "If a team is
 * on notice and they make their books the on notice badge should dissolve"). The danger a first
 * notice warns about is getting shot again this hand; once the side's contract is covered that
 * cannot happen, so the badge can go now instead of sitting there until the hand is scored.
 *
 * Not cleared early:
 *  - a sticky second notice — making their books never clears that one;
 *  - a side with a Nil bidder — in a partnership a Nil that takes a book is a shot too, so the side
 *    is not safe until the hand ends;
 *  - a side with no numeric contract (nothing to make), and any hand that is not being played.
 */
export function noticeMadeSides(st: Pick<GameState, 'history' | 'phase' | 'rules' | 'bids' | 'tricksWon'>): number[] {
  if (st.phase !== 'playing') return [];
  const sticky = stickyNoticeSides(st);
  return onNoticeSides(st).filter((side) => {
    if (sticky.includes(side)) return false;
    const seats = Array.from({ length: st.rules.playerCount }, (_, i) => i).filter((s) => sideOf(s, st.rules) === side);
    if (seats.some((s) => isNilBid(st.bids[s]!))) return false;
    const needed = booksStillNeeded(st.rules, st.bids, st.tricksWon, side);
    return needed !== null && needed <= 0;
  });
}

/**
 * The PATH a shot-out ending took, read from history alone (owner naming,
 * 2026-10-28): shot on hand 1, shot on the final two hands in a row, or shot
 * across a gap while on a sticky second notice. `history` must END on the
 * hand the side was shot out on — every caller names an ending, so its last
 * record is the hand that ended the game.
 */
export type ShotOutPath = 'first-hand' | 'back-to-back' | 'sticky';

/**
 * The ending's NAME per path (owner, 2026-10-28): "3 the hard way" is ONLY
 * for three sets (endReason 'third-set', THIRD_SET_HEADLINE below — a
 * different ending, never renamed by this map). A shot-out ending is a
 * 1ST ROUND TKO when it lands on hand 1, SHOT BACK 2 BACK for two in a row,
 * and plain SHOT OUT for the sticky ending across a gap, which he named no
 * special name — SHOT OUT is the deliberate fallback there.
 */
export const SHOT_OUT_NAMES: Record<ShotOutPath, string> = {
  'first-hand': '1ST ROUND TKO',
  'back-to-back': 'SHOT BACK 2 BACK',
  sticky: 'SHOT OUT',
};

export function shotOutPathFor(history: readonly HandRecord[], side: number): ShotOutPath {
  const last = history[history.length - 1];
  if (last && last.handNo === 1) return 'first-hand';
  const prev = history[history.length - 2];
  const prevSide = prev?.sides?.find((x) => x.side === side);
  // No recorded evidence about the previous hand → the classic reading stands
  // (the same fallback endReasonText uses): the shot that ended it followed
  // the one before it.
  if (!prevSide || prevSide.shot) return 'back-to-back';
  return 'sticky';
}

/**
 * The name of the shot-out ending for ONE side. This is the ONE shared
 * derivation every surface reads — the game-over banner, the 💀 chat call,
 * and the recap finale plaque — so they can never name different endings
 * for the same game.
 */
export function shotOutEndingName(history: readonly HandRecord[], side: number): string {
  return SHOT_OUT_NAMES[shotOutPathFor(history, side)];
}

/**
 * The name the game-over views stamp on the banner for a shotOut ending.
 * The out sides are the FINAL hand's own: result.shotOut names exactly
 * those in both team and cutthroat games (rankedResult's justOut), and the
 * final record's out-and-shot rows are the belt-and-braces source (the
 * same derivation endReasonText's third-set branch uses). One shared path
 * → that path's name; both sides out on the same hand by DIFFERENT paths
 * → plain SHOT OUT, the deterministic shared fallback (per-side surfaces
 * still name each side's own path).
 */
export function shotOutBannerFor(st: Pick<GameState, 'result' | 'history'>): string {
  const res = st.result;
  if (!res || res.endReason !== 'shotOut') return SHOT_OUT_NAMES.sticky;
  const last = st.history[st.history.length - 1];
  const fresh = last?.sides?.filter((s) => s.out && s.shot).map((s) => s.side) ?? [];
  const outs = fresh.length ? fresh : res.shotOut ?? [];
  const names = new Set(outs.map((side) => shotOutEndingName(st.history, side)));
  return names.size === 1 ? [...names][0]! : SHOT_OUT_NAMES.sticky;
}

/**
 * The viewer's direction in a finished game's 1st Round TKO, if any —
 * the postgame mirror of the career stat's pinned definition (the
 * engine's tkoOutSides: the same hand-1 out fact the banner above names
 * '1ST ROUND TKO'). 'dealt' is claimed only by a WINNER whose opponents
 * went out (a surviving non-winner in cutthroat still banks the stat
 * server-side; the postgame note is the winner's line). 'suffered' when
 * the viewer's own side went out and didn't win — in a both-out team
 * game the score-winner reads 'dealt' and the loser 'suffered', the
 * W–L pattern the stat itself keeps. Null when no side went out on
 * hand 1 — including the hand-1 double-shot that tied and played on,
 * which the ending logic never names a TKO.
 */
export function tkoDirectionFor(st: Pick<GameState, 'rules' | 'history' | 'result'>, mySide: number): 'dealt' | 'suffered' | null {
  const outs = tkoOutSides(st.rules, st.history, st.result);
  if (!outs.length) return null;
  const won = st.result?.winners.includes(mySide) ?? false;
  if (outs.includes(mySide) && !won) return 'suffered';
  if (won && outs.some((o) => o !== mySide)) return 'dealt';
  if (outs.includes(mySide)) return 'suffered';
  return null;
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
      // No recorded evidence about the previous hand → keep the long-standing wording;
      // the sticky wording is used only when the previous record proves a gap.
      const prevSide = prev?.sides?.find((x) => x.side === s.side);
      const how = rec.handNo === 1
        ? 'got shot on the first hand'
        : !prevSide || prevSide.shot
          ? 'got shot two hands in a row'
          : 'got shot while on notice for good';
      return [`💀 ${shotOutEndingName(hist, s.side)}: ${label(s.side)} ${how}`];
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
    // both game-over views stamp the ending's name (shotOutBannerFor: 1ST ROUND
    // TKO / SHOT BACK 2 BACK / SHOT OUT) directly above this sentence, so the
    // sentence carries only the detail — never the name again
    const who = (res.shotOut ?? []).map(label).join(' & ');
    if (st.history.length === 1) return `${who} got shot on the first hand.`;
    // "two hands in a row" unless the previous hand's record proves a gap (no shot for the
    // out side): a sticky second notice can end it across a gap, and the sentence must say
    // that instead. A record with no sides carries no evidence — the classic wording stands.
    const prev = st.history[st.history.length - 2];
    const inARow = (res.shotOut ?? []).every((side) => {
      const prevSide = prev?.sides?.find((s) => s.side === side);
      return prevSide ? !!prevSide.shot : true;
    });
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
