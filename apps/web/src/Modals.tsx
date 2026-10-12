import type { ReactNode } from 'react';
import { type GameState, type HandRecord, type TableRules, bidLabel } from '@spades/rules';
import { HUMAN } from './useGame';

/** Team names for the mounted table (local side order; null = default partner names). Set by Table each render. */
let TEAM_NAMES: (string | null)[] | null = null;
export function setTeamNames(t: (string | null)[] | null): void { TEAM_NAMES = t; }

export function defaultSideName(rules: TableRules, side: number, names: string[]): string {
  if (!rules.partnerships) return names[side]!;
  return side === 0 ? `${names[0]} & ${names[2]}` : `${names[1]} & ${names[3]}`;
}

export function sideName(rules: TableRules, side: number, names: string[]): string {
  if (!rules.partnerships) return names[side]!;
  return TEAM_NAMES?.[side] || defaultSideName(rules, side, names);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

import { ScorePad as ScorePadView } from './ScorePad';
export function ScorePad({ st, names, onClose, locked, onContinue }: { st: GameState; names: string[]; onClose: () => void; locked?: ReactNode; onContinue?: () => void }) {
  return <ScorePadView st={st} names={names} onClose={onClose} onContinue={onContinue} locked={locked} sideName={(i) => sideName(st.rules, i, names)} />;
}
