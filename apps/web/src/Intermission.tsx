import { type ReactNode, useEffect, useRef } from 'react';
import { type GameState, bidLabel, isNilBid, isShot, shotCovers } from '@spades/rules';
import { resultChips, signed } from './ScorePad';
import { sideName } from './Modals';
import { handWinner, streakLabel, streakOf } from './fx';
import { sound } from './audio';

/**
 * Hand recap between hands (online and offline).
 * Header (hand number + series chip), one card per side — two teams, or one card per player in Cutthroat —
 * then Score pad and Continue. Chat, the avatar strip, the shuffle animation, and the team-name editor
 * are not part of this screen. Chat opens from the corner button.
 */
export interface Callout { kind: 'shot' | 'gotShot' | 'streak' | 'nil' | 'bust'; text: string; side?: number; level?: number; /** shot pop-up: big headline + detail line */ title?: string; sub?: string }

/** What to shout about for the latest scored hand (also drives the fx pop-ups). */
export function calloutsFor(st: GameState, mySide: number, names: string[]): Callout[] {
  const r = st.rules;
  const rec = st.history[st.history.length - 1];
  if (!rec) return [];
  const out: Callout[] = [];
  for (const s of rec.sides) {
    if (s.contractMade === false) {
      // name who got shot: "BUCS GOT SHOT: bid 8, took 6" (team + its players in 2v2, the player in Cutthroat)
      const who = sideName(r, s.side, names);
      const players = r.partnerships ? s.seats.map((x) => names[x]).join(' & ') : '';
      const detail = `bid ${s.contract}, took ${s.contractTricks}`;
      out.push({
        kind: s.side === mySide ? 'gotShot' : 'shot', side: s.side,
        text: `${who} GOT SHOT: ${detail}${players && players !== who ? ` (${players})` : ''}`,
        title: `${who} GOT SHOT`.toUpperCase(),
        sub: `${detail}${players && players !== who ? ` · ${players}` : ''}`,
      });
    }
    for (const nl of s.nils) out.push({ kind: nl.made ? 'nil' : 'bust', side: s.side, text: `${names[nl.seat]} ${nl.made ? 'made' : 'busted'} ${rec.bids[nl.seat] === 'blindNil' ? 'Blind Nil' : 'Nil'}` });
  }
  const w = handWinner(rec.sides.map((s) => s.points));
  if (w !== null) {
    const n = streakOf(st.history, w);
    const label = streakLabel(n);
    if (label) out.push({ kind: 'streak', side: w, level: n, text: `${label} · ${sideName(r, w, names)} ${n} in a row` });
  }
  return out;
}

/** Buckshot sits on the panel edges so the bid/took line in the middle stays readable. */
const PELLETS: readonly (readonly [number, number, number])[] = [
  [8, 12, 6], [22, 6, 3.5], [46, 7, 3], [70, 8, 4], [90, 11, 5],
  [4, 24, 3], [96, 20, 3.5],
  [5, 82, 4], [14, 94, 5], [36, 96, 3.5], [58, 95, 4], [80, 93, 3.5], [93, 88, 6],
];

function BlastMarks({ side }: { side: number }) {
  return (
    <>
      <div className="blast-flash" aria-hidden="true" />
      <div className="blast-holes" aria-hidden="true" data-testid={`recap-blast-${side}`}>
        {PELLETS.map(([x, y, r], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%`, width: r * 2, height: r * 2 }} />)}
      </div>
      <svg className="blast-cracks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <g fill="none" stroke="rgba(255, 244, 214, 0.95)" strokeWidth="1.7" strokeLinecap="round">
          <path vectorEffect="non-scaling-stroke" d="M8 12 L18 22 L14 32" />
          <path vectorEffect="non-scaling-stroke" d="M90 11 L78 22 L82 32" />
          <path vectorEffect="non-scaling-stroke" d="M14 94 L24 82 L22 72" />
          <path vectorEffect="non-scaling-stroke" d="M93 88 L80 78 L82 68" />
          <path vectorEffect="non-scaling-stroke" d="M4 24 L12 28" />
          <path vectorEffect="non-scaling-stroke" d="M96 20 L88 26" />
        </g>
      </svg>
    </>
  );
}

export function Intermission({
  st, names, mySide, secs, ready, onReady, online, onScorePad, series, chatOpen, unread, onChat, runReview,
}: {
  /** rematch series chip */
  series?: ReactNode;
  /** cleared hands from a Run it!, in the scroll — never a full-screen scrim over the recap */
  runReview?: ReactNode;
  st: GameState;
  names: string[];
  mySide: number;
  /** countdown to the next hand (online), or null */
  secs: number | null;
  /** online: ready state ("2/4 ready") */
  ready?: { mine: boolean; count: number; of: number };
  onReady: () => void;
  online: boolean;
  onScorePad: () => void;
  /** corner chat: unread count while the sheet is closed */
  unread: number;
  chatOpen: boolean;
  onChat: () => void;
}) {
  const r = st.rules;
  const rec = st.history[st.history.length - 1]!;
  const callouts = calloutsFor(st, mySide, names);
  const notes = callouts.filter((c) => c.kind !== 'shot' && c.kind !== 'gotShot');
  const sides = rec.sides;
  const shotSides = sides.filter((s) => s.contractMade === false);
  const covers = shotCovers(r, st.history, st.result);
  const target = r.targetScore;
  const boomKey = `${st.seed}:${rec.handNo}:${shotSides.map((s) => s.side).join(',')}`;
  const boomed = useRef('');
  useEffect(() => {
    if (!shotSides.length || boomed.current === boomKey) return;
    boomed.current = boomKey;
    shotSides.forEach((_, i) => sound.play('shotgun', i ? { delay: i * 0.12 } : {}));
  }, [boomKey, shotSides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetOn = covers.some((c) => c.sheet);
  const sirenKey = `${st.seed}:${rec.handNo}`;
  const sirened = useRef('');
  useEffect(() => {
    if (!sheetOn || sirened.current === sirenKey) return;
    sirened.current = sirenKey;
    sound.play('docSting', { delay: 0.05 });
    sound.play('siren', { delay: 0.12 });
  }, [sirenKey, sheetOn]);

  return (
    <div className="tt-backdrop" data-testid="table-talk" role="dialog" aria-label="Hand recap">
      {sheetOn && (
        <div className="police-lights" data-testid="police-lights" aria-hidden="true">
          <i className="red" /><i className="blue" />
        </div>
      )}
      <div className="tt glass slant">
        <header className="tt-head">
          <span className="tt-title">HAND {rec.handNo} RECAP</span>
          {series}
          {secs !== null && <span className={`tt-count ${secs <= 5 ? 'hot' : ''}`} data-testid="talk-count">Next deal {secs}s</span>}
        </header>
        <button
          type="button"
          className={`tt-chat-btn ${chatOpen ? 'on' : ''}`}
          data-testid="recap-chat"
          aria-expanded={chatOpen}
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          onClick={onChat}
        >
          {chatOpen ? '✕' : '💬'}
          {!chatOpen && unread > 0 && <span className="unread" data-testid="recap-unread">{unread}</span>}
        </button>

        <div className="tt-body">
          {notes.length > 0 && (
            <div className="tt-callouts">
              {notes.map((c, i) => <span key={i} className={`tt-callout ${c.kind}`}>{c.kind === 'streak' ? '🔥 ' : ''}{c.text}</span>)}
            </div>
          )}
          <div className={`tt-recap${sides.length > 2 ? ' crowded' : ''}`} data-testid="talk-recap">
            {sides.map((s) => {
              // same words as the score pad: "Bid 8 · Took 6 · SET · −80", then "You: bid 5, took 4" per player
              const books = s.seats.every((x) => rec.bids[x] === 'books');
              const pct = Math.max(0, Math.min(1, s.totalScore / target));
              const chips = resultChips(r, rec, s, st);
              const main = chips.find((c) => c.kind === 'made' || c.kind === 'set' || c.kind === 'books');
              const bidPart = books ? 'Books (hand 1)' : s.contract ? `Bid ${s.contract}` : `Bid ${s.seats.map((x) => bidLabel(rec.bids[x]!)).join(' + ')}`;
              const shot = s.contractMade === false;
              const cover = covers[s.side] ?? { tape: false, sheet: false, siren: false };
              const justShot = isShot(r, rec.bids, s);
              return (
                <div key={s.side} className={`tt-team${s.side === mySide ? ' mine' : ''}${shot ? ' blast' : ''}${cover.tape ? ' taped' : ''}${cover.tape && justShot ? ' tape-in' : ''}${cover.sheet ? ' shrouded' : ''}${cover.sheet && justShot ? ' sheet-in' : ''}`} data-testid={`recap-side-${s.side}`} data-blast={shot ? 'yes' : 'no'} data-tape={cover.tape ? 'yes' : 'no'} data-sheet={cover.sheet ? 'yes' : 'no'} data-siren={cover.siren ? 'yes' : 'no'}>
                  {shot && <BlastMarks side={s.side} />}
                  {cover.sheet && (
                    <div className="shroud" data-testid={`recap-shroud-${s.side}`} aria-hidden="true">
                      <i /><i /><i />
                      <b className="rip" data-testid={`recap-rip-${s.side}`}>RIP<span /><span /><span /></b>
                    </div>
                  )}
                  {cover.tape && (
                    <div className="caution-tape" data-testid={`recap-tape-${s.side}`} aria-hidden="true">
                      <b>CAUTION</b><b>SHOT</b><b>CAUTION</b><b>SHOT</b><b>CAUTION</b><b>SHOT</b>
                    </div>
                  )}
                  <div className="tt-team-name">
                    <b>{sideName(r, s.side, names)}</b>
                    <span className="tt-badges chips">
                      {chips.map((c) => <em key={c.text} className={`rchip ${c.kind}`}>{c.text}</em>)}
                      {!books && s.bagsAdded > 0 && <em className="rchip bags">+{s.bagsAdded} bag{s.bagsAdded === 1 ? '' : 's'}</em>}
                      {s.bagPenaltyCount > 0 && <em className="rchip set">Bag penalty {signed(s.bagPenaltyPoints)}</em>}
                    </span>
                  </div>
                  <div className="tt-line" data-testid={`recap-line-${s.side}`}>
                    <span>{bidPart}</span><i>·</i><span>Took {s.tricks}</span>
                    {main && main.kind !== 'books' && <><i>·</i><em className={`rchip ${main.kind}`}>{main.text}</em></>}
                    <i>·</i><b className={s.points < 0 ? 'neg' : 'pos'} data-testid={`recap-points-${s.side}`}>{signed(s.points)}</b>
                  </div>
                  <ul className="tt-players" data-testid={`recap-players-${s.side}`}>
                    {s.seats.map((x) => {
                      const bd = rec.bids[x]!;
                      const bid = bd === 'books' ? null : isNilBid(bd) ? bidLabel(bd) : `bid ${bd}`;
                      return <li key={x}><b>{names[x]}:</b> {bid ? `${bid}, took ${rec.tricksWon[x]}` : `took ${rec.tricksWon[x]}`}</li>;
                    })}
                  </ul>
                  <div className="tt-stat total">
                    <small>TOTAL</small>
                    <b data-testid={`recap-total-${s.side}`}>{s.totalScore}</b>
                    <span className="tt-bags">{s.totalBags} bag{s.totalBags === 1 ? '' : 's'}</span>
                  </div>
                  <div className="tt-bar" aria-label={`${s.totalScore} of ${target}`}><i style={{ width: `${pct * 100}%` }} /><small>to {target}</small></div>
                </div>
              );
            })}
          </div>
          {sheetOn && (
            <p className="tod" data-testid="time-of-death" data-hand={rec.handNo}>
              {Array.from(`Time of death: Hand ${rec.handNo}`, (ch, i) => (
                <span key={i} style={{ animationDelay: `${(0.35 + i * 0.055).toFixed(3)}s` }}>{ch === ' ' ? '\u00a0' : ch}</span>
              ))}
            </p>
          )}
          {runReview}
        </div>

        <footer className="tt-foot bid-row">
          <button type="button" onClick={onScorePad}>Score pad</button>
          {ready && <span className="muted" data-testid="talk-ready-count">{ready.count}/{ready.of} ready</span>}
          <button type="button" className="primary big" data-testid="talk-ready" disabled={!!ready?.mine} onClick={onReady}>
            {online ? (ready?.mine ? 'Waiting for the table…' : 'Ready') : 'Continue'}
          </button>
        </footer>
      </div>
    </div>
  );
}
