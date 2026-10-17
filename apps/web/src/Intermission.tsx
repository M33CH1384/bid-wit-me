import { type ReactNode, useEffect, useRef } from 'react';
import { type GameState, bidLabel, isNilBid, isShot, shotCovers } from '@spades/rules';
import { resultChips, signed } from './ScorePad';
import { sideName } from './Modals';
import { handWinner, streakLabel, streakOf } from './fx';
import { sound } from './audio';
import { haptic } from './haptics';
import { SheetCloth } from './SheetCloth';
import { HOLE_CAP, claimHoleBuzz, holeMarks, holeSlots, markHolePunched, markSheetPlayed, punchedLabel, rememberHoles } from './shotMarks';

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

export function Intermission({
  st, names, mySide, secs, ready, onReady, online, onScorePad, onLeave, series, chatOpen, unread, onChat, runReview,
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
  /** Hand Recap: open the Leave choice (Save & go to menu / Quit game) */
  onLeave?: () => void;
  /** corner chat: unread count while the sheet is closed */
  unread: number;
  chatOpen: boolean;
  onChat: () => void;
}) {
  const r = st.rules;
  const rec = st.history[st.history.length - 1]!;
  // The match is decided when the engine has a result: this recap is then the last stop before
  // the winner flow, never an offer to deal another hand (the shot-out hold in Table.tsx).
  const decided = st.phase === 'gameOver' && !!st.result;
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
  // Hole count is the team's shot count. A new hole buzzes [30] once.
  // The sheet is the engine's elimination. It waits ~400ms after a new punch.
  const streaks = holeMarks(r, st.history);
  const handKey = `${st.seed}:${rec.handNo}`;
  const anim = useRef<{ key: string; punch: Set<string>; waitSheet: Set<number> } | null>(null);
  if (!anim.current || anim.current.key !== handKey) {
    const punch = new Set<string>();
    const waitSheet = new Set<number>();
    for (const s of sides) {
      const info = streaks[s.side] ?? { count: 0, visible: 0, fresh: -1 };
      const marks = rememberHoles(st.seed, s.side, info.count, info.fresh);
      if (info.fresh >= 0 && !marks.punched[info.fresh]) punch.add(`${s.side}:${info.fresh}`);
      if (covers[s.side]?.sheet && info.fresh >= 0 && !marks.sheetPlayed) waitSheet.add(s.side);
    }
    anim.current = { key: handKey, punch, waitSheet };
  }
  useEffect(() => {
    const snap = anim.current;
    if (!snap || snap.key !== handKey) return;
    const timers: number[] = [];
    for (const id of snap.punch) {
      const [side, idx] = id.split(':').map(Number);
      if (claimHoleBuzz(st.seed, side!, idx!)) haptic([30], 'shot-hole');
      timers.push(window.setTimeout(() => markHolePunched(st.seed, side!, idx!), 120));
    }
    if (snap.waitSheet.size) {
      timers.push(window.setTimeout(() => {
        for (const side of snap.waitSheet) markSheetPlayed(st.seed, side);
        haptic([80, 40, 160], 'sheet-drop');
      }, 400));
    }
    return () => { for (const t of timers) window.clearTimeout(t); };
  }, [handKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Sheet and siren both come from shotCovers (synced history + result), so online clients agree.
    // Mute and the volume slider are the sfx bus inside sound.play. The yelp starts as the cloth drops.
    if (!sheetOn || sirened.current === sirenKey) return;
    sirened.current = sirenKey;
    const delay = anim.current?.waitSheet.size ? 0.4 : 0.05;
    sound.play('docSting', { delay });
    sound.play('siren', { delay: delay + 0.04 });
    // The sheet now ROLLS down from the scorecard's top edge: a soft fabric rustle timed to
    // the 620ms roll (same wait delay as the animation), only when a roll will actually play.
    if (anim.current?.waitSheet.size) sound.play('cloth', { delay });
  }, [sirenKey, sheetOn]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tt-backdrop" data-testid="table-talk" data-decided={decided ? 'yes' : 'no'} role="dialog" aria-label="Hand recap">
      {sheetOn && <div className={`police-rim${anim.current?.waitSheet.size ? ' wait' : ''}`} data-testid="police-rim" aria-hidden="true" />}
      <div className="tt glass slant">
        <header className="tt-head">
          <span className="tt-title">HAND {rec.handNo} RECAP</span>
          {series}
          {secs !== null && !decided && <span className={`tt-count ${secs <= 5 ? 'hot' : ''}`} data-testid="talk-count">Next deal {secs}s</span>}
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
          <section className="tt-top-scores" data-testid="recap-top-scores" aria-label="Top scores">
            <h3>TOP SCORES</h3>
            <ol>
              {[...sides].sort((a, b) => b.totalScore - a.totalScore || a.side - b.side).map((s, i) => (
                <li key={s.side} className={s.side === mySide ? 'mine' : ''} data-testid={`recap-top-${s.side}`}>
                  <span className="place">#{i + 1}</span>
                  <span className="who">{sideName(r, s.side, names)}</span>
                  <b>{s.totalScore}</b>
                  <span className="to-target">to {target}</span>
                </li>
              ))}
            </ol>
          </section>
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
              const cover = covers[s.side] ?? { tape: false, sheet: false, siren: false, outHand: null };
              const justShot = isShot(r, rec.bids, s);
              const notice = cover.tape && !cover.sheet;
              const showTape = cover.tape || !!cover.sheet;
              const info = streaks[s.side] ?? { count: 0, visible: 0, fresh: -1 };
              const marks = rememberHoles(st.seed, s.side, info.count, info.fresh);
              const sheetAnim = !!cover.sheet && anim.current!.waitSheet.has(s.side);
              const tod = `Time of death: Hand ${cover.outHand ?? rec.handNo}`;
              const showHoles = info.visible > 0 && (notice || !!cover.sheet);
              return (
                <div key={s.side} className={`tt-team${s.side === mySide ? ' mine' : ''}${shot ? ' blast' : ''}${cover.tape ? ' taped' : ''}${cover.tape && justShot ? ' tape-in' : ''}${notice ? ' notice' : ''}${cover.sheet ? ' shrouded' : ''}${sheetAnim ? ' sheet-in sheet-wait' : ''}`} data-testid={`recap-side-${s.side}`} data-blast={shot ? 'yes' : 'no'} data-tape={cover.tape ? 'yes' : 'no'} data-sheet={cover.sheet ? 'yes' : 'no'} data-siren={cover.siren ? 'yes' : 'no'} data-holes={info.count} data-punched={punchedLabel(marks)}>
                  {showHoles && (
                    <div className="shot-holes" data-testid={`recap-holes-${s.side}`} aria-hidden="true">
                      {holeSlots(!!cover.sheet).slice(0, info.visible).map((h, i) => (
                        <img key={i} className={anim.current!.punch.has(`${s.side}:${i}`) ? 'hole-in' : undefined} src="/shot/hole.png" alt="" style={{ left: h.x, top: h.y, ['--rot' as string]: `${h.rot}deg` }} />
                      ))}
                    </div>
                  )}
                  {cover.sheet && (
                    <div className="shroud" data-testid={`recap-shroud-${s.side}`}>
                      <SheetCloth wait={sheetAnim} />
                      <img className="rip-src" src="/shot/rip.webp" alt="RIP" data-testid={`recap-rip-${s.side}`} />
                    </div>
                  )}
                  {showTape && (
                    <div className="caution-x" data-testid={`recap-tape-${s.side}`} aria-hidden="true">
                      <img className="tape a" src="/shot/tape.webp" alt="" />
                      <img className="tape b" src="/shot/tape.webp" alt="" />
                    </div>
                  )}
                  {cover.sheet && (
                    <p className="tod" data-testid="time-of-death" data-hand={rec.handNo}>{tod}</p>
                  )}
                  <div className="tt-face">
                  <div className="tt-team-name">
                    <b>{sideName(r, s.side, names)}</b>
                    <span className="tt-badges chips">
                      {notice ? (
                        <>
                          <em className="shot-stamp" data-testid={`recap-shot-stamp-${s.side}`}>SHOT</em>
                          {info.count > HOLE_CAP && <em className="shot-tally" data-testid={`recap-shot-tally-${s.side}`}>x{info.count}</em>}
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
                  {/* the running total lives ONLY in TOP SCORES above (founder: no score twice on one screen) */}
                  <div className="tt-stat bags-stat">
                    <small>BAGS</small>
                    <b data-testid={`recap-bags-${s.side}`}>{s.totalBags}</b>
                  </div>
                  <div className="tt-bar" aria-label={`${s.totalScore} of ${target}`}><i style={{ width: `${pct * 100}%` }} /><small>to {target}</small></div>
                  </div>
                </div>
              );
            })}
          </div>
          {runReview}
        </div>

        <footer className="tt-foot stack">
          <button type="button" className="quiet-row-btn" onClick={onScorePad}>Score pad</button>
          {ready && <span className="muted" data-testid="talk-ready-count">{ready.count}/{ready.of} ready</span>}
          <button type="button" className="primary big" data-testid="talk-ready" data-decided={decided ? 'yes' : 'no'} disabled={!!ready?.mine} onClick={onReady}>
            {decided ? 'See final results' : online ? (ready?.mine ? 'Waiting for the table…' : 'Ready') : `Continue to hand ${rec.handNo + 1}`}
          </button>
          {onLeave && <><div className="exit-divider" aria-hidden="true" /><button type="button" className="leave-red" data-testid="recap-leave" onClick={onLeave}>Leave game</button></>}
        </footer>
      </div>
    </div>
  );
}
