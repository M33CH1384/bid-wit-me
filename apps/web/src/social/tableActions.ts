import type { OpenTable, PresenceStatus } from '@spades/protocol';

export const LOCAL_TABLE_REASON = 'On their device vs bots. Invite them instead.';
export const WATCH_FULL_REASON = 'Spectator seats are full';

export interface PlayerTableAction {
  /** vs-bots on their device: not a server room */
  local: boolean;
  code?: string;
  /** empty seat or a bot's seat — never a real person's */
  join: boolean;
  seat?: number;
  joinLabel: 'Join' | 'Take seat';
  spectate: boolean;
  /** why a shown button cannot be used */
  spectateReason?: string;
  joinReason?: string;
}

/**
 * What the Players row can do with this person's table.
 * Offline "vs bots" is local-only. Online rooms can be watched, and joined when a seat is empty or held by a bot.
 */
export function playerTableAction(
  status: PresenceStatus,
  tables: Record<string, OpenTable>,
  myCode: string | null,
): PlayerTableAction | null {
  if (status.offline || (status.kind === 'table' && !status.code)) {
    return {
      local: true, join: false, joinLabel: 'Join', spectate: true,
      spectateReason: LOCAL_TABLE_REASON, joinReason: LOCAL_TABLE_REASON,
    };
  }
  if ((status.kind !== 'table' && status.kind !== 'lobby') || !status.code) return null;
  if (myCode && myCode === status.code) return null;
  const listed = tables[status.code];
  // A public listing is the server's view (it already excludes human seats and locked bots).
  const open = listed ? listed.open : (status.open ?? 0);
  const seat = listed?.seat ?? status.seat;
  const watchFull = listed ? !!listed.watchFull : !!status.watchFull;
  const playing = listed ? listed.status === 'playing' : status.kind === 'table';
  const blocked = !!listed?.tournament;
  const join = !blocked && open > 0 && (seat !== undefined || status.kind === 'lobby');
  return {
    local: false,
    code: status.code,
    join,
    ...(join && seat !== undefined ? { seat } : {}),
    joinLabel: playing ? 'Take seat' : 'Join',
    spectate: true,
    ...(watchFull ? { spectateReason: WATCH_FULL_REASON } : {}),
  };
}
