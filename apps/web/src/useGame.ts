import { fx } from './fx';
import { noteLocalGame } from './localStats';
import { HAPTIC, haptic } from './haptics';
import { startLittleBurst } from './JokerBurst';
import { SWEEP_MS, canvasOwnsBlast } from './nukeBlast';
import { offlineTalk } from './offlineTalk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, type GameState, type TableRules, applyAction, canRunIt, isNukeTrick, newGame, pendingTurn, secureSeed, viewFor } from '@spades/rules';
import { type BotLevel, type PartnerHint, chooseBotAction, parseHint } from '@spades/bots';
import { dealTimeline } from './three/dealTimeline';
import { finishedTrickHoldMs } from './trickTiming';

export const HUMAN = 0;

// 'turbo' is for automated UI tests only (not shown in the menu)
// 'slow' is also forced while tips are on (learning mode): time to read between bot plays, tricks and the deal
export const SPEEDS = { slow: 2.2, relaxed: 1.5, normal: 1, fast: 0.5, turbo: 0.03 } as const;

/** `hold`: a tip is open — bots wait and a finished trick stays on the table until it's dismissed. */
/** `botLevel`: one level for every bot, or a per-seat resolver (Mixed skill / persona floors). `dealer`: a rematch continues the deal rotation. */
export function useGame(rules: TableRules, seed: string, botLevel: BotLevel | ((seat: number) => BotLevel), speed: keyof typeof SPEEDS, resume?: GameState, hold = false, dealer?: number, partnerHint?: { current: { hand: number; text: string } | null }, localReport?: { current: { names: string[]; teamNames: (string | null)[] | null } }) {
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
    if (st.phase !== 'gameOver' || !st.result || reported.current) return;
    reported.current = true;
    const meta = reportRef.current?.current;
    const id = `local-${seed}`.padEnd(8, '0').slice(0, 80);
    noteLocalGame({
      clientGameId: id,
      startedAt: startedAt.current,
      endedAt: Date.now(),
      names: meta?.names ?? [],
      teamNames: meta?.teamNames ?? null,
      game: st,
    });
  }, [st.phase, seed, st]);
  const k = SPEEDS[speed];
  // while a fresh hand's shuffle + deal animation runs, nobody bids (bots wait, the bid panel stays hidden)
  const [dealtHand, setDealtHand] = useState<number | null>(null);
  const dealing = introHand !== null && dealtHand !== introHand;
  useEffect(() => {
    if (introHand === null) return;
    const cards = stRef.current.hands.reduce((a, h) => a + h.length, 0);
    const t = setTimeout(() => setDealtHand(introHand), dealTimeline(k, stRef.current.rules.playerCount, cards).total * 1000 + 150);
    return () => clearTimeout(t);
  }, [introHand, k]);

  const apply = useCallback((action: Action) => {
    const prev = stRef.current;
    try {
      const next = applyAction(prev, action);
      setError(null);
      try { offlineTalk.step(prev, action, next); } catch { /* talk never breaks the game */ }
      if (next.tricks.length > prev.tricks.length) setPause(true);
      stRef.current = next;
      setSt(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // hold a finished trick on the table for a moment
  const littleBurstFor = useRef(-1);
  useEffect(() => {
    if (!pause || hold) return;
    // A nuked trick stays up for the 3D blast. The allowance matches the server.
    const trick = st.tricks[st.tricks.length - 1];
    const last = trick?.plays ?? [];
    // 'Run it!' holds for the slam + tornado instead (no nuke on a run: the tornado is the show).
    // Either Joker order counts (Big-then-Little used to get no allowance, so the trick was swept mid-blast).
    const run = last.some((p) => p.run);
    const nuke = isNukeTrick(last);
    if (!run && !nuke && trick && littleBurstFor.current !== st.tricks.length) {
      const winCard = trick.winner == null ? null : last.find((p) => p.seat === trick.winner)?.card;
      if (winCard === 'LJ') { littleBurstFor.current = st.tricks.length; startLittleBurst(); }
    }
    if (nuke && canvasOwnsBlast()) {
      // The canvas blast is about 1.8s. Cards fly to the pile at the end of it.
      // No trick-win haptic: the detonation pattern already fired.
      const t0 = performance.now();
      let id = 0;
      const tick = () => {
        const elapsed = fx.warp !== null ? fx.warp * 1000 : performance.now() - t0;
        if (elapsed >= SWEEP_MS) { setPause(false); return; }
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(id);
    }
    const ending = st.phase === 'handOver' || st.phase === 'gameOver';
    // Hand end: this hold is the whole wait (700 ms after the card lands at normal speed).
    // Run it! holds for that show. Without a canvas, a nuke holds for the 3D blast.
    // No trick-win haptic on a nuke: the detonation pattern already fired.
    const ms = finishedTrickHoldMs({
      speed: k,
      handEnding: ending,
      run,
      nuke: nuke ? (fx.tableNuke ?? fx.prefs.nuke) : null,
    });
    const t = setTimeout(() => {
      if (!run && !nuke) haptic(HAPTIC.trickWin, 'trick-win');
      setPause(false);
    }, ms);
    return () => clearTimeout(t);
  }, [pause, k, hold]);

  // bots move on their turn
  useEffect(() => {
    if (pause || dealing || hold) return;
    // Release 10: a bot claims 'Run it!' the moment it's guaranteed, even off-turn (mirrors the server)
    if (st.phase === 'playing') {
      const claimer = Array.from({ length: st.rules.playerCount }, (_, i) => i).find((i) => i !== HUMAN && i !== st.turn && canRunIt(st, i));
      if (claimer !== undefined) {
        const tc = setTimeout(() => apply({ type: 'runIt', seat: claimer }), 600 * k);
        return () => clearTimeout(tc);
      }
    }
    const turn = pendingTurn(st);
    if (!turn || turn.seat === HUMAN) return;
    const delay = (turn.kind === 'bid' ? 650 : turn.kind === 'exchange' ? 500 : 600) * k;
    let t2 = 0;
    const t = setTimeout(() => {
      const lv = levelRef.current;
      // my bot partner (seat 2) listens to what I said during bidding (partner talk)
      const h = turn.kind === 'bid' && st.rules.partnerships && turn.seat === (HUMAN + 2) % st.rules.playerCount ? partnerHint?.current : null;
      const hint: PartnerHint | null = h && h.hand === st.handNo ? parseHint(h.text) : null;
      let action = chooseBotAction(viewFor(st, turn.seat), typeof lv === 'function' ? lv(turn.seat) : lv, undefined, hint);
      if (!action) return;
      // persona lean (kept only if legal)
      const leaned = offlineTalk.lean(action);
      if (leaned !== action) { try { applyAction(st, leaned); action = leaned; } catch { /* keep the original */ } }
      // sometimes a bot talks before it plays, then a short beat before the card lands
      if (action.type === 'play' && offlineTalk.prePlay(turn.seat)) { const a = action; t2 = window.setTimeout(() => apply(a), 900 * Math.max(0.6, k)); }
      else apply(action);
    }, delay);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [st, pause, dealing, k, apply, hold]);

  const restart = useCallback((r: TableRules = rules) => {
    const next = newGame(r, secureSeed());
    stRef.current = next;
    setSt(next);
    setPause(false);
    setError(null);
  }, [rules]);

  return { st, view: viewFor(st, HUMAN), pause, error, apply, restart, introHand, dealing, k };
}
