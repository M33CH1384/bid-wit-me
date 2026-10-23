import { useEffect, useState } from 'react';
import { VENUE_LIST, fetchVenueUnlocks, venueOptionLabel, venueUnlocked, type VenueChoice, type VenueId } from './venues';
import { useAccount } from './account/api';

/**
 * Venue dropdown with Phase 4 unlock gating: locked venues (The Pj's)
 * render disabled with a 🔒 label until the player unlocks them via Rep
 * (level 20+) or the After Dark achievement. Developer (owner) accounts bypass.
 * If the current value becomes locked, it falls back to classic.
 */
export function VenueSelect({ value, onChange, testId, randomLabel }: {
  value: VenueChoice;
  onChange: (v: VenueChoice) => void;
  testId: string;
  randomLabel?: string;
}) {
  const [unlocks, setUnlocks] = useState<{ unlocks: string[]; dev: boolean } | null>(null);
  // Same convergence as the story row: the profile cache is invalidated by
  // the account store on identity change, so re-read when it changes — a
  // picker mounted before an in-page sign-in must not keep the signed-out
  // (or a previous account's) lock state.
  const userId = useAccount().user?.id ?? null;
  useEffect(() => {
    let live = true;
    void fetchVenueUnlocks().then((s) => { if (live) setUnlocks(s); });
    return () => { live = false; };
  }, [userId]);
  const isOpen = (id: VenueId) => !unlocks || venueUnlocked(id, unlocks.unlocks, unlocks.dev);
  useEffect(() => {
    if (unlocks && value !== 'random' && !venueUnlocked(value, unlocks.unlocks, unlocks.dev)) onChange('classic');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocks]);
  return (
    <select data-testid={testId} aria-label="Venue" value={value} onChange={(e) => onChange(e.target.value as VenueChoice)}>
      {VENUE_LIST.map((v) => { const open = isOpen(v.id); return <option key={v.id} value={v.id} disabled={!open}>{venueOptionLabel(v, open)}{v.id === 'classic' ? ' (default)' : ''}</option>; })}
      <option value="random">{randomLabel ?? '🎲 Random'}</option>
    </select>
  );
}
