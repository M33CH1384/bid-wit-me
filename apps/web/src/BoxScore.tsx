/**
 * ESPN-style scorecards (owner, 2026-10-20): the league's box-score language,
 * shared by the between-hands surfaces and the end-of-game scorecard.
 *
 * - HandsStrip: per-side W/L dots, one row per side — the game's shape at a
 *   glance, no numbers (the recap already shows each total exactly once).
 * - BoxScore: the full end-of-game card — hand-by-hand rows (points for the
 *   hand + running total), a FINAL row in big numerals with the winner in
 *   gold, and headline lines computed ONLY from what the hand records carry:
 *   total books, nils made, the winning side's best hand, and eliminations
 *   (Time of death, from the same shotCovers the recap uses). Nothing
 *   estimated, nothing invented: a line whose data isn't in the records
 *   simply doesn't render. Framing (owner, 2026-10-21): on the final screen
 *   the shared lines list the winner first, and Best hand spotlights the
 *   WINNING side's best hand — the full table above already shows every
 *   side's numbers, so no fact is hidden, the loser just doesn't get the
 *   headline on the winner's screen.
 */
import { type GameState, type HandRecord, shotCovers } from '@spades/rules';
import { handWinner } from './fx';

const sgn = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** Sides that took every book this hand — the Postgame Report's Boston rule. */
export function bostonSides(rec: Pick<HandRecord, 'sides'>): number[] {
  const total = rec.sides.reduce((a, s) => a + s.tricks, 0);
  if (total < 13) return [];
  return rec.sides.filter((s) => s.tricks === total).map((s) => s.side);
}

/**
 * Per-side W/L dots over the hands played: a filled dot in the side's colour
 * for each hand that side won outright, a hollow dot for a hand someone else
 * won, a dim dot for a tied hand — plus the W–L count of decided hands.
 */
export function HandsStrip({ history, sides, label, color, testId }: {
  history: HandRecord[];
  sides: number[];
  label: (side: number) => string;
  color: (side: number) => string;
  testId: string;
}) {
  if (!history.length) return null;
  const winners = history.map((h) => handWinner(h.sides.map((s) => s.points)));
  return (
    <div className="hands-strip" data-testid={testId}>
      {sides.map((side) => {
        const wins = winners.filter((w) => w === side).length;
        const losses = winners.filter((w) => w !== null && w !== side).length;
        return (
          <div className="hs-row" key={side}>
            <span className="hs-name">{label(side)}</span>
            <span className="hs-dots" aria-hidden="true">
              {history.map((h, i) => (
                <i key={h.handNo} className={`hs-dot ${winners[i] === null ? 'tie' : winners[i] === side ? 'win' : 'loss'}`} style={{ ['--side' as string]: color(side) }} title={`Hand ${h.handNo}`} />
              ))}
            </span>
            <span className="hs-rec">{wins}–{losses}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface BoxRow { handNo: number; cells: { side: number; points: number; total: number }[] }

/** Hand-by-hand rows for the box score: each side's points for the hand and its running total after it. */
export function boxScoreRows(history: HandRecord[]): BoxRow[] {
  return history.map((h) => ({
    handNo: h.handNo,
    cells: h.sides.map((s) => ({ side: s.side, points: s.points, total: s.totalScore })),
  }));
}

export interface GameHeadlines {
  /** total books (tricks) per side across the whole game */
  books: { side: number; n: number }[];
  /** nils made per side across the whole game */
  nilsMade: { side: number; n: number }[];
  /** the winning side's biggest hand (null when no winning side ever scored positive) */
  bestHand: { side: number; points: number; handNo: number } | null;
  /** eliminations: the hand each side went out on (shotCovers' outHand — the recap's Time of death) */
  outs: { side: number; handNo: number }[];
}

export function gameHeadlines(st: GameState, winnersArg?: number[]): GameHeadlines {
  const sideIdx = st.scores.map((_, i) => i);
  const winners = winnersArg ?? st.result?.winners ?? [];
  // shared lines read winner first, then the rest in side order (same data,
  // presentation order only); with no result yet this is plain side order
  const winRank = (side: number) => (winners.indexOf(side) === -1 ? sideIdx.length : winners.indexOf(side));
  const winFirst = (items: { side: number; n: number }[]) =>
    [...items].sort((a, b) => winRank(a.side) - winRank(b.side) || a.side - b.side);
  const per = (pick: (h: HandRecord, side: number) => number) =>
    sideIdx.map((side) => ({ side, n: st.history.reduce((a, h) => a + pick(h, side), 0) }));
  const books = winFirst(per((h, side) => h.sides.find((s) => s.side === side)?.tricks ?? 0));
  const nilsMade = winFirst(per((h, side) => h.sides.find((s) => s.side === side)?.nils.filter((n) => n.made).length ?? 0));
  // Best hand spotlights a WINNING side only; before a result exists (no
  // winners known) it falls back to the best hand by any side
  const bestOf = winners.length ? winners : sideIdx;
  let bestHand: GameHeadlines['bestHand'] = null;
  for (const h of st.history) {
    for (const s of h.sides) {
      if (!bestOf.includes(s.side)) continue;
      if (!bestHand || s.points > bestHand.points) bestHand = { side: s.side, points: s.points, handNo: h.handNo };
    }
  }
  if (bestHand && bestHand.points <= 0) bestHand = null;
  const covers = shotCovers(st.rules, st.history, st.result);
  const outs = covers.flatMap((c, side) => (c.outHand != null ? [{ side, handNo: c.outHand }] : []));
  return { books, nilsMade, bestHand, outs };
}

/**
 * The end-of-game scorecard: a box-score table over the finished game's hand
 * history plus its headline lines. Presentation only — it reads the same
 * GameState the table already holds and changes nothing about the flow.
 */
export function BoxScore({ st, label, mySide, winners }: {
  st: GameState;
  label: (side: number) => string;
  mySide: number;
  winners: number[];
}) {
  const rows = boxScoreRows(st.history);
  const head = gameHeadlines(st, winners);
  const finals = st.result?.finalScores ?? st.scores;
  const sides = finals.map((_, i) => i);
  const line = (items: { side: number; n: number }[]) => items.map((x) => `${label(x.side)} ${x.n}`).join(' · ');
  return (
    <section className="box-score" data-testid="box-score" aria-label="Box score">
      <h3 className="box-title">BOX SCORE</h3>
      <div className="box-scroll">
        <table className="box-table">
          <thead>
            <tr>
              <th className="box-hand-h">Hand</th>
              {sides.map((side) => <th key={side} className={winners.includes(side) ? 'win' : ''} title={label(side)}>{label(side)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.handNo} data-testid={`box-row-${row.handNo}`}>
                <th>{row.handNo}</th>
                {row.cells.map((c) => (
                  <td key={c.side} className={c.side === mySide ? 'mine' : ''}>
                    <b className={c.points < 0 ? 'neg' : 'pos'}>{sgn(c.points)}</b>
                    <small>{c.total}</small>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="box-final" data-testid="box-final">
              <th>Final</th>
              {finals.map((score, side) => (
                <td key={side} className={winners.includes(side) ? 'win' : ''}><b>{score}</b></td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="box-lines">
        <div className="box-line"><span>Total books</span><b>{line(head.books)}</b></div>
        {head.nilsMade.some((x) => x.n > 0) && <div className="box-line"><span>Nils made</span><b>{line(head.nilsMade)}</b></div>}
        {head.bestHand && <div className="box-line"><span>Best hand</span><b>{label(head.bestHand.side)} {sgn(head.bestHand.points)} · Hand {head.bestHand.handNo}</b></div>}
        {head.outs.map((o) => (
          <div className="box-line" key={o.side}><span>Out</span><b>{label(o.side)} · Hand {o.handNo}</b></div>
        ))}
      </div>
    </section>
  );
}
