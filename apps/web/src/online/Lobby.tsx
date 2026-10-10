import { TeamNameField } from '../TeamName';
import type { NukeIntensity } from '@spades/protocol';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardLabel, trumpOrder } from '@spades/rules';
import type { RoomInfo, SeatInfo } from '@spades/protocol';
import { type ModeKey, type Settings, MODES, modeTitle, settingsToRules } from '../settings';
import type { ConnState, TableConnection } from './connection';
import { inviteLink } from './config';
import { navigate } from './nav';
import { MediaBar, SeatMedia } from './Media';
import { colorFor, useVideo } from './useOnline';
import type { VideoMesh } from './video';

const TIMERS = { relaxed: { bid: 45, play: 30 }, normal: { bid: 30, play: 20 }, fast: { bid: 15, play: 10 } } as const;
type TimerKey = keyof typeof TIMERS;

function timerKey(room: RoomInfo): TimerKey {
  const t = room.rules.turnTimerSec;
  return (Object.keys(TIMERS) as TimerKey[]).find((k) => TIMERS[k].bid === t.bid && TIMERS[k].play === t.play) ?? 'normal';
}

const NUKE_LABEL: Record<NukeIntensity, string> = { full: 'Full Nuke', classic: 'Classic', off: 'Off' };
const MIC_MUTE_NOTE = 'Mutes partners to each other during bidding and play; everyone can talk between hands';

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
  const [settingsOpen, setSettingsOpen] = useState(() => window.innerWidth >= 1024);
  const link = inviteLink(room.code);
  const r = room.rules;

  // which of the 4 diamond spots each seat sits in: me at the bottom when seated
  const me = cs.seat ?? 0;
  const spots = n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'];
  const spotOf = (seat: number) => spots[(seat - me + n) % n]!;

  const config = (s: Settings, timer: TimerKey = timerKey(room), botLevel = room.botLevel, talkSec = room.talkSec, afkLimit = room.afkLimit ?? 3, partnerMicMute = room.partnerMicMute ?? false, nukeIntensity: NukeIntensity = room.nukeIntensity ?? 'full') => {
    onSettings(s);
    const rules = { ...settingsToRules(s), turnTimerSec: { ...TIMERS[timer] } };
    conn.send({ t: 'config', rules, botLevel, talkSec, afkLimit, partnerMicMute, nukeIntensity });
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
  const startBlock = <StartBlock room={room} cs={cs} conn={conn} isHost={isHost} playing={playing} seatedHumans={seatedHumans} n={n} onBackToGame={onBackToGame} onLeave={onLeave} />;

  return (
    <div className="setup lobby lobby-v3" data-testid="lobby">
      {/* Home keeps your seat (the splash offers "Rejoin table"); "Leave table" gives it up */}
      <button type="button" className="icon-btn lobby-home" data-testid="lobby-home" aria-label="Home" title="Home (keeps your seat)" onClick={() => navigate('/', true, { wiz: 'home', d: 0 })}>
        ← <img src="/assets/bwm-wordmark-white.svg" alt="" />
      </button>
      <div className="lobby-cols">
      <div className="lobby-main">
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
        {r.partnerships && <p className="hint">{room.teamNames?.[0] || 'Team A'}: seats 1 &amp; 3 · {room.teamNames?.[1] || 'Team B'}: seats 2 &amp; 4. Tap a seat to sit.</p>}
        {r.partnerships && cs.seat !== null && (
          <div className="lobby-team-name">
            <small>YOUR TEAM NAME ({cs.seat % 2 === 0 ? 'A' : 'B'})</small>
            <TeamNameField value={room.teamNames?.[cs.seat % 2] ?? ''} placeholder="You & your partner" onSave={(name) => conn.send({ t: 'teamName', name })} testId="lobby-team-name" />
          </div>
        )}
        {room.series && room.series.games.length > 0 && <p className="hint" data-testid="lobby-series">Series {room.series.wins.join('–')} · {room.series.sides.map((s) => s.name).join(' vs ')}</p>}
        <MediaBar mesh={mesh} vs={vs} seated={cs.seat !== null} />
        {cs.seat !== null && !vs.cam && <p className="hint">Video is optional: tap 📷 to turn your camera on. It goes straight to the other players, never through our server.</p>}
      </section>

      {startBlock}
      </div>
      <div className="lobby-settings">
      {isHost && !playing ? (
        <details className="panel settings-panel" open={settingsOpen} onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="panel-title">TABLE SETTINGS <small>(host)</small></summary>
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
          <label className="row"><span className="row-label">AFK kick<small>timeouts in a row before a bot takes over</small></span><span className="row-control">
            <select data-testid="afk-limit" value={String(room.afkLimit ?? 3)} onChange={(e) => config(settings, timerKey(room), room.botLevel, room.talkSec, Number(e.target.value))}>
              {[2, 3, 5, 0].map((x) => <option key={x} value={x}>{x === 0 ? 'Off' : `${x} in a row${x === 3 ? ' (default)' : ''}`}</option>)}
            </select></span></label>
          {!settings.mode.startsWith('cutthroat') && (
            <label className="row"><span className="row-label">Partner mic mute<small>{MIC_MUTE_NOTE}</small></span><span className="row-control">
              <button type="button" data-testid="mic-mute-toggle" className={`toggle ${room.partnerMicMute ? 'on' : ''}`} role="switch" aria-checked={!!room.partnerMicMute} aria-label="Partner mic mute" onClick={() => config(settings, timerKey(room), room.botLevel, room.talkSec, room.afkLimit ?? 3, !room.partnerMicMute)}><span /></button>
            </span></label>
          )}
          <label className="row"><span className="row-label">Bot trash talk<small>bots talk smack in chat (players can hide or mute it)</small></span><span className="row-control">
            <button type="button" data-testid="bot-talk-toggle" className={`toggle ${room.botTalk !== false ? 'on' : ''}`} role="switch" aria-checked={room.botTalk !== false} aria-label="Bot trash talk" onClick={() => conn.send({ t: 'config', rules: room.rules, botLevel: room.botLevel, talkSec: room.talkSec, afkLimit: room.afkLimit ?? 3, partnerMicMute: room.partnerMicMute ?? false, nukeIntensity: room.nukeIntensity ?? 'full', botTalk: room.botTalk === false })}><span /></button>
          </span></label>
          {r.deck === 'joker54' && (
            <label className="row"><span className="row-label">Nuke intensity<small>Big Joker over Little Joker, for everyone at the table</small></span><span className="row-control">
              <select data-testid="nuke-intensity" value={room.nukeIntensity ?? 'full'} onChange={(e) => config(settings, timerKey(room), room.botLevel, room.talkSec, room.afkLimit ?? 3, room.partnerMicMute ?? false, e.target.value as NukeIntensity)}>
                <option value="full">Full Nuke (default)</option><option value="classic">Classic</option><option value="off">Off (banner + boom)</option>
              </select></span></label>
          )}
          <label className="row"><span className="row-label">Blind Nil</span><span className="row-control">
            <select value={settings.blindNil} onChange={(e) => set('blindNil', e.target.value as Settings['blindNil'])}>
              <option value="behind100">When behind by 100+</option><option value="always">Always</option><option value="off">Off</option>
            </select></span></label>
          <label className="row"><span className="row-label">First hand: books bid themselves<small>No bidding in hand 1 · 10 points per book</small></span><span className="row-control">
            <button type="button" data-testid="books-toggle" className={`toggle ${settings.firstHandBidsItself !== false ? 'on' : ''}`} role="switch" aria-checked={settings.firstHandBidsItself !== false} aria-label="First hand: books bid themselves" onClick={() => set('firstHandBidsItself', settings.firstHandBidsItself === false)}><span /></button>
          </span></label>
          <p className="hint">Other house rules (bags, minimum bid, 10 for 200…) come from the House rules on the main menu.</p>
        </details>
      ) : (
        <div className="summary">
          <span>{modeTitle(r)} · Trumps: {order.join(' › ')} …</span>
          <span>Target {r.targetScore} · timer {r.turnTimerSec.bid}s/{r.turnTimerSec.play}s</span>
          {r.firstHandBidsItself && <span>First hand: books bid themselves</span>}
          <span>Table Talk {room.talkSec ?? 20}s between hands · all mics open</span>
          {r.partnerships && (
            <span className="row mic-mute-row" data-testid="mic-mute-summary">
              <span className="row-label">Partner mic mute: {room.partnerMicMute ? 'On' : 'Off'}<small>{MIC_MUTE_NOTE}</small></span>
              <span className="row-control"><button type="button" className={`toggle ${room.partnerMicMute ? 'on' : ''}`} role="switch" aria-checked={!!room.partnerMicMute} aria-label="Partner mic mute (set by the host)" disabled><span /></button></span>
            </span>
          )}
          <span data-testid="bot-talk-summary">Bot trash talk: {room.botTalk !== false ? 'On' : 'Off'}</span>
          {r.deck === 'joker54' && <span data-testid="nuke-summary">Nuke: {NUKE_LABEL[room.nukeIntensity ?? 'full']}</span>}
          <span>{room.afkLimit === 0 ? 'AFK kick off' : `A bot takes over after ${room.afkLimit ?? 3} timeouts in a row`}</span>
        </div>
      )}

      </div>
      <LobbyChat cs={cs} onSend={(text) => conn.send({ t: 'chat', text })} />
      </div>
    </div>
  );
}

function StartBlock({ room, cs, conn, isHost, playing, seatedHumans, n, onBackToGame, onLeave }: {
  room: RoomInfo; cs: ConnState; conn: TableConnection; isHost: boolean; playing: boolean; seatedHumans: number; n: number;
  onBackToGame: (() => void) | null; onLeave: () => void;
}) {
  return (
    <div className="lobby-start">
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
      <button type="button" className="link" data-testid="leave-table" onClick={onLeave}>Leave table</button>
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

/**
 * Lobby chat. Wide screens: a full-height column, always visible, input pinned to the bottom.
 * Phones: a sticky bottom tab (with unread badge) that opens a drawer — always one tap away.
 */
function LobbyChat({ cs, onSend }: { cs: ConnState; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(cs.chat.length);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: 1e6 }); }, [cs.chat.length, open]);
  const wide = useWide();
  useEffect(() => { if (open || wide) setSeen(cs.chat.length); }, [open, wide, cs.chat.length]);
  const unread = Math.max(0, cs.chat.filter((l) => !l.system).length - cs.chat.slice(0, seen).filter((l) => !l.system).length);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim().slice(0, 200));
    setText('');
  };
  const ui = (
    <>
    {!wide && (
      <button type="button" className={`lobby-chat-tab ${open ? 'open' : ''}`} data-testid="lobby-chat-tab" aria-expanded={open} onClick={() => setOpen(!open)}>
        💬 Chat{unread > 0 && !open && <span className="unread" data-testid="lobby-unread">{unread}</span>}<span className="tab-caret">{open ? '▾' : '▴'}</span>
      </button>
    )}
    <section className={`panel lobby-chat ${wide ? 'wide' : open ? 'drawer open' : 'drawer'}`} aria-label="Table chat" data-testid="lobby-chat">
      <header className="lc-head"><span className="live-dot" /> TABLE CHAT</header>
      <div className="chat-list" ref={list}>
        {cs.chat.slice(-100).map((l) => (
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
    </>
  );
  // phones: the tab + drawer are fixed to the viewport — portal them out of the (animated, scrolling) lobby so no
  // transformed ancestor can re-anchor or cover them
  return wide ? ui : createPortal(<div className="lobby-chat-portal">{ui}</div>, document.body);
}

function useWide(): boolean {
  const q = '(min-width: 1024px) and (min-height: 600px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const on = () => setWide(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  return wide;
}
