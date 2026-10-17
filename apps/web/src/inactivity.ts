/**
 * Auto-logout after inactivity (online only). Pure timer core so the policy is
 * unit-testable; OnlineApp wires real DOM activity events into it.
 * "Specified time": 30 minutes — change IDLE_LOGOUT_MS to retune.
 */
export const IDLE_LOGOUT_MS = 30 * 60_000;
/** Test/dev override key (localStorage ms). Production ignores anything absurd. */
export const IDLE_OVERRIDE_KEY = 'bwm.idleMs';

export class IdleWatch {
  private last: number;
  constructor(private readonly timeoutMs: number, private readonly now: () => number = Date.now) {
    this.last = now();
  }
  touch(): void { this.last = this.now(); }
  idleFor(): number { return this.now() - this.last; }
  expired(): boolean { return this.idleFor() >= this.timeoutMs; }
}

export function idleTimeoutFrom(storage: Pick<Storage, 'getItem'> | null): number {
  try {
    const raw = storage?.getItem(IDLE_OVERRIDE_KEY);
    const ms = raw ? Number(raw) : NaN;
    if (Number.isFinite(ms) && ms >= 5_000 && ms <= 24 * 3600_000) return ms;
  } catch { /* private mode */ }
  return IDLE_LOGOUT_MS;
}
