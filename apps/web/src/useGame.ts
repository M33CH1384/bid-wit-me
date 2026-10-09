import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, type GameState, type TableRules, applyAction, newGame, pendingTurn, secureSeed, viewFor } from '@spades/rules';
import { type BotLevel, chooseBotAction } from '@spades/bots';

export const HUMAN = 0;

// 'turbo' is for automated UI tests only (not shown in the menu)
const SPEEDS = { relaxed: 1.5, normal: 1, fast: 0.5, turbo: 0.03 } as const;

export function useGame(rules: TableRules, seed: string, botLevel: BotLevel, speed: keyof typeof SPEEDS) {
  const [st, setSt] = useState<GameState>(() => newGame(rules, seed));
  const [pause, setPause] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stRef = useRef(st);
  stRef.current = st;
  const k = SPEEDS[speed];

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
    if (!pause) return;
    const t = setTimeout(() => setPause(false), 1150 * k);
    return () => clearTimeout(t);
  }, [pause, k]);

  // bots move on their turn
  useEffect(() => {
    if (pause) return;
    const turn = pendingTurn(st);
    if (!turn || turn.seat === HUMAN) return;
    const delay = (turn.kind === 'bid' ? 650 : turn.kind === 'exchange' ? 500 : 600) * k;
    const t = setTimeout(() => {
      const action = chooseBotAction(viewFor(st, turn.seat), botLevel);
      if (action) apply(action);
    }, delay);
    return () => clearTimeout(t);
  }, [st, pause, botLevel, k, apply]);

  const restart = useCallback((r: TableRules = rules) => {
    const next = newGame(r, secureSeed());
    stRef.current = next;
    setSt(next);
    setPause(false);
    setError(null);
  }, [rules]);

  return { st, view: viewFor(st, HUMAN), pause, error, apply, restart };
}
