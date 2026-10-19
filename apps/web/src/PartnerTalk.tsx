/**
 * Bidding helper for team games:
 * - <BidOrder>: who bids when (non-dealing team first, back to back; then the dealer's partner; dealer last).
 * (Release 9 removed the one-tap partner-talk preset panel: partners talk out loud over open mics.)
 */
import { type GameState, bidLabel, bidOrder, partnerOf } from '@spades/rules';

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

export interface BidSummaryEntry {
  seat: number;
  who: string;
  bidText: string;
  hasBid: boolean;
  isPartner: boolean;
  isMe: boolean;
  isTurn: boolean;
  /** Bot partner only, before they bid: their own intended bid ("thinks N"). Never a guess for a human partner. */
  partnerEstimate: number | 'nil' | null;
}

/**
 * Bids so far this hand, in bidding order — the decision-moment summary shown big
 * inside the bid panel. Pure view of st.bids (the same public state the seat
 * plates and BidOrder read); no parallel source. Partner is the seat across in
 * team games (partnerOf); Cutthroat has no partner, so nobody is highlighted.
 */
export function bidSummaryEntries(st: GameState, names: string[], me: number, partnerEstimate?: number | 'nil' | null): BidSummaryEntry[] {
  const partner = me >= 0 ? partnerOf(me, st.rules) : null;
  return bidOrder(st.rules, st.dealer).map((seat) => {
    const b = st.bids[seat] ?? null;
    const isPartner = partner !== null && seat === partner;
    const estimate = isPartner && b === null ? (partnerEstimate ?? null) : null;
    return {
      seat,
      who: (seat === me ? 'You' : names[seat]) || `Seat ${seat + 1}`,
      bidText: b !== null ? bidLabel(b) : estimate !== null ? (estimate === 'nil' ? 'Nil' : `${estimate}`) : st.turn === seat ? '…' : '—',
      hasBid: b !== null,
      isPartner,
      isMe: seat === me,
      isTurn: st.turn === seat,
      partnerEstimate: estimate,
    };
  });
}

/**
 * The readable bid summary for the moment of decision: every seat's bid so far,
 * in bidding order, with the partner's bid largest and gold-highlighted. Rendered
 * inside the bid panel (which only exists on the human's bid turn), so it can
 * never cover the hand, the YOU plate, the view chips, or the misdeal button.
 */
export function BidSummary({ st, names, me, partnerEstimate }: { st: GameState; names: string[]; me: number; partnerEstimate?: number | 'nil' | null }) {
  if (st.phase !== 'bidding') return null;
  const entries = bidSummaryEntries(st, names, me, partnerEstimate);
  return (
    <div className="bid-summary" data-testid="bid-summary" role="list" aria-label="Bids so far this hand">
      <span className="bs-title" aria-hidden="true">BIDS</span>
      {entries.map((e) => (
        <span
          key={e.seat}
          className={`bs-seat ${e.isPartner ? 'partner' : ''} ${e.isMe ? 'self' : ''} ${e.hasBid ? 'done' : 'pending'} ${e.partnerEstimate !== null ? 'estimate' : ''}`}
          data-testid={`bid-summary-${e.seat}`}
          role="listitem"
          aria-label={`${e.isPartner ? 'Partner ' : ''}${e.who}: ${e.hasBid ? `bid ${e.bidText}` : e.partnerEstimate !== null ? `thinks ${e.bidText}, has not bid yet` : e.isTurn ? 'bidding now' : 'has not bid yet'}`}
        >
          <small>{e.isPartner ? `★ PARTNER · ${e.who}${e.partnerEstimate !== null ? ' · THINKS' : ''}` : e.who}</small>
          <b>{e.bidText}</b>
        </span>
      ))}
    </div>
  );
}
