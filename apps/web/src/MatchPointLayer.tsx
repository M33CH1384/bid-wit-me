/**
 * Match point at the table (decider.ts). When the hand being dealt can end the match, a strap
 * says so once as the hand opens, then gets out of the way. For the whole hand the house lights are
 * down — a spotlight on the table, the room around it dark — the music sits back a little and the
 * room's ambience echoes (owner, 2026-11-13). Never takes a tap.
 */
import { type CSSProperties, useEffect, useState } from 'react';
import { sound } from './audio';
import { matchPointHeadline, type MatchPoint } from './decider';
import './decider.css';

/** How long the opening strap is on screen (matches the mp-table keyframes). */
export const MATCH_POINT_STRAP_MS = 3600;

const announced = new Set<string>();
/** Tests. */
export function resetMatchPointAnnouncements(): void { announced.clear(); }

/**
 * Where the table sits on screen right now, as the lit pool for the last card: the projected table
 * box the scene publishes (window.__bwmLayout.table, the same one the effects overlays fit to), grown
 * a touch so the rail stays lit. Without a layout the stylesheet's own centred pool applies.
 */
export function lastCardPool(L: { w?: number; h?: number; table?: { cx: number; cy: number; x0: number; x1: number; y0: number; y1: number } } | null = typeof window !== 'undefined' ? (window as unknown as { __bwmLayout?: never }).__bwmLayout ?? null : null): CSSProperties | undefined {
  const t = L?.table;
  const w = L?.w, h = L?.h;
  if (!t || !w || !h || w < 32 || h < 32) return undefined;
  const pct = (v: number, of: number) => `${Math.round((v / of) * 1000) / 10}%`;
  return {
    ['--lc-x' as string]: pct(t.cx, w),
    ['--lc-y' as string]: pct((t.y0 + t.y1) / 2, h),
    ['--lc-rx' as string]: pct(((t.x1 - t.x0) / 2) * 1.12, w),
    ['--lc-ry' as string]: pct(((t.y1 - t.y0) / 2) * 1.18, h),
  };
}

export function MatchPointLayer({ mp, dark, lastCard = false, handKey, name, color, reduced }: {
  mp: MatchPoint | null;
  /**
   * The house lights stay down while match point is still possible (owner, 2026-11-13: "once the
   * lights dim for the announcement of match point they should not come back up, the darkness should
   * persist until there's no possibility for match point again"). True from the recap that announces
   * it, through every deal, bid and recap after, until no side is in reach or the game is over —
   * independent of `mp`, which only drives the hand's opening strap.
   */
  dark: boolean;
  /** The last card of a match-point hand: darker still, only the table and the player's hand lit. */
  lastCard?: boolean;
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
  // The room stays quiet as long as it stays dark: music back a bit, ambience through an echo (audio.ts).
  useEffect(() => { sound.setMatchPoint(dark); return () => sound.setMatchPoint(false); }, [dark]);
  if (!dark && !mp) return null;
  return (<>
    {/* House lights down: a spotlight on the table, the room around it dropped away. Under the plates.
        Mounted for as long as `dark` holds, so it fades in once and never flickers up between hands. */}
    {dark && <div className={`mp-spot${reduced ? ' still' : ''}`} data-testid="match-point-spot" />}
    {dark && lastCard && <div className={`mp-spot-last${reduced ? ' still' : ''}`} data-testid="match-point-last-card" style={lastCardPool()} />}
    {mp && <div className={`mp-layer ${mp.tier}${reduced ? ' still' : ''}`} data-testid="match-point-layer" data-tier={mp.tier}>
      {strap && (
        <div className={`mp-strap ${mp.tier}`} data-testid="match-point-open">
          <span className="mp-kicker"><i />Match point</span>
          <strong>{matchPointHeadline(mp, name)}</strong>
          <span className="mp-needs">
            {mp.sides.map((s) => <span key={s.side} style={{ borderColor: color(s.side) }}>{name(s.side)} <em>needs {s.needs}</em></span>)}
          </span>
        </div>
      )}
    </div>}
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
