import MoreOptions from './MoreOptions';
import { closeSettingsSheet, useSettingsSheet } from './settingsSheet';
import type { Settings } from './settings';
import type { TipsPref } from './tips';

/**
 * Renders the ONE Settings sheet while a request is open (see settingsSheet.ts).
 * Mounted by the screens that own the Settings object — App (home + offline
 * table) and the online table room (lobby + online table) — so the gear and
 * the speaker reach the identical sheet from every surface that has either.
 */
export default function SettingsSheetHost({ settings, onChange, tips, onTips }: {
  settings: Settings;
  onChange: (s: Settings) => void;
  tips: TipsPref;
  onTips: (t: TipsPref) => void;
}) {
  const sheet = useSettingsSheet();
  if (!sheet.open) return null;
  return (
    <MoreOptions
      settings={settings}
      onChange={onChange}
      tips={tips}
      onTips={onTips}
      initialSection={sheet.section === 'sound' ? 'sound' : undefined}
      anchorSeq={sheet.seq}
      onClose={closeSettingsSheet}
    />
  );
}
