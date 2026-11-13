/**
 * Motion view quick toggle (owner, 2026-11-08): while the Motion view
 * option is ON, this small button lives in the lower screen at the
 * table. One tap suspends motion in place — the view settles back to
 * the saved tilt/zoom and stays there — and the next tap resumes it,
 * re-calibrating the neutral holding angle at that moment, exactly
 * like a fresh enable (the driver's re-anchor covers it).
 *
 * The Settings switch stays the master control: this button renders
 * ONLY while the option is on, disappears the moment it is turned off,
 * and never rewrites the saved setting — it flips the in-memory
 * quick-suspend store in motionView.ts, which Scene's motion controls
 * feed to the driver as a suspend reason, like a sheet or the recap
 * cover. Its state is visible at a glance in both themes: gold and
 * "Motion" while driving, dimmed with a pause mark while suspended.
 */
import { useSyncExternalStore } from 'react';
import {
  getMotionQuickSuspended, getMotionViewEnabled, setMotionQuickSuspended,
  subscribeMotionQuickSuspend, subscribeMotionViewEnabled,
} from './motionView';

function PhoneGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="8.2" y="3.4" width="7.6" height="17.2" rx="1.8" transform="rotate(-14 12 12)" />
      <path d="M3.6 8.2a9.4 9.4 0 0 1 2.4-3.4" />
      <path d="M20.4 15.8a9.4 9.4 0 0 1-2.4 3.4" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5.5" y="4" width="4.6" height="16" rx="1.2" />
      <rect x="13.9" y="4" width="4.6" height="16" rx="1.2" />
    </svg>
  );
}

export default function MotionViewButton() {
  const enabled = useSyncExternalStore(subscribeMotionViewEnabled, getMotionViewEnabled, getMotionViewEnabled);
  const suspended = useSyncExternalStore(subscribeMotionQuickSuspend, getMotionQuickSuspended, getMotionQuickSuspended);
  if (!enabled) return null;
  return (
    <button
      type="button"
      className={`motion-view-btn${suspended ? ' is-suspended' : ''}`}
      data-testid="motion-view-toggle"
      data-state={suspended ? 'suspended' : 'driving'}
      aria-pressed={suspended}
      aria-label={suspended ? 'Resume motion view' : 'Pause motion view'}
      onClick={() => setMotionQuickSuspended(!suspended)}
    >
      {suspended ? <PauseGlyph /> : <PhoneGlyph />}
      <span>{suspended ? 'Paused' : 'Motion'}</span>
    </button>
  );
}
