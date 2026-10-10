import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { type GameState, isNilBid } from '@spades/rules';
import type { ChatMsg } from './overlay';
import { sideName } from './Modals';
import { handWinner, streakLabel, streakOf } from './fx';

/**
 * "Table Talk" — the streamer-style intermission after every hand's scoring (online and offline).
 * Recap (bid vs books per player, made / set, bags), running scores with progress toward the target, callouts
 * (streak / SHOT!), a 2×2 "everyone on cam" grid (online; avatars when a camera is off), prominent chat with quick
 * reactions, a mini view of the next deal shuffling, a countdown and Ready / Continue.
 * Online, every mic is open during Table Talk (partners included); partner-muting resumes when bidding starts.
 */
export const REACTIONS = ['gg', 'run it back', 'too easy', '🔥', '😭'];

export interface Callout { kind: 'shot' | 'gotShot' | 'streak' | 'nil' | 'bust'; text: string; side?: number; level?: number }

/** What to shout about for the latest scored hand (also drives the fx pop-ups). */
export function calloutsFor(st: GameState, mySide: number, names: string[]): Callout[] {
  const r = st.rules;
  const rec = st.history[st.history.length - 1];
  if (!rec) return [];
  const out: Callout[] = [];
  for (const s of rec.sides) {
    if (s.contractMade === false) out.push({ kind: s.side === mySide ? 'gotShot' : 'shot', side: s.side, text: s.side === mySide ? `${r.partnerships ? 'We' : 'You'} got set (−${Math.abs(s.contractPoints)})` : `${sideName(r, s.side, names)} SET (−${Math.abs(s.contractPoints)})` });
    for (const nl of s.nils) out.push({ kind: nl.made ? 'nil' : 'bust', side: s.side, text: `${names[nl.seat]} ${nl.made ? 'made' : 'busted'} ${rec.bids[nl.seat] === 'blindNil' ? 'Blind Nil' : 'Nil'}` });
  }
  const w = handWinner(rec.sides.map((s) => s.points));
  if (w !== null) {
    const n = streakOf(st.history, w);
    const label = streakLabel(n);
    if (label) out.push({ kind: 'streak', side: w, level: n, text: `${label} · ${sideName(r, w, names)} ${n} in a row` });
  }
  return out;
}

function Avatar({ name }: { name: string }) {
  return <div className="tt-avatar"><span>{name.slice(0, 1).toUpperCase()}</span></div>;
}

export function Intermission({
  st, names, mySide, msgs, onSend, secs, ready, onReady, tile, online, onScorePad, series, teamEdit,
}: {
  /** rematch series chip */
  series?: ReactNode;
  /** rename your team (team modes) */
  teamEdit?: ReactNode;
  st: GameState;
  names: string[];
  mySide: number;
  msgs: ChatMsg[];
  onSend: (text: string) => void;
  /** countdown to the next hand (online), or null */
  secs: number | null;
  /** online: ready state ("2/4 ready") */
  ready?: { mine: boolean; count: number; of: number };
  onReady: () => void;
  /** online: the enlarged video / avatar tile for a local seat */
  tile?: (seat: number) => ReactNode;
  online: boolean;
  onScorePad: () => void;
}) {
  const r = st.rules;
  const rec = st.history[st.history.length - 1]!;
  const callouts = calloutsFor(st, mySide, names);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e6 }); }, [msgs.length]);
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) onSend(text.trim().slice(0, 200)); setText(''); };
  const sides = rec.sides;
  const target = r.targetScore;
  const recent = msgs.slice(-30);
  const seatOrder = Array.from({ length: r.playerCount }, (_, i) => i);

  return (
    <div className="tt-backdrop" data-testid="table-talk" role="dialog" aria-label="Table Talk">
      <div className="tt glass slant">
        <header className="tt-head">
          <span className="tt-live"><span className="live-dot" /> TABLE TALK</span>
          <span className="tt-title">HAND {rec.handNo} RECAP</span>
          {series}
          {secs !== null && <span className={`tt-count ${secs <= 5 ? 'hot' : ''}`} data-testid="talk-count">Next deal {secs}s</span>}
        </header>

        <div className="tt-body">
          <section className="tt-left">
            {teamEdit && <div className="tt-team-edit"><small>YOUR TEAM NAME</small>{teamEdit}</div>}
            <div className="tt-recap" data-testid="talk-recap">
              {sides.map((s) => {
                const books = s.bookPoints > 0 || s.seats.every((x) => rec.bids[x] === 'books');
                const pct = Math.max(0, Math.min(1, s.totalScore / target));
                const verdict = books ? { t: 'BOOKS', ok: true } : s.contractMade === null ? null : { t: s.contractMade ? 'MADE' : 'SET', ok: s.contractMade };
                return (
                  <div key={s.side} className={`tt-team ${s.side === mySide ? 'mine' : ''}`} data-testid={`recap-side-${s.side}`}>
                    <div className="tt-team-name">
                      <b>{sideName(r, s.side, names)}</b>
                      <span className="tt-badges">
                        {verdict && <span className={`tt-verdict ${verdict.ok ? 'ok' : 'bad'}`}>{verdict.t}</span>}
                        {s.nils.map((nl) => <span key={nl.seat} className={`tt-verdict nilb ${nl.made ? 'ok' : 'bad'}`}>{rec.bids[nl.seat] === 'blindNil' ? 'BLIND NIL' : 'NIL'} {nl.made ? '✓' : '✗'} {nl.points > 0 ? '+' : ''}{nl.points}</span>)}
                        {!books && s.bagsAdded > 0 && <span className="tt-verdict bags">+{s.bagsAdded} bag{s.bagsAdded === 1 ? '' : 's'}</span>}
                        {s.bagPenaltyCount > 0 && <span className="tt-verdict bad">BAG PENALTY {s.bagPenaltyPoints}</span>}
                      </span>
                    </div>
                    <div className="tt-stat books" title="books / bid">
                      <small>BOOKS/BID</small>
                      <b data-testid={`recap-books-${s.side}`}>{books ? `${s.tricks}` : s.contract ? `${s.contractTricks}/${s.contract}` : `${s.tricks}/—`}</b>
                      <span className="tt-players">
                        {s.seats.map((x) => {
                          const bd = rec.bids[x]!;
                          return <span key={x}>{names[x]} {rec.tricksWon[x]}/{bd === 'books' ? '—' : isNilBid(bd) ? <em className="nil-tag">{bd === 'blindNil' ? 'BN' : 'NIL'}</em> : bd}</span>;
                        })}
                      </span>
                    </div>
                    <div className="tt-stat hand">
                      <small>HAND</small>
                      <b className={s.points < 0 ? 'neg' : 'pos'}>{s.points > 0 ? '+' : ''}{s.points}</b>
                    </div>
                    <div className="tt-stat total">
                      <small>TOTAL</small>
                      <b data-testid={`recap-total-${s.side}`}>{s.totalScore}</b>
                      <span className="tt-players">{s.totalBags} bag{s.totalBags === 1 ? '' : 's'}</span>
                    </div>
                    <div className="tt-bar" aria-label={`${s.totalScore} of ${target}`}><i style={{ width: `${pct * 100}%` }} /><small>to {target}</small></div>
                  </div>
                );
              })}
            </div>

            {callouts.length > 0 && (
              <div className="tt-callouts">
                {callouts.map((c, i) => <span key={i} className={`tt-callout ${c.kind}`}>{c.kind === 'shot' ? 'SHOT! ' : c.kind === 'gotShot' ? 'GOT SHOT · ' : c.kind === 'streak' ? '🔥 ' : ''}{c.text}</span>)}
              </div>
            )}

            <div className="tt-deal" aria-label="Next deal">
              <div className="tt-deck">{Array.from({ length: 6 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</div>
              <div className="tt-fly">{Array.from({ length: 8 }, (_, i) => <i key={i} className={`to${i % 4}`} style={{ animationDelay: `${0.9 + i * 0.22}s` }} />)}</div>
              <small>Shuffling hand {rec.handNo + 1}…</small>
            </div>
          </section>

          <section className="tt-right">
            <div className={`tt-grid n${r.playerCount}`} data-testid="talk-grid">
              {seatOrder.map((seat) => (
                <div key={seat} className={`tt-tile ${sides.find((x) => x.seats.includes(seat))!.side === mySide ? 'mine' : ''}`}>
                  {tile?.(seat) ?? <Avatar name={names[seat]!} />}
                  <span className="tt-name">{names[seat]}</span>
                </div>
              ))}
            </div>
            {online && <div className="tt-mics" data-testid="talk-mics">🎙 All mics open — partners can talk</div>}
            <div className="tt-chat">
              <div className="chat-list" ref={listRef}>
                {recent.map((m) => (
                  <div key={m.id} className={`chat-line ${m.system ? 'system' : ''}`}>
                    {m.system ? <span>{m.text}</span> : <><b style={{ color: m.color }}>{m.user}</b><span>{m.text}</span></>}
                  </div>
                ))}
              </div>
              <div className="tt-reacts">
                {REACTIONS.map((e) => <button key={e} type="button" data-testid={`react-${e}`} onClick={() => onSend(e)}>{e}</button>)}
              </div>
              <form onSubmit={submit} className="chat-input">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Talk your talk…" maxLength={200} aria-label="Table talk message" />
                <button type="submit" aria-label="Send">➤</button>
              </form>
            </div>
          </section>
        </div>

        <footer className="tt-foot bid-row">
          <button type="button" onClick={onScorePad}>Score pad</button>
          {ready && <span className="muted" data-testid="talk-ready-count">{ready.count}/{ready.of} ready</span>}
          <button type="button" className="primary big" data-testid="talk-ready" disabled={!!ready?.mine} onClick={onReady}>
            {online ? (ready?.mine ? 'Waiting for the table…' : 'Ready') : 'Continue'}
          </button>
        </footer>
      </div>
    </div>
  );
}
