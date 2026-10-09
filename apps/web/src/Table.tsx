import { useEffect, useMemo, useState } from 'react';
import { type Card, type TableRules, bidLabel, cardLabel, isJoker, isNilBid, isTrump, sideOf, sortHand, trumpOrder } from '@spades/rules';
import CardView from './CardView';
import { HandSummary, ScorePad, sideName } from './Modals';
import { type Settings, modeTitle } from './settings';
import { HUMAN, useGame } from './useGame';

interface Props {
  rules: TableRules;
  seed: string;
  settings: Settings;
  onExit: () => void;
  onRematch: () => void;
}

const NAMES4 = ['You', 'Marcus', 'Keisha', 'Dre'];
const NAMES3 = ['You', 'Marcus', 'Keisha'];

function positions(n: number): string[] {
  return n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'];
}

function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export default function Table({ rules: initialRules, seed, settings, onExit, onRematch }: Props) {
  const { st, view, pause, error, apply } = useGame(initialRules, seed, settings.botLevel, settings.speed);
  const r = st.rules;
  const n = r.playerCount;
  const names = n === 4 ? NAMES4 : NAMES3;
  const pos = positions(n);
  const [selected, setSelected] = useState<Card | null>(null);
  const [exchangePick, setExchangePick] = useState<Card[]>([]);
  const [showPad, setShowPad] = useState(false);
  const width = useWidth();

  const shownTrick = pause ? st.tricks[st.tricks.length - 1]! : st.trick;
  const myTurn = !pause && st.turn === HUMAN;
  const hand = useMemo(() => (view.hand ? sortHand(view.hand, r) : null), [view.hand, r]);
  const legal = myTurn && st.phase === 'playing' ? view.legal : [];
  const exchangeStep = st.phase === 'exchange' ? st.exchange[0] : undefined;
  const humanExchanging = myTurn && exchangeStep?.from === HUMAN;

  useEffect(() => { setSelected(null); }, [st.turn, st.handNo]);
  useEffect(() => { setExchangePick([]); }, [st.phase, st.turn]);

  const trumps = useMemo(() => trumpOrder(r).slice(0, 5).map((c) => (c === 'BJ' ? 'Big Joker' : c === 'LJ' ? 'Little Joker' : cardLabel(c))), [r]);

  const promoted = (c: Card) => !isJoker(c) && c[1] !== 'S' && isTrump(c, r);

  const onCard = (c: Card) => {
    if (humanExchanging) {
      setExchangePick((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length < exchangeStep!.count ? [...p, c] : p));
      return;
    }
    if (!legal.includes(c)) return;
    if (selected === c) {
      apply({ type: 'play', seat: HUMAN, card: c });
      setSelected(null);
    } else setSelected(c);
  };

  // hand layout: overlap cards to fit the screen
  const cardW = Math.min(76, Math.max(46, width * 0.13));
  const count = hand?.length ?? view.handCounts[HUMAN]!;
  const avail = Math.min(width, 900) - 24;
  const step = count > 1 ? Math.min(cardW + 4, (avail - cardW) / (count - 1)) : 0;

  const winnerSeat = pause ? shownTrick.winner : null;
  const mySide = sideOf(HUMAN, r);

  return (
    <div className="table-screen" style={{ ['--cw' as string]: `${cardW}px` }}>
      <header className="topbar">
        <button type="button" className="icon" onClick={onExit} aria-label="Menu">☰</button>
        <div className="title">
          <span>Bid Wit Me</span>
          <small>{modeTitle(r)} · Hand {st.handNo} · to {r.targetScore}</small>
        </div>
        <button type="button" className="icon" onClick={() => setShowPad(true)} aria-label="Score pad">📋</button>
      </header>

      <div className={`scores n${st.scores.length}`}>
        {st.scores.map((s, i) => (
          <div key={i} className={`score ${i === mySide ? 'mine' : ''}`}>
            <span className="score-name">{r.partnerships ? (i === mySide ? 'Us' : 'Them') : names[i]}</span>
            <span className="score-val">{s}</span>
            <span className="score-bags">{st.bags[i]} bag{st.bags[i] === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>

      <main className={`felt n${n}`}>
        <div className="legend" title="Trump order">
          <span>♠ trumps</span> {trumps.join(' › ')} …
          {st.spadesBroken ? <em className="broken">broken</em> : null}
        </div>

        {Array.from({ length: n }, (_, seat) => {
          if (seat === HUMAN) return null;
          const p = pos[seat]!;
          const isTurn = st.turn === seat && !pause;
          const partner = r.partnerships && seat === 2;
          return (
            <div key={seat} className={`seat seat-${p} ${isTurn ? 'turn' : ''}`}>
              <div className="avatar">{names[seat]![0]}</div>
              <div className="seat-info">
                <span className="seat-name">{names[seat]}{partner && <em> · partner</em>}{st.dealer === seat && <span className="dealer">D</span>}</span>
                <span className="seat-bid">
                  {st.bids[seat] === null ? (isTurn && st.phase === 'bidding' ? 'bidding…' : '—') : `Bid ${bidLabel(st.bids[seat])}`}
                  {' · '}Took {st.tricksWon[seat]}
                </span>
              </div>
              <div className="mini-hand">
                {Array.from({ length: Math.min(view.handCounts[seat]!, 7) }, (_, i) => <CardView key={i} faceDown small style={{ marginLeft: i ? -22 : 0 }} />)}
                <span className="count">{view.handCounts[seat]}</span>
              </div>
            </div>
          );
        })}

        <div className="trick">
          {shownTrick.plays.map((pl) => (
            <div key={pl.seat} className={`played from-${pos[pl.seat]} ${winnerSeat === pl.seat ? 'winner' : ''}`}>
              <CardView card={pl.card} trumpBadge={promoted(pl.card)} />
            </div>
          ))}
          {st.phase === 'bidding' && !pause && (
            <div className="center-note">
              {st.turn === HUMAN ? 'Your bid' : `${names[st.turn!]} is bidding…`}
            </div>
          )}
          {st.phase === 'exchange' && !humanExchanging && (
            <div className="center-note">{names[exchangeStep!.from]} passes {exchangeStep!.count} to {names[exchangeStep!.to]}…</div>
          )}
          {winnerSeat !== null && <div className="center-note win">{winnerSeat === HUMAN ? 'You take it' : `${names[winnerSeat]} takes it`}</div>}
        </div>
      </main>

      <section className={`me ${myTurn && st.phase !== 'handOver' ? 'turn' : ''}`}>
        <div className="me-info">
          <span className="seat-name">You{st.dealer === HUMAN && <span className="dealer">D</span>}</span>
          <span className="seat-bid">
            {st.bids[HUMAN] === null ? 'No bid yet' : `Bid ${bidLabel(st.bids[HUMAN])}`} · Took {st.tricksWon[HUMAN]}
            {isNilBid(st.bids[HUMAN]) && st.tricksWon[HUMAN]! > 0 && <em className="neg"> nil broken</em>}
          </span>
          {myTurn && st.phase === 'playing' && <span className="hint">{selected ? 'Tap again to play' : 'Your turn — tap a card'}</span>}
          {error && <span className="neg small">{error}</span>}
        </div>

        {myTurn && st.phase === 'bidding' && view.bidOptions && (
          view.hand === null ? (
            <div className="bid-panel">
              <p>Bid <b>Blind Nil</b> before looking? Worth ±{r.blindNil.value}.</p>
              <div className="bid-row">
                {view.bidOptions.blindNil && <button type="button" className="danger" onClick={() => apply({ type: 'bid', seat: HUMAN, bid: 'blindNil' })}>Blind Nil</button>}
                <button type="button" className="primary" onClick={() => apply({ type: 'reveal', seat: HUMAN })}>See my cards</button>
              </div>
            </div>
          ) : (
            <div className="bid-panel">
              <div className="bid-grid">
                {Array.from({ length: view.bidOptions.max - view.bidOptions.min + 1 }, (_, i) => view.bidOptions!.min + i).map((b) => (
                  <button type="button" key={b} onClick={() => apply({ type: 'bid', seat: HUMAN, bid: b })}>{b}</button>
                ))}
                {view.bidOptions.nil && <button type="button" className="nil" onClick={() => apply({ type: 'bid', seat: HUMAN, bid: 'nil' })}>Nil</button>}
              </div>
              {r.partnerships && typeof st.bids[2] === 'number' && <small className="muted">Partner bid {st.bids[2]}</small>}
            </div>
          )
        )}
        {st.phase === 'bidding' && view.hand === null && !myTurn && (
          <div className="bid-panel compact">
            <span>Cards face down — you can bid Blind Nil on your turn.</span>
            <button type="button" onClick={() => apply({ type: 'reveal', seat: HUMAN })}>See cards</button>
          </div>
        )}
        {humanExchanging && (
          <div className="bid-panel">
            <p>Pick {exchangeStep!.count} cards to pass to {names[exchangeStep!.to]}.</p>
            <button type="button" className="primary" disabled={exchangePick.length !== exchangeStep!.count} onClick={() => apply({ type: 'exchange', seat: HUMAN, cards: exchangePick })}>Pass cards</button>
          </div>
        )}

        <div className="hand" style={{ height: cardW * 1.45 + 18 }}>
          <div className="hand-inner" style={{ width: count > 0 ? cardW + step * (count - 1) : 0 }}>
            {(hand ?? Array.from({ length: count }, () => undefined)).map((c, i) => (
              <CardView
                key={c ?? i}
                card={c}
                faceDown={!c}
                legal={!!c && legal.includes(c)}
                dim={!!c && myTurn && st.phase === 'playing' && !legal.includes(c)}
                selected={!!c && (selected === c || exchangePick.includes(c))}
                onClick={c && (legal.includes(c) || humanExchanging) ? () => onCard(c) : undefined}
                style={{ left: i * step, zIndex: i }}
                className="in-hand"
                trumpBadge={!!c && promoted(c)}
              />
            ))}
          </div>
        </div>
      </section>

      {st.phase === 'handOver' && !pause && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Hand {st.handNo} scored</h2>
            <div className="scroll"><HandSummary rec={st.history[st.history.length - 1]!} rules={r} names={names} /></div>
            <button type="button" className="primary big" onClick={() => apply({ type: 'nextHand' })}>Next hand</button>
          </div>
        </div>
      )}

      {st.phase === 'gameOver' && !pause && st.result && (
        <div className="modal-backdrop">
          <div className="modal gameover">
            <div className="trophy">{st.result.winners.includes(mySide) ? '🏆' : '♠'}</div>
            <h2>{st.result.winners.includes(mySide) ? (st.result.winners.length > 1 ? 'You tied for first!' : 'You win!') : `${st.result.winners.map((w) => sideName(r, w, names)).join(' & ')} win${r.partnerships || st.result.winners.length > 1 ? '' : 's'}`}</h2>
            <p className="muted">{st.result.endReason === 'floor' ? 'Ended by the losing floor.' : `First to ${r.targetScore}.`} {st.history.length} hands played.</p>
            <ol className="placements">
              {st.result.finalScores
                .map((score, side) => ({ side, score, place: st.result!.placements[side]! }))
                .sort((a, b) => a.place - b.place)
                .map((x) => (
                  <li key={x.side} className={x.side === mySide ? 'mine' : ''}>
                    <span className="place">#{x.place}</span>
                    <span>{sideName(r, x.side, names)}</span>
                    <b>{x.score}</b>
                  </li>
                ))}
            </ol>
            <div className="bid-row">
              <button type="button" onClick={() => setShowPad(true)}>Score pad</button>
              <button type="button" onClick={onExit}>Change mode</button>
              <button type="button" className="primary" onClick={onRematch}>Rematch</button>
            </div>
          </div>
        </div>
      )}

      {showPad && <ScorePad st={st} names={names} onClose={() => setShowPad(false)} />}
    </div>
  );
}
