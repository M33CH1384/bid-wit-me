import type { TableRules } from '@spades/rules';

/**
 * Host presets. Play is the longer clock in every setting: a trick takes longer
 * to read than a bid. The default table (Normal) is bid 30s / play 30s.
 */
export const TURN_TIMERS = {
  relaxed: { bid: 30, play: 45 },
  normal: { bid: 30, play: 30 },
  fast: { bid: 10, play: 15 },
} as const;
export type TimerKey = keyof typeof TURN_TIMERS;

const NAMES: Record<TimerKey, string> = { relaxed: 'Relaxed', normal: 'Normal', fast: 'Fast' };

export function timerKeyOf(t: { bid: number; play: number } | null | undefined): TimerKey | null {
  if (!t) return null;
  return (Object.keys(TURN_TIMERS) as TimerKey[]).find((k) => TURN_TIMERS[k].bid === t.bid && TURN_TIMERS[k].play === t.play) ?? null;
}

export function timerOptionLabel(key: TimerKey): string {
  const t = TURN_TIMERS[key];
  return `${NAMES[key]} (bid ${t.bid}s / play ${t.play}s)`;
}

/** House-rules line for whatever the table is actually using. */
export function timerSettingLabel(t: { bid: number; play: number }): string {
  const key = timerKeyOf(t);
  const name = key ? NAMES[key] : 'Custom';
  return `${name} · bid ${t.bid}s / play ${t.play}s`;
}

/** The editor being open does not matter: the picked preset is the table's clock. */
export function rulesWithTimer(rules: TableRules, key: TimerKey): TableRules {
  return { ...rules, turnTimerSec: { bid: TURN_TIMERS[key].bid, play: TURN_TIMERS[key].play } };
}

/** Shown on the collapsed settings row and inside Edit. Either one saves. */
export function TurnTimerSelect({ value, onChange, testId }: { value: TimerKey; onChange: (key: TimerKey) => void; testId: string }) {
  return (
    <select
      data-testid={testId}
      aria-label="Turn timer"
      value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as TimerKey)}
    >
      {(Object.keys(TURN_TIMERS) as TimerKey[]).map((k) => <option key={k} value={k}>{timerOptionLabel(k)}</option>)}
    </select>
  );
}
