import { OFFERED_MODE_NAME, offeredKindOf } from '../offeredModes';

/**
 * The broadcast score bug (streaming package): the overlay an OBS browser
 * source shows over the spectator table — LIVE marker, table code, the sides
 * with scores and bags, hand number and mode, and the watcher count.
 *
 * REDACTION CONTRACT: this component receives ONLY spectator-shaped data —
 * side names, scores, bags, hand number, mode — prepared by OnlineTable from
 * the SHOWN spectator state. It never receives a PlayerView, a hand, or a
 * seat's cards, and it renders nothing from anywhere else. The bug can only
 * ever show what a spectator already sees.
 */
export interface BroadcastSide { name: string; score: number; bags: number }

export default function BroadcastOverlay({ code, handNo, mode, playerCount, sides, watchers }: {
  code: string;
  handNo: number;
  mode: string;
  playerCount: number;
  sides: BroadcastSide[];
  watchers: number;
}) {
  const kind = offeredKindOf({ mode, playerCount });
  const modeName = kind ? OFFERED_MODE_NAME[kind] : mode;
  return (
    <div className="broadcast-bug" data-testid="broadcast-bug" aria-hidden>
      <div className="broadcast-bug-head">
        <span className="broadcast-live"><i />LIVE</span>
        <span className="broadcast-code">TABLE {code}</span>
        <span className="broadcast-meta">{modeName}{handNo > 0 ? ` · HAND ${handNo}` : ''}</span>
        {watchers > 0 && <span className="broadcast-watchers">👁 {watchers}</span>}
      </div>
      <div className="broadcast-bug-sides">
        {sides.map((s, i) => (
          <div key={i} className="broadcast-side">
            <span className="broadcast-side-name">{s.name}</span>
            <span className="broadcast-side-score">{s.score}</span>
            <span className="broadcast-side-bags">{s.bags}B</span>
          </div>
        ))}
      </div>
    </div>
  );
}
