import { SocialButton } from '../social/Social';
import { VENUE_DEFS, VENUE_LIST, type VenueChoice, type VenueId, venueLabel } from '../venues';
import { TeamNameField } from '../TeamName';
import type { NukeIntensity } from '@spades/protocol';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrumpLadder } from '../trumpLadder';
import { BOT_SKILL_SETTINGS, SKILL_SETTING_LABEL, TALK_INTENSITY_LABEL, type TalkIntensity, skillSettingOf } from '@spades/bots';
import { TALK_INTENSITIES, type BotLevel } from '@spades/protocol';
import { TALK_HINT } from '../MoreOptions';
import { LockedRulesPanel } from '../LockedRules';
import type { RoomInfo, SeatInfo } from '@spades/protocol';
import { type ModeKey, type Settings, MODES, modeTitle, rulesSummary, settingsToRules } from '../settings';
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
const MIC_MUTE_NOTE = 'Mutes partners to each other during trick play only (from the first card led). Partners can talk books while bidding and between hands';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const link = inviteLink(room.code);
  const r = room.rules;

  // which of the 4 diamond spots each seat sits in: me at the bottom when seated
  const me = cs.seat ?? 0;
  const spots = n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'];
  const spotOf = (seat: number) => spots[(seat - me + n) % n]!;

  const config = (s: Settings, timer: TimerKey = timerKey(room), botLevel = room.botLevel, talkSec = room.talkSec, afkLimit = room.afkLimit ?? 3, partnerMicMute = room.partnerMicMute ?? false, nukeIntensity: NukeIntensity = room.nukeIntensity ?? 'full', talkIntensity: TalkIntensity = room.talkIntensity ?? 'cookout') => {
    onSettings(s);
    // mid-game only the pace / social settings may change: the game rules go back exactly as they are
    const rules = playing ? { ...room.rules, turnTimerSec: { ...TIMERS[timer] } } : { ...settingsToRules(s), turnTimerSec: { ...TIMERS[timer] } };
    conn.send({ t: 'config', rules, botLevel, talkSec, afkLimit, partnerMicMute, nukeIntensity, talkIntensity });
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => config({ ...settings, [k]: v });

  const share = async () => {
    const text = `Pull up to my Spades table on Bid Wit Me 🃏 Code ${room.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Bid Wit Me', text, url: link }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  const team = (seat: number) => (r.partnerships ? (seat % 2 === 0 ? 'A' : 'B') : null);
  const seatedHumans = room.seats.filter((s) => s.kind === 'human').length;
  const wide = useWide();
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(cs.chat.length);
  useEffect(() => { if (chatOpen || wide) setSeen(cs.chat.length); }, [chatOpen, wide, cs.chat.length]);
  const unread = Math.max(0, cs.chat.filter((l) => !l.system).length - cs.chat.slice(0, seen).filter((l) => !l.system).length);
  const teams = r.partnerships ? (
          <div className="lobby-teams" data-testid="lobby-teams">
            {[0, 1].map((t) => (
              <TeamChip key={t} t={t} name={room.teamNames?.[t] ?? ''} editable={cs.seat !== null && cs.seat % 2 === t}
                onSave={(name) => conn.send({ t: 'teamName', name })} />
            ))}
          </div>
        ) : <p className="hint lobby-teams-note">No teams · every player for themselves</p>;
  const startBlock = <StartBlock teams={wide ? null : teams} room={room} cs={cs} conn={conn} isHost={isHost} playing={playing} seatedHumans={seatedHumans} n={n} onBackToGame={onBackToGame} onLeave={onLeave} />;

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
        <div className="lobby-share">
          <button type="button" className="room-code share-code" data-testid="room-code" aria-label={`Table code ${room.code}. Tap to share the invite link`} onClick={share}>
            <small>{copied ? 'LINK COPIED ✓' : 'TABLE CODE · TAP TO SHARE'}</small>
            <b>{room.code}</b>
          </button>
          <SocialButton className="lobby-social" />
        </div>
        {room.tournament && <TourBanner t={room.tournament} />}
        {cs.status !== 'open' && <p className="muted">{cs.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p>}
      </header>

      <section className="panel lobby-table">
        <div className={`mini-felt n${n}`}>
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
        {wide && teams}
        {wide && <MediaBar mesh={mesh} vs={vs} seated={cs.seat !== null} />}
        {room.series && room.series.games.length > 0 && <p className="hint" data-testid="lobby-series">Series {room.series.wins.join('–')} · {room.series.sides.map((s) => s.name).join(' vs ')}</p>}
      </section>

      {wide && startBlock}
      </div>
      <div className="lobby-settings">
      {/* the venue: its own panel so it's easy to find (the host picks, everyone sees the same spot) */}
      <section className="panel lobby-venue-panel" data-testid="lobby-venue-panel">
        <div className="panel-title">VENUE{isHost && !playing ? <small> (host)</small> : null}</div>
        {isHost && !playing ? (
          <div className="venue-pick">
            <select data-testid="lobby-venue" aria-label="Venue" value={room.venue ?? 'classic'} onChange={(e) => conn.send({ t: 'venue', venue: e.target.value as VenueChoice })}>
              {VENUE_LIST.map((v) => <option key={v.id} value={v.id}>{v.emoji} {v.name}{v.id === 'classic' ? ' (default)' : ''}</option>)}
              <option value="random">🎲 Random</option>
            </select>
            <small>{room.venue === 'random' ? 'Rolled when the game starts · everyone sees the same spot' : `${VENUE_DEFS[(room.venue ?? 'classic') as VenueId].blurb} Everyone sees it.`}</small>
          </div>
        ) : (
          <p className="venue-pick" data-testid="venue-guest">{venueLabel(room.venueNow ?? room.venue ?? 'classic')}<small>{room.venue === 'random' && !room.venueNow ? 'Rolled when the game starts' : VENUE_DEFS[(room.venueNow ?? room.venue ?? 'classic') as VenueId].blurb}</small></p>
        )}
      </section>
      {isHost && !playing ? (
        <details className="panel settings-panel" open={settingsOpen} onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="panel-title settings-row" data-testid="settings-row"><span className="sr-mode">{modeTitle(r)} · to {r.targetScore}</span><span className="sr-edit">{settingsOpen ? 'Done' : 'Edit'}</span></summary>
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
                {(['joker54', 'standard52'] as const).map((d) => {
                  const label = d === 'joker54' ? 'Joker' : 'Standard 52';
                  return (
                    <button key={d} type="button" role="radio" aria-label={label} aria-checked={settings.cutthroatDeck === d} className={settings.cutthroatDeck === d ? 'on' : ''} onClick={() => set('cutthroatDeck', d)}>
                      {label}
                    </button>
                  );
                })}
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
          <label className="row"><span className="row-label">Bot skill<small>Mixed: every bot rolls its own (hidden)</small></span><span className="row-control">
            <select data-testid="lobby-bot-skill" value={skillSettingOf(room.botLevel)} onChange={(e) => config(settings, timerKey(room), e.target.value as BotLevel)}>
              {BOT_SKILL_SETTINGS.map((k) => <option key={k} value={k}>{SKILL_SETTING_LABEL[k]}</option>)}
            </select></span></label>
          <label className="row"><span className="row-label">Trash talk<small>{TALK_HINT[room.talkIntensity ?? 'cookout']}</small></span><span className="row-control">
            <select data-testid="lobby-talk-intensity" value={room.talkIntensity ?? 'cookout'} onChange={(e) => config(settings, timerKey(room), room.botLevel, room.talkSec, room.afkLimit ?? 3, room.partnerMicMute ?? false, room.nukeIntensity ?? 'full', e.target.value as TalkIntensity)}>
              {TALK_INTENSITIES.map((k) => <option key={k} value={k}>{TALK_INTENSITY_LABEL[k]}{k === 'cookout' ? ' (default)' : ''}</option>)}
            </select></span></label>
          <label className="row"><span className="row-label">Shot = out<small>shot on hand 1, or twice in a row, loses</small></span><span className="row-control">
            <button type="button" data-testid="lobby-shot-out" className={`toggle ${settings.shotOut !== false ? 'on' : ''}`} role="switch" aria-checked={settings.shotOut !== false} aria-label="Shot = out" onClick={() => set('shotOut', settings.shotOut === false)}><span /></button>
          </span></label>
          {!settings.mode.startsWith('cutthroat') && (
            <label className="row"><span className="row-label">Minimum books / bid<small>Every hand. Hand 1: fewer books is a shot. Later: bids must reach it.</small></span><span className="row-control">
              <select data-testid="lobby-first-hand-min" value={String(settings.firstHandMin)} onChange={(e) => set('firstHandMin', (e.target.value === 'default' || e.target.value === 'off' ? e.target.value : Number(e.target.value)) as Settings['firstHandMin'])}>
                <option value="default">Default (4)</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="off">Off</option>
              </select></span></label>
          )}
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
          <label className="row"><span className="row-label">Private table<small>hidden from Open tables · invite or code only</small></span><span className="row-control">
            <button type="button" data-testid="private-toggle" className={`toggle ${room.private ? 'on' : ''}`} role="switch" aria-checked={!!room.private} aria-label="Private table" onClick={() => conn.send({ t: 'tableOpts', private: !room.private })}><span /></button>
          </span></label>
          <label className="row"><span className="row-label">Spectators can replace bots<small>a watcher may take a bot's seat mid-game. Off by default in a rated game. A seat someone left stays open.</small></span><span className="row-control">
            <button type="button" data-testid="replace-bots-toggle" className={`toggle ${room.replaceBots !== false ? 'on' : ''}`} role="switch" aria-checked={room.replaceBots !== false} aria-label="Spectators can replace bots" onClick={() => conn.send({ t: 'tableOpts', replaceBots: room.replaceBots === false })}><span /></button>
          </span></label>
          <label className="row"><span className="row-label">Bot trash talk<small>bots talk smack in chat (players can hide or mute it)</small></span><span className="row-control">
            <button type="button" data-testid="bot-talk-toggle" className={`toggle ${room.botTalk !== false ? 'on' : ''}`} role="switch" aria-checked={room.botTalk !== false} aria-label="Bot trash talk" onClick={() => conn.send({ t: 'config', rules: room.rules, botLevel: room.botLevel, talkSec: room.talkSec, afkLimit: room.afkLimit ?? 3, partnerMicMute: room.partnerMicMute ?? false, nukeIntensity: room.nukeIntensity ?? 'full', talkIntensity: room.talkIntensity ?? 'cookout', botTalk: room.botTalk === false })}><span /></button>
          </span></label>
          {r.deck === 'joker54' && (
            <label className="row"><span className="row-label">Nuke intensity<small>Big Joker over Little Joker, for everyone at the table</small></span><span className="row-control">
              <select data-testid="nuke-intensity" value={room.nukeIntensity ?? 'full'} onChange={(e) => config(settings, timerKey(room), room.botLevel, room.talkSec, room.afkLimit ?? 3, room.partnerMicMute ?? false, e.target.value as NukeIntensity)}>
                <option value="full">Full Nuke (default)</option><option value="classic">Classic</option><option value="off">Off (banner + boom)</option>
              </select></span></label>
          )}
          {settings.mode.startsWith('cutthroat') ? (
            <label className="row"><span className="row-label">Minimum books / bid<small>Every hand. Hand 1: fewer books is a shot. Nil is off.</small></span><span className="row-control">
              <select data-testid="lobby-min-bid" value={String(settings.cutMinBid ?? 1)} onChange={(e) => set('cutMinBid', Number(e.target.value) as Settings['cutMinBid'])}>
                {[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x}{x === 1 ? ' (default)' : ''}</option>)}
              </select></span></label>
          ) : (
          <label className="row"><span className="row-label">Blind Nil</span><span className="row-control">
            <select value={settings.blindNil} onChange={(e) => set('blindNil', e.target.value as Settings['blindNil'])}>
              <option value="behind100">When behind by 100+</option><option value="always">Always</option><option value="off">Off</option>
            </select></span></label>
          )}
          <label className="row"><span className="row-label">Bags and penalties<small>off: books over your bid score nothing</small></span><span className="row-control">
            <button type="button" data-testid="lobby-bags" className={`toggle ${settings.bagsOn !== false ? 'on' : ''}`} role="switch" aria-checked={settings.bagsOn !== false} aria-label="Bags and penalties" onClick={() => set('bagsOn', settings.bagsOn === false)}><span /></button>
          </span></label>
          <p className="rules-summary" data-testid="lobby-rules-summary">{rulesSummary(settingsToRules(settings))}</p>
          <label className="row"><span className="row-label">First hand: books bid themselves<small>No bidding in hand 1 · 10 points per book</small></span><span className="row-control">
            <button type="button" data-testid="books-toggle" className={`toggle ${settings.firstHandBidsItself !== false ? 'on' : ''}`} role="switch" aria-checked={settings.firstHandBidsItself !== false} aria-label="First hand: books bid themselves" onClick={() => set('firstHandBidsItself', settings.firstHandBidsItself === false)}><span /></button>
          </span></label>
          <p className="hint">Other house rules (bags, minimum bid, 10 for 200…) come from the House rules on the main menu.</p>
        </details>
      ) : playing ? (
        <>
          <LockedRules room={room} />
          {isHost && (
            <details className="panel settings-panel" open={settingsOpen} onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="pace-settings">
              <summary className="panel-title">PACE &amp; TABLE <small>(host · still changeable)</small></summary>
              <label className="row"><span className="row-label">Turn timer<small>then the bot plays for you</small></span><span className="row-control">
                <select value={timerKey(room)} onChange={(e) => config(settings, e.target.value as TimerKey)}>
                  <option value="relaxed">Relaxed (45s / 30s)</option><option value="normal">Normal (30s / 20s)</option><option value="fast">Fast (15s / 10s)</option>
                </select></span></label>
              <label className="row"><span className="row-label">Table Talk<small>between hands · all mics open</small></span><span className="row-control">
                <select data-testid="talk-sec" value={String(room.talkSec ?? 20)} onChange={(e) => config(settings, timerKey(room), room.botLevel, Number(e.target.value))}>
                  {[15, 20, 30, 45].map((x) => <option key={x} value={x}>{x}s{x === 20 ? ' (default)' : ''}</option>)}
                </select></span></label>
              <label className="row"><span className="row-label">AFK kick<small>timeouts in a row before a bot takes over</small></span><span className="row-control">
                <select data-testid="afk-limit" value={String(room.afkLimit ?? 3)} onChange={(e) => config(settings, timerKey(room), room.botLevel, room.talkSec, Number(e.target.value))}>
                  {[2, 3, 5, 0].map((x) => <option key={x} value={x}>{x === 0 ? 'Off' : `${x} in a row${x === 3 ? ' (default)' : ''}`}</option>)}
                </select></span></label>
              <label className="row"><span className="row-label">Bot trash talk<small>bots talk smack in chat (players can hide or mute it)</small></span><span className="row-control">
                <button type="button" data-testid="bot-talk-toggle" className={`toggle ${room.botTalk !== false ? 'on' : ''}`} role="switch" aria-checked={room.botTalk !== false} aria-label="Bot trash talk" onClick={() => conn.send({ t: 'config', rules: room.rules, botLevel: room.botLevel, talkSec: room.talkSec, afkLimit: room.afkLimit ?? 3, partnerMicMute: room.partnerMicMute ?? false, nukeIntensity: room.nukeIntensity ?? 'full', talkIntensity: room.talkIntensity ?? 'cookout', botTalk: room.botTalk === false })}><span /></button>
              </span></label>
            </details>
          )}
        </>
      ) : (
        <div className="summary">
          <span>{modeTitle(r)} · Trumps: <TrumpLadder rules={r} n={5} style="emoji" /> …</span>
          <span>Target {r.targetScore} · timer {r.turnTimerSec.bid}s/{r.turnTimerSec.play}s</span>
          {r.firstHandBidsItself && <span>First hand: books bid themselves</span>}
          <span>Table Talk {room.talkSec ?? 20}s between hands · all mics open</span>
          {r.partnerships && (
            <span className="row mic-mute-row" data-testid="mic-mute-summary">
              <span className="row-label">Partner mic mute: {room.partnerMicMute ? 'On' : 'Off'}<small>{MIC_MUTE_NOTE}</small></span>
              <span className="row-control"><button type="button" className={`toggle ${room.partnerMicMute ? 'on' : ''}`} role="switch" aria-checked={!!room.partnerMicMute} aria-label="Partner mic mute (set by the host)" disabled><span /></button></span>
            </span>
          )}
          <span data-testid="venue-summary">Venue: {venueLabel(room.venueNow ?? room.venue ?? 'classic')}</span>
          <span data-testid="bot-talk-summary">Bot trash talk: {room.botTalk !== false ? 'On' : 'Off'}</span>
          {r.deck === 'joker54' && <span data-testid="nuke-summary">Nuke: {NUKE_LABEL[room.nukeIntensity ?? 'full']}</span>}
          <span>{room.afkLimit === 0 ? 'AFK kick off' : `A bot takes over after ${room.afkLimit ?? 3} timeouts in a row`}</span>
        </div>
      )}

      </div>
      <LobbyChat cs={cs} onSend={(text) => conn.send({ t: 'chat', text })} open={chatOpen} setOpen={setChatOpen} wide={wide} />
      {!wide && createPortal(
        <div className={`lobby-dock ${chatOpen ? 'chat-open' : ''}`} data-testid="lobby-dock">
          {startBlock}
          <div className="dock-bar">
            {cs.seat !== null ? <MediaBar mesh={mesh} vs={vs} seated /> : <span className="dock-spacer" />}
            <button type="button" className={`av-btn dock-chat ${chatOpen ? 'on' : ''}`} data-testid="lobby-chat-tab" aria-expanded={chatOpen} aria-label="Table chat" onClick={() => setChatOpen(!chatOpen)}>
              💬<small>CHAT</small>{unread > 0 && !chatOpen && <span className="unread" data-testid="lobby-unread">{unread}</span>}
            </button>
          </div>
        </div>, document.body)}
      </div>
    </div>
  );
}

/** Mid-game: the game's rules, read-only (the server rejects changes until a rematch / new game). */
function LockedRules({ room }: { room: RoomInfo }) {
  return <LockedRulesPanel rules={room.rules} nuke={room.nukeIntensity ?? 'full'} skill={room.botLevel} intensity={room.talkIntensity ?? 'cookout'} micMute={room.partnerMicMute ?? false} online />;
}

function StartBlock({ teams, room, cs, conn, isHost, playing, seatedHumans, n, onBackToGame, onLeave }: {
  teams: React.ReactNode; room: RoomInfo; cs: ConnState; conn: TableConnection; isHost: boolean; playing: boolean; seatedHumans: number; n: number;
  onBackToGame: (() => void) | null; onLeave: () => void;
}) {
  const filled = room.seats.filter((s) => s.kind !== 'empty').length;
  const open = n - filled;
  const hostName = room.members.find((m) => m.playerId === room.hostId)?.name ?? 'host';
  const status = playing ? 'Game in progress'
    : `${filled} of ${n} seated${open > 0 ? ` · waiting on ${open}` : ' · ready'}${open > 0 ? (isHost ? ` · Start fills with bot${open > 1 ? 's' : ''}` : '') : ''}`;
  return (
    <div className="lobby-start" data-testid="lobby-start">
      {teams}
      {!playing && <p className="lobby-status" data-testid="lobby-status" aria-live="polite"><span className="live-dot" /><span key={status} className="status-text">{status}</span></p>}
      {onBackToGame && <button type="button" className="primary big" onClick={onBackToGame}>Back to the game</button>}
      {!playing && (isHost ? (
        <button type="button" className="primary big" data-testid="start" disabled={seatedHumans === 0} onClick={() => conn.send({ t: room.phase === 'over' ? 'rematch' : 'start' })}>
          {room.phase === 'over' ? 'Rematch' : open > 0 ? `Start · ${open} bot${open > 1 ? 's' : ''} fill in` : 'Start game'}
        </button>
      ) : (
        <p className="waiting">Waiting for host{hostName !== 'host' ? ` (${hostName})` : ''}…</p>
      ))}
      {playing && cs.seat === null && <p className="waiting">Game in progress. Tap a bot's seat to take it over.</p>}
      {cs.error && Date.now() - cs.error.at < 4000 && <div className="err" role="alert">{cs.error.message}</div>}
      <button type="button" className="link quiet" data-testid="leave-table" onClick={onLeave}>Leave table</button>
    </div>
  );
}

function TeamChip({ t, name, editable, onSave }: { t: number; name: string; editable: boolean; onSave: (n: string) => void }) {
  const [edit, setEdit] = useState(false);
  const label = name || (t === 0 ? 'Team A' : 'Team B');
  return (
    <span className={`team-pill team-${t === 0 ? 'A' : 'B'} ${edit ? 'editing' : ''}`} data-testid={`team-chip-${t}`}>
      {edit ? (
        <span onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setEdit(false); }}>
          <TeamNameField value={name} placeholder="Team name" onSave={(v) => { onSave(v); setEdit(false); }} testId="lobby-team-name" />
        </span>
      ) : (
        <>
          <b>{label}</b> seats {t === 0 ? '1 & 3' : '2 & 4'}
          {editable && <button type="button" className="pencil" aria-label="Edit your team name" data-testid="team-name-edit" onClick={() => setEdit(true)}>✎</button>}
        </>
      )}
    </span>
  );
}

function SeatCard({ seat, info, spot, team, mine, isHost, playing, hostId, onSit, onBot, onRemoveBot, media }: {
  seat: number; info: SeatInfo; spot: string; team: string | null; mine: boolean; isHost: boolean; playing: boolean; hostId: string; you: string | null;
  onSit: () => void; onBot: () => void; onRemoveBot: () => void; media: React.ReactNode;
}) {
  const label = `Seat ${seat + 1}`;
  const cls = `seat-card spot-${spot} ${mine ? 'mine' : ''} ${team ? `team-${team}` : 'no-team'} ${info.kind === 'empty' ? 'open' : 'taken'}`;
  const top = <div className="seat-top">{mine ? <span className="you-tag">YOU</span> : label}{team && <span className="chip">{team}</span>}</div>;
  if (info.kind === 'empty') {
    return (
      <div className={cls} data-testid={`lobby-seat-${seat}`}>
        <button type="button" className="seat-hit" aria-label="Sit here" onClick={onSit}>
          {top}<span className="seat-plus" aria-hidden>+</span><span className="seat-cta">Sit here</span>
        </button>
        {isHost && !playing && <button type="button" className="seat-bot" aria-label={`Add a bot to ${label}`} onClick={onBot}>+Bot</button>}
      </div>
    );
  }
  const name = info.kind === 'bot' ? info.name : info.name;
  const initial = info.kind === 'bot' ? '🤖' : name.trim().charAt(0).toUpperCase() || '?';
  const ready = info.kind === 'bot' || info.connected;
  return (
    <div className={cls} data-testid={`lobby-seat-${seat}`}>
      {top}
      <div className="seat-avatar" style={info.kind === 'human' && !mine ? { ['--av' as string]: colorFor(info.playerId) } : undefined}>
        <span className="av-initial">{initial}</span>
        {info.kind === 'human' && media}
        {ready && <span className="ready-check" title="Ready" aria-label="ready">✓</span>}
      </div>
      <div className="seat-name">
        {name}{info.kind === 'human' && info.playerId === hostId && <span title="Host" aria-label="host">👑</span>}
      </div>
      {info.kind === 'human' && !info.connected && <span className="chip bad">OFFLINE</span>}
      {info.kind === 'bot' && isHost && !playing && <button type="button" className="link seat-sub" onClick={onRemoveBot}>Remove</button>}
      {info.kind === 'bot' && playing && <button type="button" className="sit seat-sub" onClick={onSit}>Take over</button>}
      {info.kind === 'human' && isHost && !playing && !info.connected && !mine && <button type="button" className="link seat-sub" onClick={onBot}>Replace with bot</button>}
    </div>
  );
}

/**
 * Lobby chat. Wide screens: a full-height column, always visible, input pinned to the bottom.
 * Phones: a sticky bottom tab (with unread badge) that opens a drawer — always one tap away.
 */
function LobbyChat({ cs, onSend, open, setOpen, wide }: { cs: ConnState; onSend: (t: string) => void; open: boolean; setOpen: (v: boolean) => void; wide: boolean }) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: 1e6 }); }, [cs.chat.length, open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim().slice(0, 200));
    setText('');
  };
  const ui = (
    <>
    <section className={`panel lobby-chat ${wide ? 'wide' : open ? 'drawer open' : 'drawer'}`} aria-label="Table chat" data-testid="lobby-chat">
      <header className="lc-head"><span className="live-dot" /> TABLE CHAT{!wide && <button type="button" className="lc-close" aria-label="Close chat" onClick={() => setOpen(false)}>✕</button>}</header>
      <div className="chat-list" ref={list}>
        {cs.chat.slice(-100).map((l) => (
          <div key={l.id} className={`chat-line ${l.system ? 'system' : ''}`}>
            {l.system ? <span>{l.text}</span> : <><b style={{ color: l.from === cs.you && !cs.spectator ? '#f5c542' : colorFor(l.from ?? '') }}>{l.from === cs.you && !cs.spectator ? 'You' : l.name}</b> <span>{l.text}</span></>}
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

/** Release 9b: a tournament match table: seats are reserved, the match starts on its own */
function TourBanner({ t }: { t: NonNullable<import('@spades/protocol').RoomInfo['tournament']> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(i); }, []);
  const left = t.autostartAt ? Math.max(0, Math.ceil((t.autostartAt - now) / 1000)) : null;
  return (
    <p className="tour-banner" data-testid="tour-banner">
      🏆 <b>{t.name ?? 'Tournament'}</b> match · seats reserved for {t.reserved.filter(Boolean).join(', ') || 'the entrants'}
      {left !== null ? ` · starts in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} (or when everyone is in)` : ''}
    </p>
  );
}
