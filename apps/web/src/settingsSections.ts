/**
 * Collapsible sections in the ONE Settings sheet (owner, 2026-10-23): the
 * sheet's groups fold, and House rules sits at the TOP, open by default —
 * "some people only want to change the house rules". Once a player arranges
 * the sections, their open/closed choices persist on this device
 * (localStorage, bwm.* family like bwm.fx / bwm.tips) and are honored on
 * later opens. Pure state helpers — MoreOptions renders from them.
 *
 * A sheet entry that TARGETS a section (the speaker's sound landing, see
 * settingsSheet.ts) forces that section open for that open only; it never
 * writes through to this stored map.
 */
export type SettingsSectionId = 'house' | 'play' | 'sound' | 'look' | 'beta';

/** Sheet order, top to bottom: House rules first (owner, 2026-10-23). */
export const SETTINGS_SECTION_ORDER: SettingsSectionId[] = ['house', 'play', 'sound', 'look', 'beta'];

export type SectionOpenMap = Record<SettingsSectionId, boolean>;

export const SECTION_OPEN_KEY = 'bwm.settingsSections.v1';

/** Fresh device (no stored preference): House rules open, the rest folded. */
export const DEFAULT_SECTION_OPEN: SectionOpenMap = { house: true, play: false, sound: false, look: false, beta: false };

export function loadSectionOpen(): SectionOpenMap {
  try {
    const raw = localStorage.getItem(SECTION_OPEN_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Record<string, unknown>>;
      const out: SectionOpenMap = { ...DEFAULT_SECTION_OPEN };
      for (const id of SETTINGS_SECTION_ORDER) {
        if (typeof j[id] === 'boolean') out[id] = j[id] as boolean;
      }
      return out;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SECTION_OPEN };
}

export function saveSectionOpen(map: SectionOpenMap): void {
  try { localStorage.setItem(SECTION_OPEN_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}
