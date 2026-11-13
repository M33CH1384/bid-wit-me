import { fx } from './fx';
import { localGameId, noteLocalGame } from './localStats';
import { holdIfGuest } from './pendingClaim';
import { HAPTIC, haptic } from './haptics';
import { offlineTalk } from './offlineTalk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, type GameHandLog, type GameState, type TableRules, HandLogBuilder, applyAction, botPaceDelayMs, canRunIt, isJoker, isNukeTrick, lastCardDropOpen, newGame, pendingTurn, renegeOn, secureSeed, sideOf, viewFor } from '@spades/rules';
import { type BotLevel, type PartnerHint, chooseBotAction, chooseRenege, chooseRenegeCall, parseHint } from '@spades/bots';
import { dealTimeline } from './three/dealTimeline';
import { misdealSequenceMs } from './misdeal';
import { dealClockArmed } from './three/dealFlight';
import { finishedTrickHoldMs } from './trickTiming';
import { releaseAfterNukeClearance } from './nukeGate';

export const HUMAN = 0;
/** Mean bot think time per played card at normal speed (the seeded pacing draw in @spades/rules varies each turn around it). */
export const BOT_PLAY_MS = 1200;

// 'turbo' is for automated UI tests only (not shown in the menu)
// 'slow' is also forced while tips are on (learning mode): time to read between bot plays, tricks and the deal
export const SPEEDS = { slow: 2.2, relaxed: 1.5, normal: 1, fast: 0.5, turbo: 0.03 } as const;

/** `hold`: a tip is open — bots wait and a finished trick stays on the table until it's dismissed. */
/** `botLevel`: one level for every bot, or a per-seat resolver (Mixed skill / persona floors). `dealer`: a rematch continues the deal rotation. */
/** A bot's move with nothing holding the table and nothing happening for this long is a stall. */
export const STALL_MS = 7000;

export function useGame(rules: TableRules, seed: string, botLevel: BotLevel | ((seat: number) => BotLevel), speed: keyof typeof SPEEDS, resume?: GameState, hold = false, dealer?: number, partnerHint?: { current: { hand: number; text: string } | null }, localReport?: { current: { names: string[]; teamNames: (string | null)[] | null } }, dealReady = true, sceneDealt: number | null = null, suppressReport = false) {
  const [st, setSt] = useState<GameState>(() => resume ?? newGame(rules, seed, { dealer }));
  const levelRef = useRef(botLevel);
  levelRef.current = botLevel;
  // a resumed hand is placed instantly (no shuffle/deal replay); every later hand animates
  const resumedHand = useRef(resume ? resume.handNo : null);
  const introHand = resumedHand.current === st.handNo ? null : st.handNo;
  const [pause, setPause] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stRef = useRef(st);
  stRef.current = st;
  const startedAt = useRef(Date.now());
  const reported = useRef(false);
  const reportRef = useRef(localReport);
  reportRef.current = localReport;
  useEffect(() => {
    // Story Mode games report through /api/story/result instead: the normal offline
    // upload would credit them as ordinary bot games (double-counted Rep, and a
    // rated-adjacent path story games must never touch).
    if (suppressReport) return;
    if (st.phase !== 'gameOver' || !st.result || reported.current) return;
    reported.current = true;
    const meta = reportRef.current?.current;
    const item = {
      clientGameId: localGameId(seed),
      startedAt: startedAt.current,
      endedAt: Date.now(),
      names: meta?.names ?? [],
      teamNames: meta?.teamNames ?? null,
      game: st,
    };
    noteLocalGame(item);
    // Signed OUT for the whole game: nothing was queued (there is no account
    // to credit), so hold the result as a pending claim instead — sign-in
    // later credits it through the same server path (retroactive claim).
    holdIfGuest(item);
  }, [st.phase, seed, st]);
  const k = SPEEDS[speed];
  // while a fresh hand's shuffle + deal animation runs, nobody bids (bots wait, the bid panel stays hidden)
  const [dealtHand, setDealtHand] = useState<number | null>(null);
  // Bounded wait for a scene that never reports (no WebGL): the game is never stuck on a deal.
  const [forcedHand, setForcedHand] = useState<number | null>(null);
  const dealing = introHand !== null && forcedHand !== introHand && !(dealtHand === introHand && sceneDealt === introHand);
  // A called misdeal: the whole redeal sequence (announcement + gather, then the shuffle + deal
  // flight — see misdeal.ts) rides the dealing flag, so bots wait, input waits and bidding only
  // opens once the fresh hand has actually been dealt out on screen.
  const revealKey = st.misdealReveal ? `${st.handNo}:${st.misdeals ?? 0}:${st.misdealReveal.seat}` : null;
  const [revealDone, setRevealDone] = useState<string | null>(null);
  const misdealShowing = !!revealKey && revealDone !== revealKey;
  useEffect(() => {
    if (!revealKey || revealDone === revealKey) return;
    const s = stRef.current;
    const cards = s.hands.reduce((a, h) => a + h.length, 0);
    const tm = setTimeout(() => setRevealDone(revealKey), misdealSequenceMs(k, s.rules.playerCount, cards));
    return () => clearTimeout(tm);
  }, [revealKey, revealDone, k]);
  const busy = dealing || misdealShowing;
  // The misdeal offer's own deal clock (owner, 2026-10-29: the cards must be fully
  // dealt before the window shows). The offer opens on the LOCAL deal timeline —
  // the same clock that deals the fan — once Table's state gate (`misdealDealGate`)
  // proves every seat holds its full hand. It never waits on the scene's deal
  // report and never rides the forced fallback above: a scene that never reports
  // delays the bots (game flow), not the call, so the offer lands at the timeline
  // (~2.9 s at normal speed) instead of the fallback's ~12 s. The redeal sequence
  // still holds it — the fresh hand's window opens only once the redeal has dealt.
  const dealSettled = !misdealShowing && (introHand === null || dealtHand === introHand);
  useEffect(() => {
    // The clock starts with the table on screen. Started behind the loader, the deal was over
    // before it showed, so YOUR TURN and the bots' lead ran under the flying cards.
    if (!dealClockArmed(introHand, dealReady)) return;
    const cards = stRef.current.hands.reduce((a, h) => a + h.length, 0);
    const ms = dealTimeline(k, stRef.current.rules.playerCount, cards).total * 1000;
    const t = setTimeout(() => setDealtHand(introHand), ms + 150);
    const f = setTimeout(() => setForcedHand(introHand), ms * 3 + 4000);
    return () => { clearTimeout(t); clearTimeout(f); };
  }, [introHand, k, dealReady]);

  // Hand-history log for testing (Demetrius 2026-10-19): the offline mirror of the server
  // log. Every applied action is recorded; the latest log is kept in localStorage under
  // 'bwm.handlog' (written when a hand completes or the game ends) so a suspect hand can be
  // pulled and diffed after the fact.
  const logRef = useRef<HandLogBuilder | null>(null);
  const logSeq = useRef(0);
  const logOf = (): HandLogBuilder => {
    if (!logRef.current) {
      const init = stRef.current;
      logRef.current = resume && init.tricks.length > 0
        ? HandLogBuilder.wrap({ v: 1, seed: init.seed, rules: init.rules, startedAt: Date.now(), room: 'offline', hands: [] })
        : HandLogBuilder.start(init, Date.now(), 'offline');
    }
    return logRef.current;
  };
  const recordLog = (prev: GameState, next: GameState, action: Action) => {
    try {
      const b = logOf();
      b.record(prev, next, action, ++logSeq.current);
      if (next.history.length > prev.history.length || next.phase === 'gameOver') {
        try { localStorage.setItem('bwm.handlog', JSON.stringify(b.snapshot())); } catch { /* storage off — the log still lives in the hook */ }
      }
    } catch { /* logging never breaks the game */ }
  };

  const apply = useCallback((action: Action): boolean => {
    const prev = stRef.current;
    try {
      const next = applyAction(prev, action);
      setError(null);
      if (next !== prev) recordLog(prev, next, action);
      try { offlineTalk.step(prev, action, next); } catch { /* talk never breaks the game */ }
      if (next.tricks.length > prev.tricks.length) setPause(true);
      stRef.current = next;
      setSt(next);
      return next !== prev;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, []);

  // hold a finished trick on the table for a moment
  useEffect(() => {
    if (!pause || hold) return;
    // A nuked trick stays up for the 3D blast. The allowance matches the server.
    const trick = st.tricks[st.tricks.length - 1];
    const last = trick?.plays ?? [];
    // 'Run it!' holds for the slam + tornado instead (no nuke on a run: the tornado is the show).
    // Either Joker order counts (Big-then-Little used to get no allowance, so the trick was swept mid-blast).
    const run = last.some((p) => p.run);
    const nuke = isNukeTrick(last);
    const ending = st.phase === 'handOver' || st.phase === 'gameOver';
    // Hand end: this hold is the whole wait (700 ms after the card lands at normal speed).
    // Run it! holds for that show. A nuke holds for the 3D blast.
    // No trick-win haptic on a nuke: the detonation pattern already fired.
    const ms = finishedTrickHoldMs({
      speed: k,
      handEnding: ending,
      run,
      nuke: nuke ? (fx.tableNuke ?? fx.prefs.nuke) : null,
    });
    // Owner's clearance rule (2026-11-06): after a nuked trick the turn
    // opens on the explosion's CLEARANCE, not the timer alone — the blast
    // runs on a presented clock that stretches under load, and a card
    // thrown into it was blown off the felt and never appeared. The
    // designed hold above stays the minimum; the gate only extends the
    // pause while this client's blast episode is still open (bots are
    // pause-gated below and the plate names nobody during pause, so no
    // player — bot or human — can throw early), capped so a lost
    // completion signal can never stick the table.
    return releaseAfterNukeClearance({
      holdMs: ms,
      gated: nuke,
      episodeOpen: () => fx.blastEpisodeOpen,
      onRelease: () => {
        if (!run && !nuke) haptic(HAPTIC.trickWin, 'trick-win');
        setPause(false);
      },
    });
  }, [pause, k, hold]);

  // Stall watchdog (owner, 2026-11-12: "the game froze" with a bot on the clock and nothing
  // holding the table). Every path below ends in a timer that either changes the state or
  // does nothing; a timer that does nothing leaves this effect with no reason to run again,
  // and the table sits on a bot's turn for good. If it is a bot's move, nothing is pausing
  // the table, and nothing has happened for STALL_MS, the effect is nudged to run again —
  // and a nudged run goes straight to the seat on the clock (see `forced`).
  const [nudge, setNudge] = useState(0);
  const nudgeSeen = useRef(0);
  const lastMoveAt = useRef(performance.now());
  useEffect(() => { lastMoveAt.current = performance.now(); }, [st, pause, busy, hold, nudge]);
  useEffect(() => {
    if (pause || busy || hold) return;
    const id = window.setInterval(() => {
      const cur = stRef.current;
      if (cur.phase === 'handOver' || cur.phase === 'gameOver') return;
      const turn = pendingTurn(cur);
      if (!turn || turn.seat === HUMAN) return;
      if (performance.now() - lastMoveAt.current < STALL_MS) return;
      setNudge((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [pause, busy, hold]);

  // bots move on their turn
  useEffect(() => {
    if (pause || busy || hold) return;
    // A run caused by the watchdog: skip the off-turn pre-emptions (one of them may be the
    // thing that stalled) and move the seat on the clock, promptly.
    const forced = nudge !== nudgeSeen.current;
    nudgeSeen.current = nudge;
    // Release 10: a bot claims 'Run it!' the moment it's guaranteed, even off-turn (mirrors the server)
    if (!forced && st.phase === 'playing') {
      const claimer = Array.from({ length: st.rules.playerCount }, (_, i) => i).find((i) => i !== HUMAN && i !== st.turn && canRunIt(st, i));
      if (claimer !== undefined) {
        const tc = setTimeout(() => apply({ type: 'runIt', seat: claimer }), 600 * k);
        return () => clearTimeout(tc);
      }
    }
    // Last-card free drop (Demetrius 2026-11-02): a bot holding exactly one card throws
    // it in without waiting for its turn — the same rule the engine enforces for the
    // human (mirrors the server room). The wait draws from the same seeded pacing band
    // as a bot play, so the drop lands after a short human-like beat, never
    // frame-instant. The card is forced: at fire time a fresh view's single legal
    // card IS the drop — no brain consult, nothing to choose.
    if (!forced && st.phase === 'playing') {
      const dropper = Array.from({ length: st.rules.playerCount }, (_, i) => i).find((i) => i !== HUMAN && i !== st.turn && lastCardDropOpen(st, i));
      if (dropper !== undefined) {
        const delay = botPaceDelayMs({
          seed: st.seed, handNo: st.handNo, trickNo: st.tricks.length, seat: dropper,
          position: st.trick.plays.length, playerCount: st.rules.playerCount, kind: 'play',
          baseMs: BOT_PLAY_MS,
        }) * k;
        const td = setTimeout(() => {
          const v = viewFor(stRef.current, dropper);
          if (v.legal.length === 1) apply({ type: 'play', seat: dropper, card: v.legal[0]! });
        }, delay);
        return () => clearTimeout(td);
      }
    }
    // Renege tables: a bot that caught an opponent says so — only a renege the table has
    // seen proved (see chooseRenegeCall), after a beat so the proof card has landed.
    if (!forced && renegeOn(st.rules) && (st.phase === 'playing' || st.phase === 'handOver')) {
      const lvOf = (seat: number) => { const lv = levelRef.current; return typeof lv === 'function' ? lv(seat) : lv; };
      const caller = Array.from({ length: st.rules.playerCount }, (_, i) => i).find((i) => i !== HUMAN && chooseRenegeCall(viewFor(st, i), lvOf(i)));
      if (caller !== undefined) {
        const tr = setTimeout(() => {
          const call = chooseRenegeCall(viewFor(stRef.current, caller), lvOf(caller));
          if (call) apply({ type: 'callRenege', seat: caller, ...call });
        }, 1500 * Math.max(0.4, k));
        return () => clearTimeout(tr);
      }
    }
    const turn = pendingTurn(st);
    if (!turn || turn.seat === HUMAN) return;
    // ~0.6s more per bot card than before: a 3-bot trick used to resolve in 1.5s, too fast to follow.
    // Human pacing (owner, 2026-10-30: bots "throw out cards at the exact same
    // time"): the wait is no longer the flat constant — botPaceDelayMs draws it
    // per turn from a seeded band around the same means (1200 play / 650 bid /
    // 500 exchange), so no two bots share a metronome and no trick ticks at
    // uniform intervals, while the average pace is unchanged. The draw is a
    // pure function of the game's seed and the turn's identity, so a replay
    // paces identically.
    // Consultation (CONSULT_SPEC §5.4/§6.2): a bid may be held a beat longer —
    // the partner finishing their spoken count, an opponent pair conferring.
    // Presentation-only: bot bids only, never the human's clock.
    const delay = forced ? 250 : botPaceDelayMs({
      seed: st.seed, handNo: st.handNo, trickNo: st.tricks.length, seat: turn.seat,
      position: turn.kind === 'play' ? st.trick.plays.length : 0,
      playerCount: st.rules.playerCount, kind: turn.kind,
      baseMs: turn.kind === 'bid' ? 650 : turn.kind === 'exchange' ? 500 : BOT_PLAY_MS,
      jokerDown: turn.kind === 'play' && st.trick.plays.some((p) => isJoker(p.card)),
    }) * k
      + (turn.kind === 'bid' ? offlineTalk.consultBidDelay(turn.seat, st) : 0);
    let t2 = 0;
    const t = setTimeout(() => {
      const lv = levelRef.current;
      // my bot partner (seat 2) listens to what I said during bidding (partner talk)
      const h = turn.kind === 'bid' && st.rules.partnerships && turn.seat === (HUMAN + 2) % st.rules.playerCount ? partnerHint?.current : null;
      const hint: PartnerHint | null = h && h.hand === st.handNo ? parseHint(h.text) : null;
      let action = chooseBotAction(viewFor(st, turn.seat), typeof lv === 'function' ? lv(turn.seat) : lv, undefined, hint);
      // A stalled table must move: when the brain has nothing, or its pick is refused, the
      // seat throws its first legal card (only ever on a watchdog run).
      const unstick = () => {
        const cur = stRef.current;
        const now = pendingTurn(cur);
        if (!now || now.seat === HUMAN || now.kind !== 'play') return;
        const legal = viewFor(cur, now.seat).legal;
        if (legal.length) apply({ type: 'play', seat: now.seat, card: legal[0]! });
      };
      if (!action) { if (forced) unstick(); return; }
      if (forced) { if (!apply(action)) unstick(); return; }
      // persona lean (kept only if legal)
      const leaned = offlineTalk.lean(action);
      if (leaned !== action) { try { applyAction(st, leaned); action = leaned; } catch { /* keep the original */ } }
      // Renege tables: a bot on the OTHER side may cut a suit it still holds, rarely (see
      // chooseRenege). The human's own bot partner never does — nobody pays for a bot's cheat.
      if (action.type === 'play' && renegeOn(st.rules) && sideOf(turn.seat, st.rules) !== sideOf(HUMAN, st.rules)) {
        const cut = chooseRenege(viewFor(st, turn.seat), typeof lv === 'function' ? lv(turn.seat) : lv);
        if (cut) action = { type: 'play', seat: turn.seat, card: cut };
      }
      // sometimes a bot talks before it plays, then a short beat before the card lands
      if (action.type === 'play' && offlineTalk.prePlay(turn.seat)) { const a = action; t2 = window.setTimeout(() => apply(a), 900 * Math.max(0.6, k)); }
      else apply(action);
    }, delay);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [st, pause, busy, k, apply, hold, nudge]);

  const restart = useCallback((r: TableRules = rules) => {
    const next = newGame(r, secureSeed());
    stRef.current = next;
    logRef.current = HandLogBuilder.start(next, Date.now(), 'offline');
    logSeq.current = 0;
    setSt(next);
    setPause(false);
    setError(null);
  }, [rules]);

  return { st, view: viewFor(st, HUMAN), pause, error, apply, restart, introHand, dealing: busy, dealSettled, k,
    /** the hand log for the current offline game (testing) */
    handLog: (): GameHandLog | null => logRef.current?.snapshot() ?? null };
}
