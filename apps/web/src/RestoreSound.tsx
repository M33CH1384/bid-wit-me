/** Small chip when iOS left the AudioContext suspended after a resume attempt. */
export function RestoreSoundChip({ show, onRestore }: { show: boolean; onRestore: () => void }) {
  if (!show) return null;
  return (
    <button type="button" className="sound-restore" data-testid="restore-sound" onClick={onRestore}>
      Tap to restore sound
    </button>
  );
}
