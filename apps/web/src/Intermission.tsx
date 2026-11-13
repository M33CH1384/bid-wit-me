import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type GameState, bidLabel, isNilBid, isShot, shotCovers, sideOf } from '@spades/rules';
import { resultChips, sideColor, signed } from './ScorePad';
import { wheelsMade } from './landCue';
import { HandsStrip, bostonSides } from './BoxScore';
import { sideName } from './Modals';
import { matchPoint, matchPointHeadline } from './decider';
import './decider.css';
import { handWinner, streakLabel, streakOf, useReduceEffects } from './fx';
import { sound } from './audio';
import GearIcon from './GearIcon';
import { LeagueTicker } from './social/LeagueTicker';
import { requestSettingsSheet } from './settingsSheet';
import { haptic } from './haptics';
import { SetCover } from './animfx/SetCover';
import { PhotoFinishTape, VictoryConfetti } from './RecapFx';
import { CONFETTI_GOLDS } from './recapfx';
import { photoFinish, winMargin } from './animfx/detect';
import { finaleHeadlineFor, isThirdSetEnd, resolveSetAnim, setTierForCover } from './setAnims';
import { shotOutPathFor } from './shotOut';
import { useClearedStoryStops } from './storyDecks';
import { HOLE_CAP, claimHoleBuzz, holeMarks, holeSlots, holeSmoking, markHolePunched, markSheetPlayed, punchedLabel, rememberHoles } from './shotMarks';

/**
 * The ending showcase beat (Option C, owner 2026-11-05): when a game ends
 * BY A SET (shotOut / third-set), the decided stop is no longer the
 * between-hands recap with a "See final results" button — it is the
 * finale cover card(s) alone on a bare stage, auto-advancing to the
 * results when the show completes; a tap on the backdrop clears it
 * sooner, and no press is ever required. The beat's length is the show's
 * own length, counted from the presented gate (the same lift that starts
 * every cover clock):
 *  - FINALE_FLASH_DELAY_MS — the third-set finale's EXISTING delay: the
 *    3 THE HARD WAY flash plays first and the finale rides behind it.
 *    One const, shared with the SetCover delayMs below, so the card and
 *    the beat can never drift apart.
 *  - ENDING_BEAT_COVER_MS — a full finale cover play. The roster's
 *    longest is the rooftop at 4.7s (animfx.css); the finale headline is
 *    fully stamped at delay + 1.55s, well inside this window.
 *  - ENDING_BEAT_HOLD_MS — the stamped end state holds, readable, before
 *    the cut to results (transient reveals linger — standing rule).
 * No animation duration changes; this only decides when the SURFACE moves on.
 */
export const FINALE_FLASH_DELAY_MS = 2300;
export const ENDING_BEAT_COVER_MS = 5000;
export const ENDING_BEAT_HOLD_MS = 1000;
export function endingBeatMs(thirdSet: boolean): number {
  return (thirdSet ? FINALE_FLASH_DELAY_MS : 0) + ENDING_BEAT_COVER_MS + ENDING_BEAT_HOLD_MS;
}

/**
 * Hand recap between hands (online and offline).
 * Header (hand number + series chip), one card per side — two teams, or one card per player in Cutthroat —
 * then Score pad and Continue. Chat, the avatar strip, the shuffle animation, and the team-name editor
 * are not part of this screen. Chat opens from the corner button.
 */
export interface Callout { kind: 'shot' | 'gotShot' | 'streak' | 'nil' | 'bust' | 'boston' | 'wheels' | 'nuke' | 'tossed'; text: string; side?: number; level?: number; /** shot pop-up: big headline + detail line */ title?: string; sub?: string }

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
  // The hand's headline moments, from the record itself (league box-score pass):
  // the stamped nuke, a Boston (every book), and Wheels made (the same
  // wheelsMade that drives the celebration fx — no second definition).
  if (rec.nuke) out.push({ kind: 'nuke', side: sideOf(rec.nuke.seat, r), text: `☢ ${names[rec.nuke.seat]} blew the nuke` });
  // A tossed hand ended early by unanimous vote: say so FIRST, and never let
  // the played-out feats speak for it — no Boston (books were never played)
  // and no Wheels line over a hand the table threw in.
  if (rec.tossed) {
    const setNames = rec.tossed.setSides.map((s) => sideName(r, s, names)).join(' and ');
    out.unshift({ kind: 'tossed', text: rec.tossed.setSides.length > 1 ? 'Cards tossed — both sides scored as set on the bids' : `Cards tossed — ${setNames} couldn't get there; hand scored on the bids` });
  } else {
    for (const side of bostonSides(rec)) out.push({ kind: 'boston', side, text: `Boston — ${sideName(r, side, names)} took every book` });
    for (const wm of wheelsMade(r, rec)) out.push({ kind: 'wheels', side: wm.side, text: `Wheels — ${sideName(r, wm.side, names)} bid ${wm.bid} and took ${wm.books}` });
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
  st, names, mySide, secs, ready, onReady, online, onScorePad, onLeave, series, chatOpen, unread, onChat, trickReview, renegeCall, setAnimCtx,
}: {
  /** rematch series chip */
  series?: ReactNode;
  /** the trick browser over the hand just played (the score card's Review
   *  control, owner 2026-10-24), rendered in the FOOTER in line with the
   *  Leave button — one row, two half-width buttons (owner, 2026-11-07,
   *  superseding the 2026-10-26 header siting: the header line cost the
   *  score cards their height in portrait — the second team card was
   *  sliced by the pinned footer — while the footer is pinned and visible
   *  with no scroll in every orientation, so the 2026-10-26 landscape
   *  requirement still holds). The recap's ONLY review entry: the Run It
   *  cleared-hands pill that used to sit beside it was removed by the
   *  2026-10-26 order — the tornado's cleared hands stay reachable from
   *  the table's RUN IT! chip once play resumes. */
  trickReview?: ReactNode;
  /** Renege tables: the "Call renege" button while this seat still has a book it could call (the window stays open until the next deal). */
  renegeCall?: ReactNode;
  /** Set-animation context (owner, 2026-10-21): the story stop this match is
   *  played at (the house — its animation plays here earned or not), the
   *  room's venue for "Match the room", and the player's picker choice.
   *  Absent (older callers/tests) = a plain non-story room on auto. */
  setAnimCtx?: { storyStopId?: string | null; venueId?: string | null; setting?: string };
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
  // The match is decided when the engine has a result: this surface is then the last stop before
  // the winner flow, never an offer to deal another hand (the ending beat in Table.tsx).
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
  // Set animations (owner, 2026-10-21): the earned per-stop treatments from
  // setAnims.ts resolve per set side below. The retired caution tape / white
  // sheet pair is never selected anymore — no unlocks, no animation.
  const { cleared } = useClearedStoryStops();
  const reduceFx = useReduceEffects();
  // The third-set ending's signature moment: this recap is the final hand
  // and the engine says the game ended BY the third set.
  const thirdSetEnd = decided && isThirdSetEnd(st.result);
  // Option C (owner, 2026-11-05): a game ended BY A SET takes the showcase
  // beat — the finale cover card(s) alone, no recap furniture, then the
  // auto-advance below hands over to the results. Any other decided state
  // keeps the decided recap exactly as before (Table never routes one
  // here — target/floor endings go straight to results — so this is the
  // component's unchanged fallback, not a flow).
  const showcase = decided && (st.result?.endReason === 'shotOut' || st.result?.endReason === 'third-set');
  // The beat's cast: exactly the sides whose cover is finale-tier (the
  // sheet — the sides this ending knocked out), rendered by the same card
  // map as the recap. Null outside the beat.
  const beatCast = showcase ? sides.filter((s) => setTierForCover(covers[s.side] ?? { tape: false, sheet: false }) === 'finale') : null;
  // Hole count is the team's shot count. A new hole buzzes [30] once.
  // The sheet is the engine's elimination. It waits ~400ms after a new punch.
  const streaks = holeMarks(r, st.history);
  const smoking = holeSmoking(r, st.history);
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
  // Presentation gate (owner, 2026-10-21): a fresh set cover's CSS clock used
  // to start at MOUNT — while the sheet was still fading in (.tt-backdrop's
  // fade-up, .35s) and, in the single-column layout, while the set side's
  // card sat below the fold of the sheet's scrollport — so the animation
  // finished before the player ever saw the card ("the animation happened
  // before we got to the screen"). `presented` flips when the entrance has
  // completed; until then CSS holds every fresh cover (and the tape-in
  // jolt) paused at its first frame (animfx.css), and each SetCover ALSO
  // waits for its own card to be in view (its sc-wait gate). The finale's
  // hard-way delay counts from here, so flash → finale order is preserved.
  const [presented, setPresented] = useState(false);
  // Match point (decider.ts): one made hand can end the match from here. Never on a decided recap.
  const mp = decided ? null : matchPoint(r, st.scores, st.eliminated);
  const mpTier = mp?.tier ?? null;
  useEffect(() => { if (presented && mpTier) sound.play('showdownOpen', { gain: mpTier === 'decider' ? 1 : 0.6 }); }, [presented, mpTier]);
  useEffect(() => {
    const t = window.setTimeout(() => setPresented(true), 350);
    return () => window.clearTimeout(t);
  }, []);
  // The beat's advance (Option C): once the presented gate lifts, the
  // clock runs the show's own length (endingBeatMs), then onReady fires
  // exactly once — Table reads that as "the beat is done" and opens the
  // results. A tap on the backdrop takes the same path sooner. onReady is
  // read through a ref so a Table re-render (chat ticks, fx state) can
  // never restart the clock, and the done-ref makes timer-vs-tap
  // exactly-once. An empty cast (unreachable for set endings — they
  // always sheet the out side) collapses the beat to zero rather than
  // holding a blank stage.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const beatDoneRef = useRef(false);
  useEffect(() => { beatDoneRef.current = false; }, [handKey]);
  const advanceBeat = () => {
    if (beatDoneRef.current) return;
    beatDoneRef.current = true;
    onReadyRef.current();
  };
  useEffect(() => {
    if (!showcase || !presented) return;
    const t = window.setTimeout(advanceBeat, beatCast && beatCast.length ? endingBeatMs(thirdSetEnd) : 0);
    return () => window.clearTimeout(t);
  }, [showcase, presented, handKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The victory celebration (owner, 2026-10-28: "when this screen loads
  // in landscape I never get to see the animation"). The confetti and
  // the Photo Finish tape used to be fired by AnimFxLayer on the
  // RESULT STATE's arrival — while the finished trick was still in its
  // hold (1,150 ms plain; ~5 s behind a nuked or Run-It final trick),
  // long before this sheet could present. Their whole 2.3 s / 3 s life
  // elapsed over the table, and the player met only the end state.
  // They live here now, on the presenting surface, gated on the same
  // `presented` state as the set covers: the celebration starts when
  // the sheet is actually on screen, plays in full view over it, and a
  // tap anywhere clears it early. Winners get the rain; the tape
  // prints the real final scores. Reduced motion collapses the rain
  // to its still pose.
  const [fxOff, setFxOff] = useState(false);
  const iWon = decided && !!st.result && st.result.winners.includes(mySide);
  const photo = decided && !!st.result && photoFinish(st.result)
    ? (() => {
        const fs = st.result!.finalScores ?? [];
        const winners = new Set(st.result!.winners);
        return {
          w: Math.max(...fs.filter((_, i) => winners.has(i))),
          l: Math.max(...fs.filter((_, i) => !winners.has(i))),
          m: winMargin(st.result!) ?? 0,
        };
      })()
    : null;
  // The recap opens at the TOP of its scrollport, every hand (owner,
  // 2026-10-21): the sheet's scroll position could survive into the next
  // recap (same scrollport node across the decided hold), opening the
  // sheet mid-scroll with the HANDS strip's label sliced behind the
  // header. Reset on mount and on every hand change — never on re-render,
  // so scrolling DURING a recap is never fought.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = 0;
  }, [handKey]);
  // See-through bullet holes (owner, 2026-11-12: "the hole for the bullet should show the
  // back ground no?"). The hole picture is cut out in the middle; here the recap sheet itself is
  // masked at each hole's centre, so the room behind the recap shows through the card AND the
  // sheet under it. Measured from the rendered holes (they sit in % / px slots that move with the
  // layout), and re-measured when the sheet resizes or its body scrolls.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const sheet = body?.closest<HTMLElement>('.tt');
    if (!body || !sheet) return;
    const apply = () => {
      const sr = sheet.getBoundingClientRect();
      const cuts: string[] = [];
      sheet.querySelectorAll<HTMLImageElement>('.shot-holes img').forEach((img) => {
        const b = img.getBoundingClientRect();
        const w = img.offsetWidth;
        if (!w || !b.width) return;
        const cx = b.left + b.width / 2 - sr.left, cy = b.top + b.height / 2 - sr.top;
        cuts.push(`radial-gradient(circle ${(w * 0.185).toFixed(1)}px at ${cx.toFixed(1)}px ${cy.toFixed(1)}px, transparent 0, transparent 86%, #000 100%)`);
      });
      const mask = cuts.join(', ');
      sheet.style.setProperty('-webkit-mask-image', mask);
      sheet.style.setProperty('mask-image', mask);
      sheet.style.setProperty('-webkit-mask-composite', cuts.length > 1 ? 'source-in' : '');
      sheet.style.setProperty('mask-composite', cuts.length > 1 ? 'intersect' : '');
    };
    apply();
    const late = window.setTimeout(apply, 220); // after a fresh hole's punch-in has settled
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(sheet);
    body.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', apply);
    return () => {
      window.clearTimeout(late);
      ro?.disconnect();
      body.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  });
  return (
    <div className={`tt-backdrop${presented ? ' presented' : ''}`} data-testid="table-talk" data-decided={decided ? 'yes' : 'no'} data-presented={presented ? 'yes' : 'no'} data-showcase={showcase ? 'yes' : 'no'} role="dialog" aria-label={showcase ? 'Game over' : 'Hand recap'} onPointerDown={() => { setFxOff(true); if (showcase) advanceBeat(); }}>
      {/* 3 THE HARD WAY — the third-set ending's title card (the rule's own
          callout, game-wide, NOT an unlock). Held ~3s, then the game-over
          flow proceeds; in a story match the stop's finale set animation is
          delayed behind it (see SetCover delayMs) so both land in sequence. */}
      {thirdSetEnd && (
        <div className={`hardway-flash${reduceFx ? ' still' : ''}`} data-testid="hardway-flash" aria-hidden="true">
          <i className="hw-rule top" />
          <span className="hw-big">3 THE HARD WAY</span>
          {/* Wave C (§A5 row 56): the sub-line names the side the recap
              itself bills — the engine's knocked-out side(s) for this
              ending (result.shotOut carries the third-set side too). */}
          <small>{(st.result?.shotOut ?? []).length > 0
            ? `${(st.result?.shotOut ?? []).map((s) => sideName(r, s, names)).join(' & ')}’s third set — game over`
            : 'THIRD SET — GAME OVER'}</small>
          <i className="hw-rule bot" />
        </div>
      )}
      <div className={`tt glass slant espn${showcase ? ' showcase' : ''}`}>
        {!showcase && (<header className="tt-head">
          <span className="tt-title">HAND {rec.handNo} RECAP</span>
          {series}
          {secs !== null && !decided && <span className={`tt-count ${secs <= 5 ? 'hot' : ''}`} data-testid="talk-count">Next deal {secs}s</span>}
          {/* Chat — TWO copies render (here and in the footer's Score pad
              row); CSS shows exactly one per orientation. This header copy
              is the LANDSCAPE one (owner 2026-10-20 put chat in the header
              row: the old fixed corner button floated over the TOP SCORES
              card — "out of place and an eye sore"). In PORTRAIT the
              footer copy shows instead (owner, 2026-11-07: the chat
              button moves to the bottom with the rest of the actions).
              Same behaviour, badge and aria either way. */}
          {/* Settings stays reachable from the recap (owner, 2026-11-12:
              "settings should still be present on this screen") — the
              recap covers the table's own menu. Opens the one Settings
              sheet (settingsSheet.ts); shown in both orientations. */}
          <button type="button" className="tt-gear-btn" data-testid="recap-settings" aria-label="Settings" onClick={() => requestSettingsSheet()}>
            <GearIcon />
          </button>
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
        </header>)}

        <div className={showcase ? 'tt-showcase' : 'tt-body'} data-testid={showcase ? 'ending-showcase' : undefined} ref={bodyRef}>
          {!showcase && (<section className="tt-top-scores" data-testid="recap-top-scores" aria-label="Top scores">
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
          </section>)}
          {!showcase && (<section className="tt-strip" aria-label="Hands so far">
            <h3>HANDS</h3>
            <HandsStrip history={st.history} sides={sides.map((s) => s.side)} label={(s) => sideName(r, s, names)} color={(s) => sideColor(r, s)} testId="recap-strip" />
          </section>)}
          {mp && !showcase && (
            <div className={`mp-strap ${mp.tier}`} data-testid="match-point" data-tier={mp.tier}>
              <span className="mp-kicker"><i />Match point</span>
              <strong>{matchPointHeadline(mp, (s) => sideName(r, s, names))}</strong>
              <span className="mp-needs">
                {mp.sides.map((s) => <span key={s.side} style={{ borderColor: sideColor(r, s.side) }}>{sideName(r, s.side, names)} <em>needs {s.needs}</em></span>)}
              </span>
            </div>
          )}
          {!showcase && notes.length > 0 && (
            <div className="tt-callouts">
              {notes.map((c, i) => <span key={i} className={`tt-callout ${c.kind}`}>{c.kind === 'streak' ? '🔥 ' : ''}{c.text}</span>)}
            </div>
          )}
          <div className={`tt-recap${(beatCast ?? sides).length > 2 ? ' crowded' : ''}`} data-testid="talk-recap">
            {(beatCast ?? sides).map((s) => {
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
              const info = streaks[s.side] ?? { count: 0, visible: 0, fresh: -1 };
              const marks = rememberHoles(st.seed, s.side, info.count, info.fresh);
              const sheetAnim = !!cover.sheet && anim.current!.waitSheet.has(s.side);
              const tod = `Time of death: Hand ${cover.outHand ?? rec.handNo}`;
              const showHoles = info.visible > 0 && (notice || !!cover.sheet);
              // The set animation for THIS side's cover: tier from the cover
              // fact (sheet = a set that ended the game → finale), fresh only
              // on the hand it happened. Resolution is the setAnims model:
              // the story house plays its own; elsewhere only earned ones,
              // and only for sets the viewer caused. Null = no animation —
              // the retired tape/sheet never stand in.
              const setTier = setTierForCover(cover);
              const setFresh = setTier === 'finale' ? sheetAnim : setTier === 'regular' ? justShot : false;
              const setAnimId = setTier ? resolveSetAnim({
                storyStopId: setAnimCtx?.storyStopId ?? null,
                venueId: setAnimCtx?.venueId ?? null,
                setting: setAnimCtx?.setting ?? 'auto',
                cleared,
                causedByViewer: s.side !== mySide,
              }) : null;
              // The finale's words (owner, 2026-10-21): keyed to the ending
              // fact, naming this side — they ride the cover's end state so
              // the card says the game is over even after the art played.
              const finaleHeadline = setTier === 'finale' ? finaleHeadlineFor({
                endReason: st.result?.endReason,
                decided,
                sideName: sideName(r, s.side, names),
                mine: s.side === mySide,
                // the hand this side went out on — the same fact the card
                // prints as its time of death, so the cover's words and the
                // tag can never disagree about when it happened
                handNo: cover.outHand ?? rec.handNo,
                // the ending's path for THIS side, from the same history the
                // game-over banner reads — passed only when this cover's out
                // hand IS the final hand (the record shotOutPathFor reads as
                // its last), so the plaque names the same ending the banner
                // and the chat call name
                shotPath: decided && st.result?.endReason === 'shotOut' && (cover.outHand ?? rec.handNo) === st.history[st.history.length - 1]?.handNo
                  ? shotOutPathFor(st.history, s.side)
                  : undefined,
              }) : null;
              // The finale verdict plaque (owner, 2026-10-21): when the
              // cover mounts with its headline, the plaque is the card's
              // ONE verdict voice — it renders in the face's flow (the
              // "verdict" grid row), and the duplicate SHOT OUT / OUT chip
              // in the badges row is suppressed so no verdict word renders
              // twice on the card. The SET chip (scoring info) stays.
              const verdictHere = setTier === 'finale' && !!finaleHeadline && !!setAnimId;
              // The Rec banner and the Cookout lid are opaque word panels
              // docked at the top of the cover; on finale cards they get a
              // reserved band at the top of the face (fv-band) so they
              // never drape the team name (animfx.css composition block).
              const bandHere = verdictHere && (setAnimId === 'rec-center' || setAnimId === 'cookout');
              const badgeChips = verdictHere ? chips.filter((c) => c.kind !== 'out') : chips;
              return (
                <div key={s.side} className={`tt-team${s.side === mySide ? ' mine' : ''}${shot ? ' blast' : ''}${cover.tape ? ' taped' : ''}${cover.tape && justShot ? ' tape-in' : ''}${notice ? ' notice' : ''}${cover.sheet ? ' shrouded' : ''}${sheetAnim ? ' sheet-in sheet-wait' : ''}${bandHere ? ' fv-band' : ''}`} data-testid={`recap-side-${s.side}`} data-blast={shot ? 'yes' : 'no'} data-tape={cover.tape ? 'yes' : 'no'} data-sheet={cover.sheet ? 'yes' : 'no'} data-siren={cover.siren ? 'yes' : 'no'} data-holes={info.count} data-punched={punchedLabel(marks)}>
                  {showHoles && (
                    <div className="shot-holes" data-testid={`recap-holes-${s.side}`} aria-hidden="true">
                      {holeSlots(!!cover.sheet).slice(0, info.visible).map((h, i) => (
                        <img key={i} className={anim.current!.punch.has(`${s.side}:${i}`) ? 'hole-in' : undefined} src="/shot/hole.png" alt="" style={{ left: h.x, top: h.y, ['--rot' as string]: `${h.rot}deg` }} />
                      ))}
                    </div>
                  )}
                  {/* A thin wisp of smoke off every hole (owner, 2026-11-12). Its own layer, above the
                      card's text, so the holes keep their place under it; one <i> per hole at the hole's
                      slot. The first hole goes cold once the side comes through a hand unshot; later holes never do
                      (holeSmoking). Decorative — CSS only; off under Reduce effects and OS reduce-motion. */}
                  {showHoles && !reduceFx && (
                    <div className="shot-smoke" data-testid={`recap-smoke-${s.side}`} aria-hidden="true">
                      {holeSlots(!!cover.sheet).slice(0, info.visible).map((h, i) => !smoking[s.side]?.[i] ? null : (
                        <i key={i} className={anim.current!.punch.has(`${s.side}:${i}`) ? 'fresh' : undefined} style={{ left: h.x, top: h.y, ['--i' as string]: i }} />
                      ))}
                    </div>
                  )}
                  {cover.sheet && (
                    <p className="tod" data-testid="time-of-death" data-hand={rec.handNo}>{tod}</p>
                  )}
                  <div className={`tt-face${verdictHere ? ' has-verdict' : ''}`}>
                  {setAnimId && setTier && (setFresh || setTier === 'finale') && (
                    <SetCover
                      animId={setAnimId}
                      tier={setTier}
                      mode={setFresh ? 'fresh' : 'static'}
                      reduced={reduceFx}
                      side={s.side}
                      delayMs={setTier === 'finale' && thirdSetEnd ? FINALE_FLASH_DELAY_MS : 0}
                      finaleHeadline={finaleHeadline}
                      waitFallbackMs={setTier === 'finale' ? 2500 : 0}
                    />
                  )}
                  <div className="tt-team-name">
                    <b>{sideName(r, s.side, names)}</b>
                    <span className="tt-badges chips">
                      {notice ? (
                        <>
                          <em className="shot-stamp" data-testid={`recap-shot-stamp-${s.side}`}>SHOT</em>
                          {info.count > HOLE_CAP && <em className="shot-tally" data-testid={`recap-shot-tally-${s.side}`}>x{info.count}</em>}
                          <em className="notice-pill" data-testid={`recap-notice-${s.side}`}>ON NOTICE</em>
                        </>
                      ) : badgeChips.map((c) => <em key={c.text} className={`rchip ${c.kind}`}>{c.text}</em>)}
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
        </div>

        {!showcase && (<footer className="tt-foot stack">
          <div className="tt-foot-toprow">
            <button type="button" className="quiet-row-btn" onClick={onScorePad}>Score pad</button>
            {/* The PORTRAIT chat copy (owner, 2026-11-07): rides the
                Score pad row at its opposite end, inside the existing
                footer footprint — no new row. CSS hides this copy in
                landscape, where the header copy shows instead. */}
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
          </div>
          {ready && <span className="muted" data-testid="talk-ready-count">{ready.count}/{ready.of} ready</span>}
          <button type="button" className="primary big" data-testid="talk-ready" data-decided={decided ? 'yes' : 'no'} disabled={!!ready?.mine} onClick={onReady}>
            {decided ? 'See final results' : online ? (ready?.mine ? 'Waiting for the table…' : 'Ready') : mp?.tier === 'decider' ? 'Play the deciding hand' : `Continue to hand ${rec.handNo + 1}`}
          </button>
          {(trickReview || onLeave) && (<>
            <div className="exit-divider" aria-hidden="true" />
            {/* Review + Leave share ONE row, half the screen each (owner,
                2026-11-07): the Review pill moved down out of the header
                so the score cards get the height back in portrait. The
                trick browser itself, when open, takes the row's full
                width below them. */}
            <div className="tt-foot-row">
              {renegeCall}
              {trickReview}
              {onLeave && <button type="button" className="leave-red" data-testid="recap-leave" onClick={onLeave}>Leave game</button>}
            </div>
          </>)}
        </footer>)}
        {/* Photo Finish tape — presented-gated, riding the sheet itself
            (the .tt in-recap placement), printing both real final scores.
            Not on the showcase beat: the tape is a results-arrival piece
            and mounts there when the beat hands over (Option C). */}
        {!showcase && photo && presented && !fxOff && (
          <PhotoFinishTape inRecap winnerScore={photo.w} loserScore={photo.l} margin={photo.m} />
        )}
      </div>
      {/* Victory Confetti — presented-gated, over the presented sheet.
          The showcase beat skips it: the rain is the results surface's
          arrival celebration and fires there instead (Option C). */}
      {!showcase && iWon && presented && !fxOff && (
        <VictoryConfetti seed={st.seed ?? null} still={reduceFx} colors={[sideColor(r, mySide), CONFETTI_GOLDS[0]!, sideColor(r, mySide), CONFETTI_GOLDS[1]!]} />
      )}
      {/* The league ticker along the bottom of the recap (owner, 2026-11-12: the
          space behind the card is "dead space… this is supposed to be like a
          professional spades league with an espn presentation feel. the ticker
          should be present at the bottom of this screen"). Large screens only
          (uiPass.css) — a phone's recap fills the screen. Never on a story
          table (story surfaces carry no broadcast chrome) or the showcase beat. */}
      {!showcase && !setAnimCtx?.storyStopId && <div className="tt-ticker"><LeagueTicker variant="bar" /></div>}
    </div>
  );
}
