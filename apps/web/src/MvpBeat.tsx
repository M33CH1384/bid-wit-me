/**
 * Player of the game. A short broadcast beat that plays ONCE per game, over
 * the results as they arrive — kicker, the player's name and side, and the two
 * or three stats behind the pick — then steps aside and stays on the results
 * as a small MVP line. Tap, click or any key skips the beat. Under Reduce
 * effects the card simply appears and leaves without motion (mvp styles in
 * uiPass.css). The pick itself is mvp.ts.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Mvp } from './mvp';

/** How long the beat holds before the results take over (ms). */
export const MVP_BEAT_MS = 3800;

const played = new Set<string>();
/** Tests. */
export function resetMvpBeats(): void { played.clear(); }

export function MvpBeat({ mvp, name, team, color, gameKey, reduced }: {
  mvp: Mvp;
  /** The player's display name, as the table shows it. */
  name: string;
  /** Their side's name, when it says more than the player's own. */
  team?: string;
  color: string;
  /** One beat per game: the same key never plays twice (a remount, the other results surface). */
  gameKey: string;
  reduced?: boolean;
}) {
  const [live, setLive] = useState(() => !played.has(gameKey));
  useEffect(() => {
    if (!live) return;
    played.add(gameKey);
    const end = () => setLive(false);
    const t = window.setTimeout(end, MVP_BEAT_MS);
    window.addEventListener('keydown', end);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', end); };
  }, [live, gameKey]);
  const facts = mvp.lines.map((l) => `${l.value} ${l.label.toLowerCase()}`).join(' · ');
  return (
    <>
      <div className="mvp-line" data-testid="mvp-line" style={{ ['--side' as string]: color }}>
        <span className="mvp-tag">MVP</span>
        <b>{name}</b>
        <small>{facts}</small>
      </div>
      {live && typeof document !== 'undefined' && createPortal(
        <div className={`mvp-beat${reduced ? ' still' : ''}`} data-testid="mvp-beat" role="dialog" aria-label={`Player of the game: ${name}`} onPointerDown={() => setLive(false)} style={{ ['--side' as string]: color }}>
          <div className="mvp-card">
            <span className="mvp-kicker">Player of the game</span>
            <span className="mvp-name">{name}</span>
            {team && team.toLowerCase() !== name.toLowerCase() && <span className="mvp-team">{team}</span>}
            <div className="mvp-stats">
              {mvp.lines.map((l) => (
                <div key={l.label} className="mvp-stat"><b>{l.value}</b><small>{l.label}</small></div>
              ))}
            </div>
            <span className="mvp-skip">Tap to continue</span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
