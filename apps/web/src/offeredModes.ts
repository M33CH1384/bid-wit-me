/**
 * The modes the setup wizard actually offers (owner, 2026-10-20 lobby
 * restructure). This is the ONE list lobby surfaces derive from — Open Tables
 * filters and mode names come from here, never from settings.ts MODES: the
 * engine still supports 'cutthroat3' for legacy saves and 3-player tables
 * (settingsToRules / tableKind), but the wizard no longer offers it, so it
 * must not appear as a filter chip or an offered-mode name.
 */
export type OfferedMode = 'joker' | 'aceDown' | 'cutthroat4';

export const OFFERED_MODES: { key: OfferedMode; label: string; name: string }[] = [
  { key: 'joker', label: 'Joker', name: 'Joker Spades' },
  { key: 'cutthroat4', label: 'Cutthroat', name: 'Cutthroat' },
  { key: 'aceDown', label: 'Ace Down', name: 'Ace Down' },
];

export const OFFERED_MODE_NAME: Record<OfferedMode, string> = {
  joker: 'Joker Spades',
  cutthroat4: 'Cutthroat',
  aceDown: 'Ace Down',
};

export const isOfferedMode = (m: string): m is OfferedMode => OFFERED_MODES.some((o) => o.key === m);

/** Which offered mode a live open table belongs to. A legacy 3-player
 *  cutthroat table belongs to no offered mode (null): it still lists under
 *  "All", it just has no chip of its own. */
export function offeredKindOf(t: { mode: string; playerCount: number }): OfferedMode | null {
  if (t.mode === 'cutthroat') return t.playerCount === 3 ? null : 'cutthroat4';
  return isOfferedMode(t.mode) ? t.mode : null;
}

/** Display name for an open table's mode: the offered-mode name, with an
 *  honest label for the legacy 3-player tables the engine still runs. */
export function openTableModeName(t: { mode: string; playerCount: number }): string {
  const k = offeredKindOf(t);
  if (k) return OFFERED_MODE_NAME[k];
  if (t.mode === 'cutthroat' && t.playerCount === 3) return 'Cutthroat · 3 players';
  return t.mode;
}
