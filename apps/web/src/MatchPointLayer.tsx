/**
 * Match point at the table (decider.ts). When the hand being dealt can end the match, a strap
 * says so once as the hand opens, then gets out of the way; on a decider (two or more sides can
 * close it out) a faint red breath stays at the edge of the screen for the whole hand. Never
 * takes a tap. The music's own tension layer already rises with the scores (musicTension.ts).
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
  if (!mp) return null;
  return (
    <div className={`mp-layer ${mp.tier}${reduced ? ' still' : ''}`} data-testid="match-point-layer" data-tier={mp.tier}>
      {mp.tier === 'decider' && <div className="mp-edge" />}
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
  );
}
