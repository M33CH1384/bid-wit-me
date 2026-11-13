/**
 * Last-card showdown (showdown.ts): the house lights drop to a spotlight on
 * the table, a broadcast strap calls the final book, and a heartbeat runs
 * under it, quickening with every card that lands.
 *
 * The finale: the moment the last card leaves a hand everything stops — the
 * heartbeat cuts and the room goes black while the card is in the air. When
 * it lands: a hit, a flash, a shockwave and sparks in the winning side's
 * colour, the crowd, and a strap that calls it — who took the last book, who
 * made their bid and who got set. Purely presentational — it never blocks a tap.
 * Under Reduce effects the strap and the dim appear without motion and the
 * heartbeat stays (it is sound, not motion).
 */
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { sound } from './audio';
import { SHOWDOWN_FLIGHT, SHOWDOWN_REVEAL_MS, heartbeatMs } from './showdown';
import './showdown.css';

export interface ShowdownTeam { side: number; name: string; color: string }

/** The finale's sparks: fixed directions so every client throws the same burst. */
const SPARKS = Array.from({ length: 18 }, (_, i) => ({ a: i * 20 + (i % 3) * 7, d: 150 + ((i * 53) % 110), s: 0.7 + ((i * 37) % 60) / 100 }));

export function ShowdownLayer({ teams, cardsDown, winner, reduced }: {
  /** The sides riding on the last book; fewer than two means no showdown. */
  teams: ShowdownTeam[];
  /** Cards already played to the last trick. */
  cardsDown: number;
  /** Who took the last book, once it is taken. */
  winner: ShowdownTeam | null;
  reduced?: boolean;
}) {
  const on = teams.length >= 2;
  const [phase, setPhase] = useState<'idle' | 'live' | 'reveal'>(on ? 'live' : 'idle');
  const shown = useRef<ShowdownTeam[]>(teams);
  if (on) shown.current = teams;
  const down = useRef(cardsDown);
  down.current = cardsDown;

  useEffect(() => {
    if (on) { setPhase('live'); return; }
    setPhase((p) => (p === 'live' ? 'reveal' : p));
  }, [on]);

  // Lights down: one low hit as the showdown opens.
  useEffect(() => { if (phase === 'live') sound.play('showdownOpen'); }, [phase]);

  // Heartbeat: re-timed after every beat, so it speeds up as cards land.
  useEffect(() => {
    if (phase !== 'live') return;
    let t = 0;
    const beat = () => { sound.play('heartbeat'); t = window.setTimeout(beat, heartbeatMs(down.current)); };
    t = window.setTimeout(beat, 700);
    return () => window.clearTimeout(t);
  }, [phase]);

  // Each of the last cards lands heavy.
  const prevDown = useRef(cardsDown);
  useEffect(() => {
    if (phase === 'live' && cardsDown > prevDown.current) sound.play('showdownHit', { delay: SHOWDOWN_FLIGHT.duration * 0.92 });
    prevDown.current = cardsDown;
  }, [cardsDown, phase]);

  // Finale: silence while the last card is in the air, then the hit as it lands.
  useEffect(() => {
    if (phase !== 'reveal') return;
    const land = SHOWDOWN_FLIGHT.duration;
    sound.play('showdownHit', { delay: land, gain: 1.3 });
    sound.play('versusImpact', { delay: land + 0.02, gain: 0.9 });
    sound.play('versusCrowd', { delay: land + 0.18, gain: 0.9 });
    const t = window.setTimeout(() => setPhase('idle'), SHOWDOWN_REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === 'idle') return null;
  const riding = shown.current;
  return (
    <div className={`showdown ${phase}${reduced ? ' still' : ''}`} data-testid="showdown" data-phase={phase} aria-live="polite">
      <div className="showdown-dim" />
      <div className="showdown-pulse" style={{ animationDuration: `${heartbeatMs(cardsDown)}ms` }} />
      {phase === 'live' && (
        <>
          <div className="showdown-strap" data-testid="showdown-strap">
            <span className="showdown-kicker">Final book</span>
            <strong>Winner takes it</strong>
            <span className="showdown-teams">
              {riding.map((t, i) => (
                <span key={i} style={{ borderColor: t.color }}>{t.name} <em>needs 1</em></span>
              ))}
            </span>
          </div>
          <div className="showdown-tag"><i />Final book · Winner takes it</div>
        </>
      )}
      {phase === 'reveal' && (
        <div className="showdown-finale" style={{ '--sd-win': winner?.color ?? '#ffd24a' } as CSSProperties}>
          <div className="showdown-hold" />
          <div className="showdown-flash" />
          <div className="showdown-ring" /><div className="showdown-ring late" />
          <div className="showdown-sparks">
            {SPARKS.map((s, i) => <i key={i} style={{ '--a': `${s.a}deg`, '--d': `${s.d}px`, '--s': s.s } as CSSProperties} />)}
          </div>
          {winner && (
            <div className="showdown-strap took" data-testid="showdown-winner">
              <span className="showdown-kicker">Last book goes to</span>
              <strong>{winner.name}</strong>
              <span className="showdown-verdicts">
                {riding.map((t) => (
                  <span key={t.side} className={t.side === winner.side ? 'made' : 'set'} style={{ borderColor: t.color }}>
                    {t.name} <em>{t.side === winner.side ? 'Bid made' : 'Set'}</em>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
