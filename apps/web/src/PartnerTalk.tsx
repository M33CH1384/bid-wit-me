/**
 * Bidding helper for team games:
 * - <BidOrder>: who bids when (non-dealing team first, back to back; then the dealer's partner; dealer last).
 * (Release 9 removed the one-tap partner-talk preset panel: partners talk out loud over open mics.)
 */
import { type GameState, bidLabel, bidOrder } from '@spades/rules';

/** Center strip: the whole auction, including the hand you bid first. Hidden only while the deal animation or a pause is up. */
export function showCenterBidOrder(phase: string, pause: boolean, dealing: boolean): boolean {
  return phase === 'bidding' && !pause && !dealing;
}

export function BidOrder({ st, names, me }: { st: GameState; names: string[]; me: number }) {
  if (st.phase !== 'bidding') return null;
  const order = bidOrder(st.rules, st.dealer);
  const partner = st.rules.partnerships ? (me + 2) % st.rules.playerCount : -1;
  return (
    <div className="bid-order" data-testid="bid-order" role="list" aria-label="Bidding order">
      <span className="bo-title" aria-hidden="true">BID ORDER</span>
      {order.map((s, i) => {
        const b = st.bids[s];
        const now = st.turn === s;
        const who = (s === me ? 'You' : names[s]) || `Seat ${s + 1}`;
        return (
          <span key={s} className={`bo-seat ${now ? 'now' : ''} ${b !== null ? 'done' : ''} ${s === me || s === partner ? 'mine' : 'theirs'}`} data-testid={`bid-order-${i}`} role="listitem" aria-label={`${i + 1}. ${who}${s === st.dealer ? ' (dealer)' : ''}${b !== null ? `, bid ${bidLabel(b)}` : now ? ', bidding now' : ''}`}>
            {i > 0 && <i aria-hidden>›</i>}
            <b>{who}</b>
            {s === st.dealer && <em title="Dealer bids last">D</em>}
            {b !== null && <small>{bidLabel(b)}</small>}
          </span>
        );
      })}
    </div>
  );
}
