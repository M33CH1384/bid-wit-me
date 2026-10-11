import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { type GameState, sideOf } from '@spades/rules';
import type { TalkIntensity, TalkKind } from '@spades/bots';
import { QUICK_CONTEXTS, QUICK_COOLDOWN_MS, generalLines, quickLines } from './quickTrash';

/** what just happened, from this player's point of view (most relevant first) */
export function contextKinds(st: GameState, me: number): TalkKind[] {
  const r = st.rules, mine = sideOf(me, r);
  const out: TalkKind[] = [];
  const opp = (seat: number) => sideOf(seat, r) !== mine;
  if (st.phase === 'gameOver') out.push('win');
  if (st.phase === 'handOver' || st.phase === 'gameOver') {
    const h = st.history.at(-1);
    if (h) {
      if (h.sides.some((s) => s.side !== mine && s.contractMade === false)) out.push('setThem');
      if (h.sides.some((s) => s.side !== mine && s.bagPenaltyCount > 0)) out.push('bags');
      if (h.sides.some((s) => s.side === mine && s.tricks >= 13)) out.push('boston');
      if (h.sides.some((s) => s.side !== mine && s.nils.some((n) => !n.made))) out.push('nilBust');
    }
  }
  if (st.phase === 'bidding' || st.phase === 'playing') {
    st.bids.forEach((b, i) => {
      if (!opp(i)) return;
      if (b === 'blindNil') out.push('blindNil');
      else if (b === 'nil') out.push(st.phase === 'playing' && (st.tricksWon[i] ?? 0) > 0 ? 'nilBust' : 'nilBid');
      else if (typeof b === 'number' && b >= (r.partnerships ? 6 : 5)) out.push('bidTooHigh');
    });
  }
  if (st.phase === 'bidding' && st.turn === me) out.push('badHand');
  if (st.phase === 'playing') {
    const t = st.trick.plays.length ? st.trick : st.tricks.at(-1);
    if (t?.plays.some((p) => p.card === 'BJ' || p.card === 'LJ')) out.push('joker');
    if (t && t.plays.length > 1 && t.plays.some((p, i) => i > 0 && p.card[1] === 'S' && t.plays[0]!.card[1] !== 'S')) out.push('cut');
    if (t?.winner !== undefined && t.winner !== null && !opp(t.winner)) out.push('slam');
    if (st.turn !== null && st.turn !== me && opp(st.turn)) out.push('slow');
  }
  return [...new Set(out)];
}

/** "Talk trash": preset lines (no typing) — a tab for what just happened, plus a general tab. One per ~4 s. */
export function TrashTalkButton({ st, me, intensity, onSend }: { st: GameState; me: number; intensity: TalkIntensity; onSend: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TalkKind | 'general'>('general');
  const [cool, setCool] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ctx = useMemo(() => contextKinds(st, me).filter((k) => quickLines(k, intensity).length > 0), [st, me, intensity]);
  useEffect(() => { if (open) setTab(ctx[0] ?? 'general'); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => { if (cool <= Date.now()) return; const t = window.setTimeout(() => setCool(0), cool - Date.now()); return () => clearTimeout(t); }, [cool]);
  const lines = tab === 'general' ? generalLines(intensity) : quickLines(tab, intensity);
  const [place, setPlace] = useState<CSSProperties>({});
  const cooling = cool > Date.now();
  const label = (k: TalkKind) => QUICK_CONTEXTS.find((c) => c.kind === k)?.label ?? k;
  return (
    <div className="trash-wrap" ref={ref}>
      {open && (
        <div className="trash-pop glass slant" role="dialog" aria-label="Talk trash" data-testid="trash-pop" style={place}>
          <div className="trash-tabs" role="tablist">
            {ctx.slice(0, 3).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label(k)}</button>)}
            <button type="button" role="tab" aria-selected={tab === 'general'} className={tab === 'general' ? 'on' : ''} data-testid="trash-tab-general" onClick={() => setTab('general')}>General</button>
          </div>
          <div className="trash-lines">
            {lines.map((l) => (
              <button key={l} type="button" className="trash-line" disabled={cooling} onClick={() => { onSend(l); setCool(Date.now() + QUICK_COOLDOWN_MS); setOpen(false); }}>{l}</button>
            ))}
          </div>
        </div>
      )}
      <button type="button" className={`trash-btn ${cooling ? 'cooling' : ''}`} data-testid="talk-trash" aria-expanded={open} onClick={(e) => {
        // open toward the roomier side of the screen (the controls sit top-right on wide screens, mid-right on phones)
        const r = e.currentTarget.getBoundingClientRect(), vh = window.innerHeight;
        const down = r.top < vh / 2;
        setPlace(down ? { top: 'calc(100% + 8px)', maxHeight: Math.min(420, Math.max(160, vh - r.bottom - 16)) } : { bottom: 'calc(100% + 8px)', maxHeight: Math.min(420, Math.max(160, r.top - 16)) });
        setOpen((o) => !o);
      }} title={cooling ? 'Catch your breath…' : 'Talk trash'}>
        🗣<span>Talk trash</span>
      </button>
    </div>
  );
}
