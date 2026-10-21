import { useSyncExternalStore } from 'react';

/**
 * ONE Settings sheet for the whole app (owner, 2026-10-20): the gear button
 * and the speaker button used to open two different surfaces with the sound
 * controls duplicated across both — "a mess". Now there is exactly one sheet
 * (MoreOptions); the gear opens it at the top and the speaker opens the SAME
 * sheet landed on the Sound & music group.
 *
 * The sheet needs the app's Settings object + tips prefs, which live with the
 * screen hosts, so the hosts render <SettingsSheetHost /> (App on the offline
 * side, the online table room on the other) and every other surface — the
 * floating sound dock above all — just files a request here.
 */
export type SettingsSheetSection = 'sound';

export interface SettingsSheetState {
  open: boolean;
  /** Where the sheet should land when it opens (null = the top). */
  section: SettingsSheetSection | null;
  /** Bumped on every request, so a repeat request while open re-lands the anchor. */
  seq: number;
}

let state: SettingsSheetState = { open: false, section: null, seq: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const l of [...listeners]) l();
}

/** Ask the current host to open the Settings sheet (optionally at a section). */
export function requestSettingsSheet(section?: SettingsSheetSection) {
  state = { open: true, section: section ?? null, seq: state.seq + 1 };
  emit();
}

export function closeSettingsSheet() {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export function useSettingsSheet(): SettingsSheetState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
    () => state,
  );
}
