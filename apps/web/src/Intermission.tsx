import { type ReactNode, useEffect, useRef } from 'react';
import { type GameState, bidLabel, isNilBid, isShot, shotCovers } from '@spades/rules';
import { resultChips, signed } from './ScorePad';
import { sideName } from './Modals';
import { handWinner, streakLabel, streakOf } from './fx';
import { sound } from './audio';
import { haptic } from './haptics';

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

/**
 * Three punched holes. Raster art in /shot/hole.png (original render). The
 * sprite is 40–48px and the glass spiderweb runs out to 1.5× the punch.
 * Rotation and scale are fixed per slot so a reconnect does not reshuffle them.
 * One sits in the top-right gap left of the total, one in the lower left, and one on the progress bar.
 * None of them sit on type.
 */
const HOLES: readonly { x: string; y: string; rot: number; scale: number }[] = [
  { x: '62%', y: '16%', rot: -8, scale: 0.96 }, // top-right gap, left of the total
  { x: '13%', y: '92.5%', rot: 12, scale: 0.87 }, // lower left, in the padding under the bar
  { x: '78%', y: '81%', rot: -6, scale: 1 },    // on the progress bar, clear of the names
];

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
  // Panel blast follows the engine shot (a set, or a busted Nil in 2v2) and a recorded set.
  const shotThisHand = (s: (typeof sides)[number]) => isShot(r, rec.bids, s) || s.contractMade === false;
  // The shotgun at scoring is a set (contractMade === false). A busted Nil already played it
  // when that first book resolved, so the scorecard does not play it again.
  const scoreBoom = (s: (typeof sides)[number]) => s.contractMade === false && !s.nils.some((n) => !n.made);
  const boomSides = sides.filter(scoreBoom);
  const covers = shotCovers(r, st.history, st.result);
  const target = r.targetScore;
  const boomKey = `${st.seed}:${rec.handNo}:${boomSides.map((s) => s.side).join(',')}`;
  const boomed = useRef('');
  useEffect(() => {
    if (!boomSides.length || boomed.current === boomKey) return;
    boomed.current = boomKey;
    boomSides.forEach((_, i) => sound.play('shotgun', i ? { delay: i * 0.12 } : {}));
  }, [boomKey, boomSides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetOn = covers.some((c) => c.sheet);
  const sirenKey = `${st.seed}:${rec.handNo}`;
  const sirened = useRef('');
  useEffect(() => {
    if (!sheetOn || sirened.current === sirenKey) return;
    sirened.current = sirenKey;
    sound.play('docSting', { delay: 0.05 });
    sound.play('siren', { delay: 0.12 });
  }, [sirenKey, sheetOn]);
  // One pattern so each hole's [30] and the tape's [60] land on the punch timeline.
  // iOS and a missing vibrate API skip inside haptic(); the throttle stays at 250ms.
  const noticeIn = sides.some((s) => {
    const cover = covers[s.side];
    return !!cover?.tape && !cover.sheet && isShot(r, rec.bids, s);
  });
  const punched = useRef('');
  useEffect(() => {
    if (!noticeIn || punched.current === sirenKey) return;
    punched.current = sirenKey;
    haptic([30, 60, 30, 60, 30, 90, 60], 'shot-card');
  }, [noticeIn, sirenKey]);

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
              const bidPart = books ? (s.contractMade === false ? `Set at ${s.contract}` : 'Books (hand 1)') : s.contract ? `Bid ${s.contract}` : `Bid ${s.seats.map((x) => bidLabel(rec.bids[x]!)).join(' + ')}`;
              const shot = shotThisHand(s);
              const cover = covers[s.side] ?? { tape: false, sheet: false, siren: false };
              const justShot = isShot(r, rec.bids, s);
              const notice = cover.tape && !cover.sheet;
              return (
                <div key={s.side} className={`tt-team${s.side === mySide ? ' mine' : ''}${shot ? ' blast' : ''}${cover.tape ? ' taped' : ''}${cover.tape && justShot ? ' tape-in' : ''}${notice ? ' notice' : ''}${cover.sheet ? ' shrouded' : ''}${cover.sheet && justShot ? ' sheet-in' : ''}`} data-testid={`recap-side-${s.side}`} data-blast={shot ? 'yes' : 'no'} data-tape={cover.tape ? 'yes' : 'no'} data-sheet={cover.sheet ? 'yes' : 'no'} data-siren={cover.siren ? 'yes' : 'no'}>
                  {notice && (
                    <div className="shot-holes" data-testid={`recap-holes-${s.side}`} aria-hidden="true">
                      {HOLES.map((h, i) => (
                        <img key={i} src="/shot/hole.png" alt="" style={{ left: h.x, top: h.y, animationDelay: `${i * 90}ms`, ['--rot' as string]: `${h.rot}deg`, ['--s' as string]: String(h.scale) }} />
                      ))}
                    </div>
                  )}
                  {cover.sheet && (
                    <div className="shroud" data-testid={`recap-shroud-${s.side}`} aria-hidden="true">
                      <i /><i /><i />
                      <b className="rip" data-testid={`recap-rip-${s.side}`}>RIP<span /><span /><span /></b>
                    </div>
                  )}
                  {cover.tape && (
                    <div className="caution-x" data-testid={`recap-tape-${s.side}`} aria-hidden="true">
                      <img className="tape a" src="/shot/tape.png" alt="" />
                      <img className="tape b" src="/shot/tape.png" alt="" />
                    </div>
                  )}
                  <div className="tt-face">
                  <div className="tt-team-name">
                    <b>{sideName(r, s.side, names)}</b>
                    <span className="tt-badges chips">
                      {notice ? (
                        <>
                          <em className="shot-stamp" data-testid={`recap-shot-stamp-${s.side}`}>SHOT</em>
                          <em className="notice-pill" data-testid={`recap-notice-${s.side}`}>ON NOTICE</em>
                        </>
                      ) : chips.map((c) => <em key={c.text} className={`rchip ${c.kind}`}>{c.text}</em>)}
                      {!books && s.bagsAdded > 0 && <em className="rchip bags">+{s.bagsAdded} bag{s.bagsAdded === 1 ? '' : 's'}</em>}
                      {s.bagPenaltyCount > 0 && <em className="rchip set">Bag penalty {signed(s.bagPenaltyPoints)}</em>}
                    </span>
                  </div>
                  <div className="tt-line" data-testid={`recap-line-${s.side}`}>
                    <span>{bidPart}</span><i>·</i><span>Took {s.tricks}</span>
                    {main && main.kind !== 'books' && !(shot && main.kind === 'set') && <><i>·</i><em className={`rchip ${main.kind}`}>{main.text}</em></>}
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
