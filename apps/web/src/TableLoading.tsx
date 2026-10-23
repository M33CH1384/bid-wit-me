import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AvatarCircle, useAvatar } from './avatar';
import PersonaFace from './PersonaFace';
import StoryFace from './story/StoryFace';
import tips from './data/loading-tips.json';

/** Copy that rotates while the table is still coming up. The first line is the one tests and the first paint use. */
export const LOADING_LINES = ['Shuffling the deck…', 'Setting the table…', 'Warming the felt…', 'Dealing you in…'];

export interface LoadingTip { id: number; text: string }

/**
 * Strategy lines shipped inside this chunk, in file order. Reading them is synchronous, so the
 * list never waits on the network and never holds the 3D scene or the first game state.
 */
export const LOADING_TIPS: LoadingTip[] = tips;

/** A new order each time the loading screen mounts. The JSON file itself stays in its authored order. */
export function shuffleTips<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const next = list.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = next[i]!;
    next[i] = next[j]!;
    next[j] = swap;
  }
  return next;
}

/* ------------------------------------------------------------ taking seats */

/**
 * One seat of the table being loaded, in seat order (owner, 2026-10-23: the
 * hold should show the actual people "taking their seats", not colored
 * plates with a single initial). Callers map the REAL seated roster onto
 * this shape; TableLoading only presents it.
 *
 * Face resolution mirrors the table's own PlateFace priority: a story
 * character renders their portrait (storyId); a bot renders its persona
 * portrait (personaPortraitFor, keyed by the bot's name); a human renders
 * their uploaded picture (uid lookup, or `direct` when the caller already
 * holds the data URL — the viewer's own seat). Should a bot's portrait
 * art fail to load it falls back to a designed nameplate (full name on
 * its seat color) — never the bare single-letter circle.
 */
export interface LoadingSeat {
  name: string;
  /** Story role ("Rooftop philosopher") or persona tag ("The Professor"); empty for plain humans. */
  tag?: string | null;
  /** Story character id — renders the real portrait from the story art set. */
  storyId?: string | null;
  /** Account id for the uploaded-picture lookup (human seats). */
  uid?: string | null;
  /** Avatar data URL the caller already has (the viewer's own seat). */
  direct?: string | null;
  /** A bot seat: with no storyId it takes the nameplate, never a letter. */
  bot?: boolean;
  /** The viewer's own seat. */
  you?: boolean;
  /** Seat color (the table's SEAT_COLORS / USER_COLORS value) for rings and the nameplate. */
  color: string;
}

/** Seats arrive one by one across the hold; the last of four lands ~1.9 s in,
 *  ahead of the standard hold's 3 s floor, so the table feels populated
 *  before it lifts. Reduced motion: no stagger, everyone is simply seated. */
export const LOADING_SEAT_STAGGER_MS = 450;
export const LOADING_SEAT_ENTER_MS = 550;
export function loadingSeatDelayMs(index: number, reduced: boolean): number {
  return reduced ? 0 : index * LOADING_SEAT_STAGGER_MS;
}

function LoadingSeatFace({ seat, faceFailed, onFaceError }: {
  seat: LoadingSeat;
  faceFailed: boolean;
  onFaceError: () => void;
}) {
  const pic = useAvatar(seat.uid ?? null, seat.direct ?? null);
  if (seat.storyId) return <StoryFace characterId={seat.storyId} name={seat.name} />;
  if (seat.bot) {
    // The bot's persona portrait; the designed nameplate is its fallback
    // if the art ever fails to load — never the bare letter circle.
    if (faceFailed) {
      return (
        <span className="bwm-seat-plate" aria-hidden>
          <span className="bwm-seat-plate-name">{seat.name}</span>
        </span>
      );
    }
    return <PersonaFace name={seat.name} onError={onFaceError} />;
  }
  return <AvatarCircle pic={pic} name={seat.name} className="bwm-seat-face-circle" />;
}

function LoadingSeatCard({ seat, index, reduced }: { seat: LoadingSeat; index: number; reduced: boolean }) {
  const [faceFailed, setFaceFailed] = useState(false);
  const plate = !!seat.bot && !seat.storyId && faceFailed;
  return (
    <div
      className="bwm-seat"
      data-testid="loading-seat"
      style={{ '--uc': seat.color, animationDelay: `${loadingSeatDelayMs(index, reduced)}ms` } as CSSProperties}
    >
      <span className="bwm-seat-facebox">
        <LoadingSeatFace seat={seat} faceFailed={faceFailed} onFaceError={() => setFaceFailed(true)} />
      </span>
      {!plate && <span className="bwm-seat-name">{seat.you ? 'You' : seat.name}</span>}
      {seat.tag && <span className="bwm-seat-tag">{seat.tag}</span>}
    </div>
  );
}

function LoadingSeats({ seats, reduced }: { seats: readonly LoadingSeat[]; reduced: boolean }) {
  if (!seats.length) return null;
  return (
    <div className={`bwm-loading-seats${reduced ? ' reduced' : ''}`} data-testid="loading-seats">
      {seats.map((seat, i) => <LoadingSeatCard key={i} seat={seat} index={i} reduced={reduced} />)}
    </div>
  );
}

/** One tip at a time. The next fades in on a timer that does not touch the loader's progress. */
function LoadingTips() {
  const [order] = useState(() => shuffleTips(LOADING_TIPS));
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (order.length < 2) return;
    let fade = 0;
    const id = window.setInterval(() => {
      setVisible(false);
      fade = window.setTimeout(() => {
        setIndex((n) => (n + 1) % order.length);
        setVisible(true);
      }, 280);
    }, 3400);
    return () => { window.clearInterval(id); window.clearTimeout(fade); };
  }, [order]);
  const tip = order[index];
  if (!tip?.text) return null;
  return (
    <p className={`bwm-loading-tip${visible ? ' in' : ''}`} data-testid="table-loading-tip" data-tip={tip.id} aria-live="polite">
      <span className="bwm-loading-tip-kicker">Strategy</span>
      <span className="bwm-loading-tip-text">{tip.text}</span>
    </p>
  );
}

/**
 * Full-screen Bid Wit Me hold, from the moment a table is joined or started until the 3D scene
 * and the first game state are both ready. The half-drawn table stays underneath and cannot be tapped.
 */
export function TableLoading({ progress, leaving, onBack, onRetry, fault, room, versus, seats, reducedMotion }: {
  progress?: number; leaving?: boolean; onBack?: () => void; onRetry?: () => void; fault?: string | null; room?: string;
  /** The versus intro (boxing match card) replaces the standard line/tips while it plays;
   *  a slim progress track stays under it so table readiness is still visible. */
  versus?: ReactNode;
  /** The table's seats taking their seats on the standard hold (never in the
   *  fault or versus branches — those own the card). Purely presentational:
   *  the hold never waits on portraits; a face that hasn't landed simply
   *  shows its fallback while the seat itself arrives on schedule. */
  seats?: readonly LoadingSeat[];
  /** Reduced motion: seats render already seated, no entrance choreography. */
  reducedMotion?: boolean;
}) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    if (fault) return;
    const id = window.setInterval(() => setLine((n) => (n + 1) % LOADING_LINES.length), 1600);
    return () => window.clearInterval(id);
  }, [fault]);
  const known = progress !== undefined && Number.isFinite(progress);
  const pct = known ? Math.max(4, Math.min(100, Math.round(progress * 100))) : undefined;
  const node = (
    <div className={`bwm-loading${leaving ? ' leaving' : ''}`} role={fault ? 'alert' : 'status'} data-testid="table-loading">
      <div className="bwm-loading-card">
        <img className="bwm-loading-mark" src="/assets/bwm-wordmark-white.svg" alt="Bid Wit Me" />
        <span className="beta-tag">BETA</span>
        {room && <div className="bwm-loading-room" data-testid="loading-room">{room}</div>}
        {fault ? (
          <>
            <p className="bwm-loading-line" data-testid="join-fault">Couldn&apos;t join this table</p>
            <p className="bwm-loading-fault">{fault}</p>
            <div className="bwm-loading-actions">
              {onRetry && <button type="button" className="primary" data-testid="join-retry" onClick={onRetry}>Retry</button>}
              {onBack && <button type="button" className="link bwm-loading-back" data-testid="join-back" onClick={onBack}>← Back</button>}
            </div>
          </>
        ) : versus ? (
          <>
            {versus}
            <div
              className={`bwm-loading-track versus-track${known ? '' : ' indeterminate'}`}
              role="progressbar"
              aria-label="Loading the table"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span style={pct !== undefined ? { width: `${pct}%` } : undefined} />
            </div>
          </>
        ) : (
          <>
            {seats && seats.length > 0 && <LoadingSeats seats={seats} reduced={!!reducedMotion} />}
            <p className="bwm-loading-line" data-testid="table-loading-line" aria-live="polite">{LOADING_LINES[line]}</p>
            <div
              className={`bwm-loading-track${known ? '' : ' indeterminate'}`}
              role="progressbar"
              aria-label="Loading the table"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span style={pct !== undefined ? { width: `${pct}%` } : undefined} />
            </div>
            <LoadingTips />
            {onBack && <button type="button" className="link bwm-loading-back" onClick={onBack}>← Back</button>}
          </>
        )}
      </div>
    </div>
  );
  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}
