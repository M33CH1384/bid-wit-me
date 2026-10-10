import { type FormEvent, useEffect, useRef, useState } from 'react';
import { cardLabel, trumpOrder } from '@spades/rules';
import type { RoomInfo, SeatInfo } from '@spades/protocol';
import { type ModeKey, type Settings, MODES, modeTitle, settingsToRules } from '../settings';
import type { ConnState, TableConnection } from './connection';
import { inviteLink } from './config';
import { MediaBar, SeatMedia } from './Media';
import { colorFor, useVideo } from './useOnline';
import type { VideoMesh } from './video';

const TIMERS = { relaxed: { bid: 45, play: 30 }, normal: { bid: 30, play: 20 }, fast: { bid: 15, play: 10 } } as const;
type TimerKey = keyof typeof TIMERS;

function timerKey(room: RoomInfo): TimerKey {
  const t = room.rules.turnTimerSec;
  return (Object.keys(TIMERS) as TimerKey[]).find((k) => TIMERS[k].bid === t.bid && TIMERS[k].play === t.play) ?? 'normal';
}

/** Room lobby: invite link, seat picking (partners across), host settings, bots, chat, camera check. */
export default function Lobby({ conn, cs, mesh, settings, onSettings, onBackToGame, onLeave }: {
  conn: TableConnection; cs: ConnState; mesh: VideoMesh | null; settings: Settings; onSettings: (s: Settings) => void;
  onBackToGame: (() => void) | null; onLeave: () => void;
}) {
  const room = cs.room!;
  const vs = useVideo(mesh);
  const isHost = room.hostId === cs.you;
  const n = room.rules.playerCount;
  const playing = room.phase === 'playing';
  const [copied, setCopied] = useState(false);
  const link = inviteLink(room.code);
  const r = room.rules;

  // which of the 4 diamond spots each seat sits in: me at the bottom when seated
  const me = cs.seat ?? 0;
  const spots = n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'];
  const spotOf = (seat: number) => spots[(seat - me + n) % n]!;

  const config = (s: Settings, timer: TimerKey = timerKey(room), botLevel = room.botLevel, talkSec = room.talkSec) => {
    onSettings(s);
    const rules = { ...settingsToRules(s), turnTimerSec: { ...TIMERS[timer] } };
    conn.send({ t: 'config', rules, botLevel, talkSec });
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => config({ ...settings, [k]: v });

  const share = async () => {
    const text = `Pull up to my Spades table on Bid Wit Me 🃏 Code ${room.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Bid Wit Me', text, url: link }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  const order = trumpOrder(r).slice(0, 5).map((c) => (c === 'BJ' ? 'Big 🃏' : c === 'LJ' ? 'Little 🃏' : cardLabel(c)));
  const team = (seat: number) => (r.partnerships ? (seat % 2 === 0 ? 'A' : 'B') : null);
  const seatedHumans = room.seats.filter((s) => s.kind === 'human').length;

  return (
    <div className="setup lobby" data-testid="lobby">
      <header className="lobby-head">
        <img className="logo small" src="/assets/bwm-wordmark-white.svg" alt="Bid Wit Me" />
        <div className="room-code" data-testid="room-code" aria-label={`Table code ${room.code}`}>
          <small>TABLE CODE</small>
          <b>{room.code}</b>
        </div>
        <div className="invite">
          <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="primary" onClick={share}>{copied ? 'Copied!' : 'Invite'}</button>
        </div>
        {cs.status !== 'open' && <p className="muted">{cs.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p>}
      </header>

      <section className="panel lobby-table">
        <div className="mini-felt">
          <div className="felt-center">
            <span>{modeTitle(r)}</span>
            <small>{r.partnerships ? 'Partners sit across' : 'Every player for themselves'}</small>
          </div>
          {room.seats.map((s, seat) => (
            <SeatCard
              key={seat} seat={seat} info={s} spot={spotOf(seat)} team={team(seat)} mine={cs.seat === seat} isHost={isHost} playing={playing}
              hostId={room.hostId} you={cs.you}
              onSit={() => conn.send({ t: 'sit', seat })}
              onBot={() => conn.send({ t: 'addBot', seat })}
              onRemoveBot={() => conn.send({ t: 'removeBot', seat })}
              media={<SeatMedia seat={s} isMe={cs.seat === seat} mesh={mesh} vs={vs} />}
            />
          ))}
        </div>
        {r.partnerships && <p className="hint">Team A: seats 1 &amp; 3 · Team B: seats 2 &amp; 4. Tap a seat to sit.</p>}
        <MediaBar mesh={mesh} vs={vs} seated={cs.seat !== null} />
        {cs.seat !== null && !vs.cam && <p className="hint">Video is optional: tap 📷 to turn your camera on. It goes straight to the other players, never through our server.</p>}
      </section>

      {isHost && !playing ? (
        <section className="panel">
          <div className="panel-title">TABLE SETTINGS <small>(host)</small></div>
          <div className="modes compact">
            {MODES.map((m) => (
              <button key={m.key} type="button" className={`mode ${settings.mode === m.key ? 'selected' : ''}`} onClick={() => set('mode', m.key as ModeKey)}>
                <span className="mode-title">{m.title}</span>
                <span className="mode-players">{m.players}</span>
              </button>
            ))}
          </div>
          {settings.mode.startsWith('cutthroat') && (
            <div className="row deck-choice">
              <span className="row-label">Deck<small>{settings.cutthroatDeck === 'joker54' ? 'Jokers + 2♦ are trumps' : 'No jokers, A♠ is the top trump'}</small></span>
              <span className="seg" role="radiogroup" aria-label="Deck">
                {(['joker54', 'standard52'] as const).map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={settings.cutthroatDeck === d} className={settings.cutthroatDeck === d ? 'on' : ''} onClick={() => set('cutthroatDeck', d)}>
                    {d === 'joker54' ? 'Joker' : 'Standard 52'}
                  </button>
                ))}
              </span>
            </div>
          )}
          <label className="row"><span className="row-label">Target score</span><span className="row-control">
            <select value={String(settings.targetScore)} onChange={(e) => set('targetScore', e.target.value === 'default' ? 'default' : Number(e.target.value))}>
              <option value="default">Default ({settings.mode.startsWith('cutthroat') ? 300 : 500})</option>
              <option value="250">250</option><option value="300">300</option><option value="500">500</option>
            </select></span></label>
          <label className="row"><span className="row-label">Turn timer<small>then the bot plays for you</small></span><span className="row-control">
            <select value={timerKey(room)} onChange={(e) => config(settings, e.target.value as TimerKey)}>
              <option value="relaxed">Relaxed (45s / 30s)</option><option value="normal">Normal (30s / 20s)</option><option value="fast">Fast (15s / 10s)</option>
            </select></span></label>
          <label className="row"><span className="row-label">Bots</span><span className="row-control">
            <select value={room.botLevel} onChange={(e) => config(settings, timerKey(room), e.target.value as 'easy' | 'normal')}>
              <option value="easy">Easy</option><option value="normal">Normal</option>
            </select></span></label>
          <label className="row"><span className="row-label">Table Talk<small>between hands · all mics open</small></span><span className="row-control">
            <select data-testid="talk-sec" value={String(room.talkSec ?? 20)} onChange={(e) => config(settings, timerKey(room), room.botLevel, Number(e.target.value))}>
              {[15, 20, 30, 45].map((x) => <option key={x} value={x}>{x}s{x === 20 ? ' (default)' : ''}</option>)}
            </select></span></label>
          <label className="row"><span className="row-label">Blind Nil</span><span className="row-control">
            <select value={settings.blindNil} onChange={(e) => set('blindNil', e.target.value as Settings['blindNil'])}>
              <option value="behind100">When behind by 100+</option><option value="always">Always</option><option value="off">Off</option>
            </select></span></label>
          <label className="row"><span className="row-label">First hand: books bid themselves<small>No bidding in hand 1 · 10 points per book</small></span><span className="row-control">
            <button type="button" data-testid="books-toggle" className={`toggle ${settings.firstHandBidsItself !== false ? 'on' : ''}`} role="switch" aria-checked={settings.firstHandBidsItself !== false} aria-label="First hand: books bid themselves" onClick={() => set('firstHandBidsItself', settings.firstHandBidsItself === false)}><span /></button>
          </span></label>
          <p className="hint">Other house rules (bags, minimum bid, 10 for 200…) come from the House rules on the main menu.</p>
        </section>
      ) : (
        <div className="summary">
          <span>{modeTitle(r)} · Trumps: {order.join(' › ')} …</span>
          <span>Target {r.targetScore} · timer {r.turnTimerSec.bid}s/{r.turnTimerSec.play}s</span>
          {r.firstHandBidsItself && <span>First hand: books bid themselves</span>}
          <span>Table Talk {room.talkSec ?? 20}s between hands · partners muted during bids &amp; play</span>
        </div>
      )}

      <LobbyChat cs={cs} onSend={(text) => conn.send({ t: 'chat', text })} />

      {onBackToGame && <button type="button" className="primary big" onClick={onBackToGame}>Back to the game</button>}
      {!playing && (isHost ? (
        <button type="button" className="primary big" data-testid="start" disabled={seatedHumans === 0} onClick={() => conn.send({ t: room.phase === 'over' ? 'rematch' : 'start' })}>
          {room.phase === 'over' ? 'Rematch' : n - seatedHumans > 0 ? `Start · ${n - seatedHumans} bot${n - seatedHumans > 1 ? 's' : ''} fill in` : 'Start game'}
        </button>
      ) : (
        <p className="waiting">Waiting for {room.members.find((m) => m.playerId === room.hostId)?.name ?? 'the host'} to start…</p>
      ))}
      {playing && cs.seat === null && <p className="waiting">Game in progress. Tap a bot's seat to take it over.</p>}
      {cs.error && Date.now() - cs.error.at < 4000 && <div className="err" role="alert">{cs.error.message}</div>}
      <button type="button" className="link" onClick={onLeave}>Leave table</button>
    </div>
  );
}

function SeatCard({ seat, info, spot, team, mine, isHost, playing, hostId, onSit, onBot, onRemoveBot, media }: {
  seat: number; info: SeatInfo; spot: string; team: string | null; mine: boolean; isHost: boolean; playing: boolean; hostId: string; you: string | null;
  onSit: () => void; onBot: () => void; onRemoveBot: () => void; media: React.ReactNode;
}) {
  const label = `Seat ${seat + 1}`;
  return (
    <div className={`seat-card spot-${spot} ${mine ? 'mine' : ''} ${team ? `team-${team}` : ''}`} data-testid={`lobby-seat-${seat}`}>
      <div className="seat-top">{label}{team && <span className="chip">TEAM {team}</span>}</div>
      {info.kind === 'empty' && (
        <>
          <button type="button" className="sit" onClick={onSit}>Sit here</button>
          {isHost && !playing && <button type="button" className="link" onClick={onBot}>+ Bot</button>}
        </>
      )}
      {info.kind === 'bot' && (
        <>
          <div className="seat-name">🤖 {info.name}</div>
          {isHost && !playing && <button type="button" className="link" onClick={onRemoveBot}>Remove</button>}
          {playing && <button type="button" className="sit" onClick={onSit}>Take over</button>}
        </>
      )}
      {info.kind === 'human' && (
        <>
          <div className="seat-name" style={{ color: mine ? '#f5c542' : colorFor(info.playerId) }}>
            {mine ? 'You' : info.name}{info.playerId === hostId && <span title="Host" aria-label="host">👑</span>}
          </div>
          {!info.connected && <span className="chip bad">OFFLINE</span>}
          {isHost && !playing && !info.connected && !mine && <button type="button" className="link" onClick={onBot}>Replace with bot</button>}
          {media}
        </>
      )}
    </div>
  );
}

function LobbyChat({ cs, onSend }: { cs: ConnState; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: 1e6 }); }, [cs.chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim().slice(0, 200));
    setText('');
  };
  return (
    <section className="panel lobby-chat" aria-label="Table chat">
      <div className="chat-list" ref={list}>
        {cs.chat.slice(-30).map((l) => (
          <div key={l.id} className={`chat-line ${l.system ? 'system' : ''}`}>
            {l.system ? <span>{l.text}</span> : <><b style={{ color: l.from === cs.you ? '#f5c542' : colorFor(l.from ?? '') }}>{l.from === cs.you ? 'You' : l.name}</b> <span>{l.text}</span></>}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="chat-input">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={200} aria-label="Chat message" />
        <button type="submit" aria-label="Send">➤</button>
      </form>
    </section>
  );
}
