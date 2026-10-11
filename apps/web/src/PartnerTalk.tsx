/**
 * Bidding helpers for team games:
 * - <BidOrder>: who bids when (non-dealing team first, back to back; then the dealer's partner; dealer last).
 * - <PartnerTalk>: one-tap hints ("3-ish", "I'm weak"…) posted to the PUBLIC table chat (everyone sees them, opponents
 *   too). Table rule: partners may talk books out loud during bidding; each still bids their own number.
 *   All typed chat is public; there is no private partner channel.
 */
import { useEffect, useState } from 'react';
import { type GameState, bidLabel, bidOrder } from '@spades/rules';
import { PARTNER_TALK_PRESETS } from '@spades/bots';

export function BidOrder({ st, names, me }: { st: GameState; names: string[]; me: number }) {
  if (st.phase !== 'bidding') return null;
  const order = bidOrder(st.rules, st.dealer);
  const partner = st.rules.partnerships ? (me + 2) % st.rules.playerCount : -1;
  return (
    <div className="bid-order" data-testid="bid-order" aria-label="Bidding order">
      <span className="bo-title">BID ORDER</span>
      {order.map((s, i) => {
        const b = st.bids[s];
        const now = st.turn === s;
        const who = s === me ? 'You' : names[s];
        return (
          <span key={s} className={`bo-seat ${now ? 'now' : ''} ${b !== null ? 'done' : ''} ${s === me || s === partner ? 'mine' : 'theirs'}`} data-testid={`bid-order-${i}`}>
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

export const PARTNER_TALK_COOLDOWN_MS = 2000;

export function PartnerTalk({ onSend, partnerName }: { onSend: (text: string) => void; partnerName: string }) {
  const [cool, setCool] = useState(0);
  useEffect(() => { if (!cool) return; const t = window.setTimeout(() => setCool(0), Math.max(0, cool - Date.now())); return () => clearTimeout(t); }, [cool]);
  return (
    <div className="partner-talk glass slant" data-testid="partner-talk" role="group" aria-label={`Partner talk: posts to the table chat, everyone sees it (for ${partnerName})`}>
      <div className="pt-head"><span className="pt-title">🤝 PARTNER TALK</span><small>to {partnerName} · table chat, everyone sees it</small></div>
      <div className="pt-row">
        {PARTNER_TALK_PRESETS.map((t) => (
          <button key={t} type="button" disabled={!!cool} data-testid={`pt-${t}`} onClick={() => { onSend(t); setCool(Date.now() + PARTNER_TALK_COOLDOWN_MS); }}>{t}</button>
        ))}
      </div>
    </div>
  );
}
