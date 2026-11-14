/**
 * Match point at the table (decider.ts). When the hand being dealt can end the match, a strap
 * says so once as the hand opens, then gets out of the way. For the whole hand the house lights are
 * down — a spotlight on the table, the room around it dark — the music sits back a little and the
 * room's ambience echoes (owner, 2026-11-13). Never takes a tap.
 */
import { useEffect, useState } from 'react';
import { sound } from './audio';
import { matchPointHeadline, type MatchPoint } from './decider';
import './decider.css';

/** How long the opening strap is on screen (matches the mp-table keyframes). */
export const MATCH_POINT_STRAP_MS = 3600;

const announced = new Set<string>();
/** Tests. */
export function resetMatchPointAnnouncements(): void { announced.clear(); }

export function MatchPointLayer({ mp, handKey, name, color, reduced }: {
  mp: MatchPoint | null;
  /** One announcement per hand: the same key never plays twice (a remount, a resume). */
  handKey: string;
  name: (side: number) => string;
  color: (side: number) => string;
  reduced?: boolean;
}) {
  const [strap, setStrap] = useState(false);
  const on = !!mp;
  useEffect(() => {
    if (!on || announced.has(handKey)) return;
    announced.add(handKey);
    setStrap(true);
    sound.play('showdownOpen', { gain: 0.8 });
    const t = window.setTimeout(() => setStrap(false), MATCH_POINT_STRAP_MS);
    return () => window.clearTimeout(t);
  }, [on, handKey]);
  // The room goes quiet with it: music back a bit, ambience through an echo (audio.ts setMatchPoint).
  useEffect(() => { sound.setMatchPoint(on); return () => sound.setMatchPoint(false); }, [on]);
  if (!mp) return null;
  return (<>
    {/* House lights down: a spotlight on the table, the room around it dropped away. Under the plates. */}
    <div className={`mp-spot${reduced ? ' still' : ''}`} data-testid="match-point-spot" />
    <div className={`mp-layer ${mp.tier}${reduced ? ' still' : ''}`} data-testid="match-point-layer" data-tier={mp.tier}>
      {strap && (
        <div className={`mp-strap ${mp.tier}`} data-testid="match-point-open">
          <span className="mp-kicker"><i />Match point</span>
          <strong>{matchPointHeadline(mp, name)}</strong>
          <span className="mp-needs">
            {mp.sides.map((s) => <span key={s.side} style={{ borderColor: color(s.side) }}>{name(s.side)} <em>needs {s.needs}</em></span>)}
          </span>
        </div>
      )}
    </div>
  </>);
}

/** How long the recap's match point alert holds the stage before it has fully dissolved (ms). */
export const MATCH_POINT_ALERT_MS = 3700;
const alerted = new Set<string>();
/** Tests. */
export function resetMatchPointAlerts(): void { alerted.clear(); }

/**
 * The recap's match point alert (owner, 2026-11-13: "this area should be a modal that curves in over
 * the recap card like a marquee espn alert, pause and dissolve to show the recap behind it").
 *
 * It swings in over the whole card on a curve, holds for a beat, then dissolves away and leaves the
 * recap as it was, with a small MATCH POINT chip in the callout row so the fact stays on the card.
 * Once per hand; a tap lets it go early. Under reduced motion only the chip shows.
 */
export function MatchPointAlert({ mp, alertKey, name, color, reduced, start }: {
  mp: MatchPoint;
  alertKey: string;
  name: (side: number) => string;
  color: (side: number) => string;
  reduced?: boolean;
  /** The recap card is on screen (its presented gate): the alert waits for it. */
  start: boolean;
}) {
  const [live, setLive] = useState(() => !reduced && !alerted.has(alertKey));
  useEffect(() => {
    if (!live || !start) return;
    alerted.add(alertKey);
    const t = window.setTimeout(() => setLive(false), MATCH_POINT_ALERT_MS);
    return () => window.clearTimeout(t);
  }, [live, start, alertKey]);
  if (!live) return null;
  return (
    <div className={`mp-alert ${mp.tier}${start ? ' go' : ''}`} data-testid="match-point" data-tier={mp.tier} role="alert" onPointerDown={() => setLive(false)}>
      <div className="mp-alert-veil" />
      <div className={`mp-strap mp-alert-card ${mp.tier}`}>
        <i className="mp-alert-sheen" />
        <span className="mp-kicker"><i />Match point</span>
        <strong>{matchPointHeadline(mp, name)}</strong>
        <span className="mp-needs">
          {mp.sides.map((s) => <span key={s.side} style={{ borderColor: color(s.side) }}>{name(s.side)} <em>needs {s.needs}</em></span>)}
        </span>
      </div>
    </div>
  );
}

/** What stays on the recap after the alert: one chip in the callout row. */
export function matchPointChipText(mp: MatchPoint, name: (side: number) => string): string {
  return `MATCH POINT · ${mp.sides.map((s) => `${name(s.side)} needs ${s.needs}`).join(' · ')}`;
}
