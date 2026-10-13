/**
 * How long a rejoin may sit on the loader before it has to say so.
 * Sized for slow 4G (about 150 ms round trip, 1.6 Mbps): the account-ticket race, the
 * socket handshake, and a state frame are a few seconds even when the radio is poor.
 * 18s still fails a dead join well before a minute of silent tips.
 */
export const JOIN_TIMEOUT_MS = 18_000;

export type JoinStage = 'ticket' | 'socket' | 'welcome';
export type JoinFaultKind = 'timeout' | 'server' | 'missing';

export interface JoinFaultInput {
  kind: JoinFaultKind;
  stage: JoinStage;
  status: string;
  serverCode?: string | null;
  serverMessage?: string | null;
  closeCode?: number | null;
  ticketTimedOut?: boolean;
}

/** One sentence for the error screen. The console log keeps the raw stage and close code. */
export function joinFaultMessage(i: JoinFaultInput): string {
  if (i.kind === 'missing') return "This table doesn't exist or has expired.";
  if (i.serverCode && i.serverCode !== 'INTERNAL' && i.serverMessage) return i.serverMessage;
  if (i.stage === 'welcome') return 'The table answered, but the game never came through.';
  if (i.status === 'reconnecting' || (i.closeCode != null && i.closeCode !== 1000)) return 'The connection to the table kept dropping.';
  return "Couldn't open a connection to the table.";
}

export function joinFaultLog(code: string, i: JoinFaultInput & { elapsedMs: number; closeReason?: string | null }): Record<string, unknown> {
  return {
    code,
    kind: i.kind,
    stage: i.stage,
    status: i.status,
    serverCode: i.serverCode ?? null,
    serverMessage: i.serverMessage ?? null,
    closeCode: i.closeCode ?? null,
    closeReason: i.closeReason ?? null,
    ticketTimedOut: !!i.ticketTimedOut,
    elapsedMs: i.elapsedMs,
  };
}
