import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, type GameState, type TableRules, applyAction, newGame, pendingTurn, secureSeed, viewFor } from '@spades/rules';
import { type BotLevel, chooseBotAction } from '@spades/bots';
import { dealTimeline } from './three/dealTimeline';

export const HUMAN = 0;

// 'turbo' is for automated UI tests only (not shown in the menu)
// 'slow' is also forced while tips are on (learning mode): time to read between bot plays, tricks and the deal
export const SPEEDS = { slow: 2.2, relaxed: 1.5, normal: 1, fast: 0.5, turbo: 0.03 } as const;

/** `hold`: a tip is open — bots wait and a finished trick stays on the table until it's dismissed. */
export function useGame(rules: TableRules, seed: string, botLevel: BotLevel, speed: keyof typeof SPEEDS, resume?: GameState, hold = false) {
  const [st, setSt] = useState<GameState>(() => resume ?? newGame(rules, seed));
  // a resumed hand is placed instantly (no shuffle/deal replay); every later hand animates
  const resumedHand = useRef(resume ? resume.handNo : null);
  const introHand = resumedHand.current === st.handNo ? null : st.handNo;
  const [pause, setPause] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stRef = useRef(st);
  stRef.current = st;
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
      if (next.tricks.length > prev.tricks.length) setPause(true);
      stRef.current = next;
      setSt(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // hold a finished trick on the table for a moment
  useEffect(() => {
    if (!pause || hold) return;
    const t = setTimeout(() => setPause(false), 1150 * k);
    return () => clearTimeout(t);
  }, [pause, k, hold]);

  // bots move on their turn
  useEffect(() => {
    if (pause || dealing || hold) return;
    const turn = pendingTurn(st);
    if (!turn || turn.seat === HUMAN) return;
    const delay = (turn.kind === 'bid' ? 650 : turn.kind === 'exchange' ? 500 : 600) * k;
    const t = setTimeout(() => {
      const action = chooseBotAction(viewFor(st, turn.seat), botLevel);
      if (action) apply(action);
    }, delay);
    return () => clearTimeout(t);
  }, [st, pause, dealing, botLevel, k, apply, hold]);

  const restart = useCallback((r: TableRules = rules) => {
    const next = newGame(r, secureSeed());
    stRef.current = next;
    setSt(next);
    setPause(false);
    setError(null);
  }, [rules]);

  return { st, view: viewFor(st, HUMAN), pause, error, apply, restart, introHand, dealing, k };
}
