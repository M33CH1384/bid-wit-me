/**
 * Story co-op room (spec §2): the shared table for a pair run. The room —
 * not either client — owns the run's phases: lobby → tape → scene → game →
 * outro, advancing only when BOTH partners have readied. The match itself
 * is the ordinary online table (OnlineTable) on the room's authoritative
 * engine; the outro posts the result once, against the room's witnessed
 * gameId, on the pair track.
 *
 * Dee is not seated here — in co-op she guides (Phase 3) and covers a
 * vacated seat through the room's reclaim machinery, which the seats list
 * shows like any other cover ("Dee, covering for …").
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  STORY_CHARACTERS, STORY_SECRETS, STORY_STOPS, awarenessCaseFor, awarenessFactsFor, beatsFor,
  coopRundownFor, guideOutroLine, kingProposalBeats, railCastForAttempt, storyStopById,
  type PairContextFacts, type StoryBeatFacts, type StoryStop,
} from '@spades/bots';
import type { ChatLine, ClientMsg, SeatInfo } from '@spades/protocol';
import { TableConnection, type ConnState } from '../online/connection';
import { useConn } from '../online/useOnline';
import OnlineTable from '../online/OnlineTable';
import { useAccount } from '../account/api';
import { AvatarCircle, useAvatar } from '../avatar';
import { loadName } from '../online/identity';
import { usePresence } from '../social/Social';
import { social } from '../social/store';
import { sound } from '../audio';
import StoryTape from './StoryTape';
import StoryFace from './StoryFace';
import { SceneAudio } from './SceneAudio';
import ScriptPlayer, { type SceneEgg } from './ScriptPlayer';
import { storyBackdropUrl } from './storyBackdrop';
import {
  fetchPairContext, fetchStoryProgress, postStoryFound, postStoryResult, reportStorySession,
  routeFactsFor, trueNextStop,
  type PairContext, type StoryProgress, type StoryResult,
} from './storyApi';
import { coopPairNote } from './pairNote';

/**
 * Dee's guide plate (spec §5.5): pinned to the rail edge of the table —
 * her face, the "Dee · guide" nameplate, and a present state that lifts
 * while she's speaking (her latest guide line rides under the plate).
 * She has no cards, no bid chip, no score — visibly not a seat. While
 * she covers a dropped partner's seat the plate dims and says so; her
 * guide voice is quiet then (the room enforces it), her seat plate at
 * the table carries her name instead.
 */
export function GuidePlate({ chat, seats }: { chat: ChatLine[]; seats: SeatInfo[] }) {
  const covering = seats.find((s) => s.kind === 'bot' && s.name === 'Dee' && !!s.was);
  const coveringWas = covering?.kind === 'bot' ? covering.was : undefined;
  const lastGuide = [...chat].reverse().find((l) => l.from === 'guide:dee');
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!lastGuide) return;
    setSpeaking(true);
    const t = setTimeout(() => setSpeaking(false), 4500);
    return () => clearTimeout(t);
  }, [lastGuide?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`guide-plate${speaking && !covering ? ' speaking' : ''}${covering ? ' covering' : ''}`} data-testid="guide-plate">
      <StoryFace characterId="dee" name="Dee" className="tape-face" />
      <div className="guide-plate-body">
        <p className="guide-plate-name">Dee · guide</p>
        <p className="guide-plate-line">
          {coveringWas ? `Covering for ${coveringWas}` : speaking && lastGuide ? lastGuide.text : 'Riding along'}
        </p>
      </div>
    </div>
  );
}

/**
 * One seat's face in the lobby table (redesign, owner 2026-10-24 —
 * "This screen needs work"): a human seat shows the player's real
 * uploaded picture (the Lobby's own avatar path), the stop's pair show
 * their cast portraits, a seat Dee is covering shows Dee, and the
 * partner's unfilled seat stays a dashed gold open medallion — the
 * gate's open-seat language — until they arrive.
 */
function RoomSeatFace({ seat, stop, index }: { seat: SeatInfo; stop: StoryStop; index: number }) {
  const pic = useAvatar(seat.kind === 'human' ? seat.uid : undefined);
  if (seat.kind === 'human') {
    return <AvatarCircle pic={pic} name={seat.name} className="story-room-av" />;
  }
  if (seat.kind === 'bot') {
    const id = seat.was || seat.name === 'Dee'
      ? 'dee'
      : (Object.entries(STORY_CHARACTERS).find(([, c]) => c?.name === seat.name)?.[0]
        ?? stop.pair[index === 1 ? 0 : 1]
        ?? 'dee');
    return <StoryFace characterId={id} name={seat.name} className="room-face" />;
  }
  return index === 2
    ? <span className="story-room-seat-open" aria-hidden>+</span>
    : <span className="story-room-seat-none" aria-hidden>—</span>;
}

const UNPOSTED_KEY = 'bwm.storyCoopUnposted';

interface Unposted { code: string; track: string; stopId: string; gameId: string }

function readUnposted(): Unposted | null {
  try {
    const raw = localStorage.getItem(UNPOSTED_KEY);
    return raw ? (JSON.parse(raw) as Unposted) : null;
  } catch { return null; }
}

export default function StoryRoom({ code, track, onExit }: {
  code: string;
  track: string | null;
  onExit: () => void;
}) {
  // Friend presence: inside a story room, friends see Story mode · Co-op
  // (the presence build's story-coop state, spec §2.3). usePresence's own
  // cleanup would drop the story flag entirely on exit, so a later cleanup
  // restores StoryHome's standing solo report — a room always exits back
  // to StoryHome's map surfaces.
  usePresence({ kind: 'table', story: 'coop' });
  useEffect(() => () => { social.setStatus({ kind: 'online', story: 'solo' }); }, []);
  const acct = useAccount();
  const [conn, setConn] = useState<TableConnection | null>(null);
  useEffect(() => {
    if (!acct.ready) return;
    const name = acct.user?.username ?? (loadName() || 'Player');
    const c = new TableConnection(code, name);
    setConn(c);
    return () => c.close();
  }, [code, acct.ready, acct.user?.username]);
  if (!conn) {
    return <div className="story-shell" data-testid="story-room-connecting"><p className="story-note">Setting up your story table…</p></div>;
  }
  return <StoryRoomConn conn={conn} code={code} track={track} myUid={acct.user?.id ?? null} onExit={onExit} />;
}

function StoryRoomConn({ conn, code, track, myUid, onExit }: {
  conn: TableConnection; code: string; track: string | null; myUid: string | null; onExit: () => void;
}) {
  const cs = useConn(conn);
  return <StoryRoomInner conn={conn} cs={cs} code={code} track={track} myUid={myUid} onExit={onExit} />;
}

export function StoryRoomInner({ conn, cs, code, track, myUid, onExit }: {
  conn: { send: (m: ClientMsg) => void };
  cs: ConnState;
  code: string;
  track: string | null;
  myUid: string | null;
  onExit: () => void;
}) {
  const story = cs.room?.story ?? null;
  const stop = story ? storyStopById(story.stopId) : undefined;
  // The pair track: known up front for invite rooms; for share-code rooms it
  // exists only once the partner binds — the room's own word is final.
  const effTrack = track ?? story?.track ?? null;
  const [pairProgress, setPairProgress] = useState<StoryProgress | null>(null);
  // The awareness facts for this sit-down (spec §7.3): the pair-context
  // block for the room + stop, fetched once both partners are bound and
  // the run reaches the tape. Everything awareness — the rundown
  // variant, the scene's meet beats, the lobby's memory line — reads
  // from this one sanitized block.
  const [pairCtx, setPairCtx] = useState<PairContext | null>(null);
  useEffect(() => {
    if (!story || !story.partnerUid || (story.phase !== 'tape' && story.phase !== 'scene' && story.phase !== 'lobby')) return;
    let live = true;
    void fetchPairContext(code, story.stopId).then((c) => { if (live && c) setPairCtx(c); });
    return () => { live = false; };
  }, [code, story?.phase, story?.stopId, story?.partnerUid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState<StoryResult | null>(null);
  const [postState, setPostState] = useState<'idle' | 'posting' | 'posted' | 'failed'>('idle');
  const [armConcede, setArmConcede] = useState(false);
  /** the King's proposal scene has played out on this client — the
   *  choice card follows it (Phase 4) */
  const [finaleSceneDone, setFinaleSceneDone] = useState(false);
  const postedForRef = useRef<string | null>(null);
  const retriedRef = useRef(false);
  const pingedRef = useRef<string | null>(null);

  // story.ready holds account UIDS (the server pushes uid on
  // storyReady); cs.you is the room's member/player id — a different
  // namespace. Comparing the two meant meReady could NEVER be true:
  // in production the primary button stayed an enabled "Sit down —
  // ready" after readying, re-sending the same message to no visible
  // effect beside Leave — the owner's "the two buttons do the same
  // thing" (2026-10-24). The seat ticks were unaffected (they
  // compare uid to uid). Derive from myUid, as amHost does.
  const meReady = !!myUid && !!story && story.ready.includes(myUid);
  const amHost = !!myUid && !!story && story.hostUid === myUid;

  // Pair progress: the tape's facts, the lobby's unlocked stops, the outro's
  // next stop. Refreshed when the room (re)binds and after a result posts.
  useEffect(() => {
    if (!effTrack) return;
    let live = true;
    void fetchStoryProgress(effTrack).then((r) => { if (live && r.status === 'ok') setPairProgress(r.progress); });
    return () => { live = false; };
  }, [effTrack]);

  // The sit-down ping (call-backs), once per game: the server knows a story
  // match is open on the pair track.
  useEffect(() => {
    if ((story?.phase === 'game' || story?.phase === 'finale-game') && stop && effTrack && pingedRef.current !== story.gameId) {
      pingedRef.current = story.gameId;
      reportStorySession('open', stop.id, effTrack);
    }
  }, [story?.phase, story?.gameId, stop, effTrack]);

  const postResult = async (stopId: string, gameId: string, won: boolean) => {
    if (!effTrack) return;
    if (postedForRef.current === gameId) return;
    postedForRef.current = gameId;
    setPostState('posting');
    try { localStorage.setItem(UNPOSTED_KEY, JSON.stringify({ code, track: effTrack, stopId, gameId } satisfies Unposted)); } catch { /* private mode */ }
    const r = await postStoryResult(stopId, won, gameId, undefined, effTrack);
    if (r) {
      setResult(r);
      setPairProgress(r);
      setPostState('posted');
      reportStorySession('closed', stopId, effTrack);
      try { if (readUnposted()?.gameId === gameId) localStorage.removeItem(UNPOSTED_KEY); } catch { /* ignore */ }
    } else {
      postedForRef.current = null; // a retry is allowed — the marker stays until one lands
      setPostState('failed');
    }
  };

  // Outro: post this game's result once, from the room's witnessed gameId.
  useEffect(() => {
    if (story?.phase !== 'outro' || !stop || !story.gameId || postState !== 'idle') return;
    const won = cs.view?.result ? cs.view.result.winners.includes(cs.seat ?? 0) : false;
    void postResult(stop.id, story.gameId, won);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.phase, story?.gameId, stop?.id, postState]);

  // Leaving the outro behind (the pair advanced) resets the post cycle.
  useEffect(() => {
    if (story && story.phase !== 'outro' && postState !== 'idle') {
      setPostState('idle');
      setResult(null);
    }
  }, [story?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh proposal replays its scene on this client.
  useEffect(() => {
    if (story && story.phase !== 'finale') setFinaleSceneDone(false);
  }, [story?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // A result that never landed (tab closed mid-outro, post failed while the
  // room moved on): retry it once on mount — the witness row is the truth,
  // the post is idempotent per player.
  useEffect(() => {
    const u = readUnposted();
    if (u && u.code === code && effTrack && u.track === effTrack && !retriedRef.current) {
      retriedRef.current = true;
      void postResult(u.stopId, u.gameId, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effTrack]);

  /** The awareness context for this sit-down: the pair-context block
   *  when it landed; until then (or if it failed) a pair-facts-only
   *  fallback in which nobody "knows" anything personally — awareness
   *  simply doesn't fire, and case (e)/(a) still select correctly. */
  const awarenessCtxFor = (s: StoryStop): PairContextFacts => {
    const row = pairProgress?.stops.find((x) => x.stopId === s.id);
    const pair = {
      attempts: pairCtx?.pair.attempts ?? row?.attempts ?? 0,
      clears: pairCtx?.pair.clears ?? row?.clears ?? 0,
      doublePending: pairCtx?.pair.doublePending ?? row?.doublePending ?? false,
    };
    const blank = { handle: '', knowsStop: false, clearedStop: false, clearedStops: 0 };
    const players = pairCtx && pairCtx.players.length >= 2
      ? [pairCtx.players[0]!, pairCtx.players[1]!] as PairContextFacts['players']
      : [blank, blank] as PairContextFacts['players'];
    return { players, pair };
  };

  const factsFor = (s: StoryStop): StoryBeatFacts & { clears: number; attemptsAtPorch: number; doublePending: boolean } => {
    const row = pairProgress?.stops.find((x) => x.stopId === s.id);
    const aware = awarenessFactsFor(s.id, awarenessCtxFor(s));
    return {
      attempts: row?.attempts ?? 0,
      clears: row?.clears ?? 0,
      cleared: (row?.clears ?? 0) > 0,
      doublePending: row?.doublePending ?? false,
      clearedStopIds: pairProgress?.stops.filter((x) => x.clears > 0).map((x) => x.stopId) ?? [],
      attemptsAtPorch: pairProgress?.stops.find((x) => x.stopId === 'porch')?.attempts ?? 0,
      railCast: railCastForAttempt(s.id, (row?.attempts ?? 0) + 1),
      // WORD TRAVELS FAST: the pair track's real route position + the
      // manner facts, same derivation as solo (storyApi.routeFactsFor).
      ...routeFactsFor(pairProgress, s),
      ...(aware ? { awareness: aware } : {}),
    };
  };

  /** The scene egg for the pair scene (per-poster find, like solo). */
  const eggFor = (s: StoryStop): SceneEgg | null => {
    const secret = STORY_SECRETS[s.id];
    if (!secret || (pairProgress?.finds?.eggs ?? []).includes(secret.egg.id)) return null;
    const t = secret.egg.trigger;
    if (t.type === 'matchEvent') return null;
    const beats = (secret.egg.beat ?? []).map((x) => ({ speaker: x.speaker, line: x.line }));
    if (t.type === 'chain') {
      const fromEgg = STORY_SECRETS[t.fromStopId]?.egg;
      return { trigger: 'chain', ready: !!fromEgg && (pairProgress?.finds?.eggs ?? []).includes(fromEgg.id), beats };
    }
    return { trigger: t.type, ready: false, beats };
  };
  const handleEggFound = (s: StoryStop) => {
    const secret = STORY_SECRETS[s.id];
    if (!secret || !effTrack) return;
    sound.storySting('unlock');
    void postStoryFound(secret.egg.id, effTrack).then((p) => { if (p) setPairProgress(p); });
  };

  const ready = (stopId?: string) => conn.send(stopId ? { t: 'storyReady', stopId } : { t: 'storyReady' });

  if (cs.joinFault) {
    return (
      <div className="story-shell" data-testid="story-room-fault">
        <p className="story-lock-title">That story table is gone</p>
        <p className="story-lock-line">{cs.joinFault.message}</p>
        <button type="button" className="btn primary" onClick={onExit}>Back to Story Mode</button>
      </div>
    );
  }
  if (!story || !stop) {
    if (cs.error?.code === 'SPOKEN_FOR') {
      return (
        <div className="story-shell" data-testid="story-room-spoken-for">
          <p className="story-lock-title">This story table is spoken for</p>
          <p className="story-lock-line">A story table seats exactly one pair. Ask your partner for a fresh invite, or start your own table.</p>
          <button type="button" className="btn primary" onClick={onExit}>Back to Story Mode</button>
        </div>
      );
    }
    return <div className="story-shell" data-testid="story-room-connecting"><p className="story-note">Setting up your story table…</p></div>;
  }

  const pair = stop.pair.map((id) => STORY_CHARACTERS[id]?.name ?? id);
  const readyBtn = (testid: string, label: string) => (
    <button type="button" className="btn primary" data-testid={testid} disabled={meReady} onClick={() => ready()}>
      {meReady ? 'Waiting for your partner…' : label}
    </button>
  );

  if (story.phase === 'lobby') {
    const shareUrl = `${location.origin}/story?coop=${code}`;
    const seats = cs.room!.seats;
    // The seats composed as the table they'll play at, from THIS
    // viewer's chair: own seat at the bottom, partner across, the
    // stop's pair on the sides (the game's own seating geometry).
    const mySeat = cs.seat ?? 0;
    const posOf = (i: number) => {
      const rel = (i - mySeat + 4) % 4;
      return rel === 0 ? 'bottom' : rel === 1 ? 'left' : rel === 2 ? 'top' : 'right';
    };
    const seatName = (seat: SeatInfo, i: number) => (seat.kind === 'human' ? seat.name
      : seat.kind === 'bot' ? (seat.was ? `Dee (covering for ${seat.was})` : seat.name)
      : i === 2 ? 'Your partner' : '—');
    const seatStatus = (seat: SeatInfo, i: number) => (seat.kind === 'empty' && i === 2
      ? (story.partnerUid ? 'On their way in' : 'Share the code to fill the seat')
      : null);
    const clearedCount = pairProgress?.stops.filter((x) => x.clears > 0).length ?? 0;
    const currentRow = pairProgress?.stops.find((x) => x.state === 'current');
    const currentStop = currentRow ? STORY_STOPS.find((x) => x.id === currentRow.stopId) : undefined;
    const routeLine = !pairProgress ? null
      : pairProgress.completed
        ? 'Route complete — you made it out, together. Every stop stays open for a replay.'
        : currentStop
          ? stop.id === currentStop.id
            ? `${clearedCount} of ${STORY_STOPS.length} stops cleared together — ${currentStop.name} is where the pair stands.`
            : `${clearedCount} of ${STORY_STOPS.length} stops cleared together — ${currentStop.name} is next, and tonight you\u2019re sitting at ${stop.name}.`
          : null;
    return (
      <div className="story-shell story-room-shell" data-testid="story-room-lobby">
        <div className="story-hero story-room-hero">
          <div className="story-hero-bg" style={{ backgroundImage: `url(${storyBackdropUrl(stop)})` }} aria-hidden />
          <div className="story-topbar">
            <div className="story-title-block">
              <p className="story-crumb">Stop {stop.n} of {STORY_STOPS.length} · Story co-op</p>
              <h1 className="story-title">{stop.name}</h1>
              <p className="story-sub">{pair[0]} &amp; {pair[1]} · {stop.twist.label}</p>
            </div>
            <span className="dock-slot" aria-hidden />
          </div>
        </div>
        <div className="story-room-share">
          <div className="story-room-ticket">
            <span className="story-room-ticket-label">Room code</span>
            <span className="story-room-code" data-testid="story-room-code">{code}</span>
          </div>
          <button type="button" className="btn ghost" data-testid="story-room-copy" onClick={() => { void navigator.clipboard?.writeText(shareUrl).catch(() => undefined); }}>
            Copy invite link
          </button>
        </div>
        <div className="story-room-table" data-testid="story-room-seats">
          <span className="story-room-felt-mark" aria-hidden>♠</span>
          {seats.map((seat, i) => {
            const status = seatStatus(seat, i);
            const isReady = seat.kind === 'human' && !!seat.uid && story.ready.includes(seat.uid);
            // The partner's unfilled seat is ONE compact line (small
            // medallion + "Your partner — …"), not a stacked seat
            // block: the stage build (owner, 2026-10-24) buys its
            // height back for the felt.
            if (seat.kind === 'empty' && status) {
              return (
                <div key={i} className={`story-room-seat pos-${posOf(i)} is-open`}>
                  <RoomSeatFace seat={seat} stop={stop} index={i} />
                  <span className="story-room-seat-openline">
                    <span className="story-room-seat-name">{seatName(seat, i)}</span>
                    <span className="story-room-seat-status">{status}</span>
                  </span>
                </div>
              );
            }
            return (
              <div key={i} className={`story-room-seat pos-${posOf(i)}${seat.kind === 'human' && !seat.connected ? ' away' : ''}`}>
                <RoomSeatFace seat={seat} stop={stop} index={i} />
                <span className="story-room-seat-name">
                  {seatName(seat, i)}
                  {isReady && <span className="story-room-seat-ready">Ready ✓</span>}
                </span>
                <span className="story-room-seat-role">{i === 0 ? 'Host' : i === 2 ? 'Partner' : 'The stop’s pair'}</span>
              </div>
            );
          })}
        </div>
        {!story.partnerUid && <p className="story-room-line" data-testid="story-room-waiting">Waiting for your partner — send them the code or the invite link. The run starts when you both sit down.</p>}
        {(() => {
          const c = awarenessCaseFor(stop.id, awarenessCtxFor(stop));
          return c === 'b' || c === 'd'
            ? <p className="story-room-line aware" data-testid="story-room-aware">They know one of you here.</p>
            : null;
        })()}
        {pairProgress && (
          <div className="story-room-stops" data-testid="story-room-stops">
            <p className="story-coop-h">The pair’s stop</p>
            <div className="story-gate-thread" aria-hidden>
              {pairProgress.stops.map((row, i) => {
                const s = STORY_STOPS.find((x) => x.id === row.stopId)!;
                return (
                  <Fragment key={row.stopId}>
                    {i > 0 && <span className="story-gate-link" />}
                    <span className={`story-gate-node state-${row.state}${row.stopId === 'king' ? ' is-king' : ''}${row.stopId === stop.id ? ' is-here' : ''}`}>{row.state === 'cleared' ? '✓' : s.n}</span>
                  </Fragment>
                );
              })}
            </div>
            {routeLine && <p className="story-room-route-line">{routeLine}</p>}
            {amHost && (
              <div className="story-room-stoprow">
                {pairProgress.stops.filter((row) => row.state !== 'locked').map((row) => {
                  const s = STORY_STOPS.find((x) => x.id === row.stopId)!;
                  return (
                    <button
                      key={row.stopId}
                      type="button"
                      className={`btn ${row.stopId === stop.id ? 'primary' : 'ghost'}`}
                      data-testid={`story-room-stop-${row.stopId}`}
                      onClick={() => ready(row.stopId)}
                    >{s.name}</button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* One honest primary per state (owner, 2026-10-24: beside
            Leave, a disabled gold "Waiting…" button read as a second
            button that did the same nothing). Not ready → the button
            is the action (bare storyReady, as ever). Ready → the slot
            is a STATUS, not a button: the room advances on its own
            when both are ready, so there is no Start verb to offer.
            Leave is always Leave, one job. The host's stop chips are
            the only other lobby control that sends storyReady — their
            labeled job is the pick itself (the server applies the
            stop and readies the host on the same message), and they
            stay live after readying so the pick can still change. */}
        <div className="story-room-actions">
          {meReady ? (
            <p className="story-room-status" data-testid="story-room-ready" role="status">Ready — waiting on your partner</p>
          ) : (
            <button type="button" className="btn primary" data-testid="story-room-ready" onClick={() => ready()}>Sit down — ready</button>
          )}
          <button type="button" className="btn ghost" data-testid="story-room-leave" onClick={onExit}>Leave</button>
        </div>
      </div>
    );
  }

  if (story.phase === 'tape') {
    const ctx = awarenessCtxFor(stop);
    const rundown = coopRundownFor(stop.id, awarenessCaseFor(stop.id, ctx), ctx.pair);
    return (
      <div className="story-shell" data-testid="story-room-tape">
        {/* SceneAudio is this surface's audio contract (enterTable is
            the voice gate) — the rundown speaks only while it is mounted
            (the solo meet-them silence, fixed in 77c6e432, was exactly
            this mount missing). */}
        <SceneAudio stop={stop} />
        <StoryTape stop={stop} facts={factsFor(stop)} cta={meReady ? 'Waiting for your partner…' : 'Ready — play the scene'} onDone={() => ready()} rundown={rundown} rundownTrack={effTrack ?? ''} />
        <div className="story-room-actions">
          <button type="button" className="btn ghost" data-testid="story-room-leave" onClick={onExit}>Leave</button>
        </div>
      </div>
    );
  }

  if (story.phase === 'scene') {
    return (
      <div className="story-shell" data-testid="story-room-scene">
        <SceneAudio stop={stop} />
        <ScriptPlayer
          beats={beatsFor(stop, 'intro', factsFor(stop))}
          cta={meReady ? 'Waiting for your partner…' : 'Ready — to the table'}
          onDone={() => ready()}
          bgUrl={storyBackdropUrl(stop)}
          cast={[stop.pair[0], 'dee', stop.pair[1]]}
          rail={railCastForAttempt(stop.id, factsFor(stop).attempts + 1)}
          egg={eggFor(stop)}
          onEggFound={() => handleEggFound(stop)}
        />
        <div className="story-room-actions">
          <button type="button" className="btn ghost" data-testid="story-room-leave" onClick={onExit}>Leave</button>
        </div>
      </div>
    );
  }

  if (story.phase === 'finale') {
    // The King's proposal (Phase 4, spec §6.3): the gun is already on the
    // felt when he speaks (the scene's first beat stages it — placed,
    // never pointed, never touched, never fired), the terms are stated
    // with their price, and then BOTH partners answer. Each answer is
    // visible to both and can be changed; the room acts only on
    // agreement — disagreement parks the proposal with nothing lost.
    const fin = story.finale;
    const myChoice = fin?.choices.find((c) => c.uid === myUid)?.choice;
    const partnerChoice = fin?.choices.find((c) => c.uid !== myUid)?.choice;
    const choiceLabel = (c?: 'cutthroat' | 'bank') => (c === 'cutthroat' ? 'the cutthroat' : c === 'bank' ? 'banking the clear' : null);
    return (
      <div className="story-shell" data-testid="story-room-finale">
        <SceneAudio stop={stop} />
        {!finaleSceneDone ? (
          <ScriptPlayer
            key={fin?.short ? 'finale-short' : 'finale-full'}
            beats={kingProposalBeats(fin?.short ?? false)}
            cta="Decide — together"
            onDone={() => setFinaleSceneDone(true)}
            bgUrl={storyBackdropUrl(stop)}
            cast={[stop.pair[0], 'dee', stop.pair[1]]}
          />
        ) : (
          <div className="story-finale-choice" data-testid="story-finale-choice">
            <p className="story-reward-card-title">The King’s offer</p>
            <p className="story-reward-card-sub">Leg 1 is yours — but nothing is banked while the double stands. His last test pulls the other way: a cutthroat, four seats, no partners.</p>
            <ul className="story-finale-terms">
              <li>One of you wins the cutthroat → <b>the double pays: +550 XP, +440 coins — each</b>, even if the other finishes last.</li>
              <li>The King or the Ringer wins with a human 2nd → <b>the normal clear: +275 XP, +220 coins each</b>.</li>
              <li>Both humans finish 3rd/4th → <b>the clear is gone</b>: +5 XP each, and the King stays current.</li>
              <li>Or bank leg 1 now → <b>the normal clear: +275 XP, +220 coins each</b>, no gamble.</li>
            </ul>
            <div className="story-room-actions">
              <button type="button" className={`btn ${myChoice === 'cutthroat' ? 'primary' : 'ghost'}`} data-testid="story-finale-cutthroat" onClick={() => conn.send({ t: 'storyFinale', choice: 'cutthroat' })}>
                Take the cutthroat
              </button>
              <button type="button" className={`btn ${myChoice === 'bank' ? 'primary' : 'ghost'}`} data-testid="story-finale-bank" onClick={() => conn.send({ t: 'storyFinale', choice: 'bank' })}>
                Bank the clear
              </button>
            </div>
            <p className="story-note" data-testid="story-finale-standings">
              {myChoice ? `You chose ${choiceLabel(myChoice)}.` : 'You haven’t answered yet.'}{' '}
              {partnerChoice ? `Your partner chose ${choiceLabel(partnerChoice)}.` : 'Your partner hasn’t answered yet.'}
              {myChoice && partnerChoice && myChoice !== partnerChoice ? ' You don’t agree yet — talk it out. Nothing is lost while you decide.' : ''}
              {myChoice && partnerChoice && myChoice === partnerChoice ? ' Agreed.' : ''}
            </p>
          </div>
        )}
        <div className="story-room-actions">
          <button type="button" className="btn ghost" data-testid="story-room-leave" onClick={onExit}>Leave</button>
        </div>
      </div>
    );
  }

  if (story.phase === 'game' || story.phase === 'finale-game') {
    const inFinale = story.phase === 'finale-game';
    // Versus headline for the pair: this stop's shared facts (pair context
    // first, the pair-track row as fallback — the awarenessCtxFor merge).
    const progressRow = pairProgress?.stops.find((x) => x.stopId === story.stopId);
    const versusPairNote = stop ? coopPairNote(stop.name, pairCtx
      ? { attempts: pairCtx.pair.attempts, clears: pairCtx.pair.clears, doublePending: pairCtx.pair.doublePending }
      : progressRow ? { attempts: progressRow.attempts, clears: progressRow.clears, doublePending: progressRow.doublePending } : null) : null;
    return (
      <div className="story-room-game" data-testid={inFinale ? 'story-room-finale-game' : 'story-room-game'}>
        <OnlineTable conn={conn as TableConnection} cs={cs} mesh={null} onLobby={onExit} onMainMenu={onExit} versusPairNote={versusPairNote} />
        <GuidePlate chat={cs.chat} seats={cs.room!.seats} />
        <div className="story-room-concede">
          {armConcede ? (
            <>
              <span>{inFinale ? 'Concede the finale? The gamble is lost — the clear goes with it.' : 'Concede the match? It counts as a loss for the pair.'}</span>
              <button type="button" className="btn ghost" data-testid="story-room-concede-yes" onClick={() => conn.send({ t: 'concede' })}>Concede</button>
              <button type="button" className="btn ghost" onClick={() => setArmConcede(false)}>Keep playing</button>
            </>
          ) : (
            <button type="button" className="btn ghost" data-testid="story-room-concede" onClick={() => setArmConcede(true)}>Concede</button>
          )}
        </div>
      </div>
    );
  }

  // outro
  const r = result;
  // NEXT-STOP TRUTH (owner, 2026-10-24): the next stop comes from the
  // pair's PROGRESS (first uncleared stop on the pair track), never
  // from the stop just played — a replay here used to point at n+1.
  const nextStop = r ? trueNextStop(r, stop.id) : undefined;
  const dblStarted = !!r && stop.doubleOrNothing === true && r.won && !r.firstClear
    && (r.doubleOutcome === 'started' || r.doublePending === true);
  const dblLost = !!r && stop.doubleOrNothing === true && !r.won && r.doubleOutcome === 'lost';
  /** the finale outcome this outro's post resolved (Phase 4) */
  const fin = r?.finale ?? null;
  return (
    <div className="story-shell" data-testid="story-room-outro">
      <div className="story-topbar">
        <div className="story-title-block">
          <p className="story-crumb">Stop {stop.n} of {STORY_STOPS.length} · Story co-op</p>
          <h1 className="story-title">{stop.name}</h1>
          <p className="story-sub">{story.concededBy ? `${story.concededBy} conceded the match.` : 'Match over.'}</p>
        </div>
        <span className="dock-slot" aria-hidden />
      </div>
      {postState === 'posting' || postState === 'idle' ? (
        <p className="story-note" data-testid="story-room-tallying">Tallying the run…</p>
      ) : postState === 'failed' ? (
        <div className="story-room-actions">
          <p className="story-note" role="alert">That game is witnessed by the room but the tally didn’t land. Your credit is safe — retry it.</p>
          <button type="button" className="btn primary" data-testid="story-room-retry-post" onClick={() => { if (story.gameId) void postResult(stop.id, story.gameId, cs.view?.result ? cs.view.result.winners.includes(cs.seat ?? 0) : false); }}>Retry the tally</button>
        </div>
      ) : r ? (
        <div className="story-rewards">
          {r.won && !dblStarted && (
            <div className="story-reward-hero story-reward-line" data-testid="story-room-reward-line">
              <p className="story-reward-kicker">{r.firstClear ? 'First clear — together!' : 'Replay upkeep'}</p>
              <div className="story-reward-stats">
                <span className="story-reward-stat"><b>+{r.rewards.xp} XP</b></span>
                <span className="story-reward-stat"><b>+{r.rewards.coins} coins</b></span>
              </div>
              <p className="story-reward-note">Your partner banks the same — the pair advances together.</p>
              {r.completed && <p className="story-reward-note">Route complete — the pair mark is yours, together.</p>}
            </div>
          )}
          {dblStarted && (
            <div className="story-reward-card double story-reward-line" data-testid="story-room-double-line">
              <div className="story-reward-card-body">
                <p className="story-reward-card-title">Double or nothing</p>
                <p className="story-reward-card-sub">You beat the King once — and banked <b>nothing</b>. One more win, together, takes the crown and double the clear. Lose, and both wins are gone.</p>
              </div>
            </div>
          )}
          {!r.won && !dblLost && (
            <div className="story-reward-hero consolation story-reward-line" data-testid="story-room-reward-line">
              <div className="story-reward-stats"><span className="story-reward-stat"><b>+{r.rewards.xp} XP</b></span></div>
              <p className="story-reward-note">The effort counts — for seeing it through, both of you. No coins on a loss, and no penalty. The retry is free.</p>
            </div>
          )}
          {dblLost && (
            <div className="story-reward-card double story-reward-line" data-testid="story-room-double-lost-line">
              <div className="story-reward-card-body">
                <p className="story-reward-card-title">Nothing banked</p>
                <p className="story-reward-card-sub">Double or nothing — and it came up nothing, for both of you. The first win is wiped with it.{r.rewards.xp > 0 ? <> The effort still counts: <b>+{r.rewards.xp} XP</b> each.</> : ''} The King stays current.</p>
              </div>
            </div>
          )}
          {fin === 'double' && (
            <p className="story-reward-note" data-testid="story-room-finale-note">One of you took the cutthroat — the double pays to <b>both names</b>.</p>
          )}
          {fin === 'clear' && (
            <p className="story-reward-note" data-testid="story-room-finale-note">He took the cutthroat, but a human stood to the last hand — the clear is banked, together.</p>
          )}
          {fin === 'declined' && (
            <p className="story-reward-note" data-testid="story-room-finale-note">Took the clear and walked — the offer answered, both names on it.</p>
          )}
          {(r.newFinds?.length ?? 0) > 0 && (
            <div className="story-find-line" data-testid="story-room-new-finds">
              {r.newFinds.map((f) => (
                <div key={f.id} className="story-reward-card find">
                  <div className="story-reward-card-body">
                    <p className="story-reward-card-title">{f.kind === 'feat' ? 'Unlocked' : 'Found'}: {f.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {r && (
        <p className="story-guide-outro" data-testid="story-room-guide-outro">
          <span className="story-guide-byline">Dee · guide</span>
          {guideOutroLine(dblLost ? 'kingDoubleLost' : r.completed ? 'kingClear' : r.won ? 'win' : 'loss', story.gameId ?? code)}
        </p>
      )}
      <div className="story-room-actions">
        {r?.completed ? null : dblStarted ? (
          readyBtn('story-room-next', 'Face the King’s offer')
        ) : (
          <>
            {nextStop && (
              <button type="button" className="btn primary" data-testid="story-room-next" disabled={meReady} onClick={() => ready(nextStop.id)}>
                {meReady ? 'Waiting for your partner…' : `Next stop: ${nextStop.name}`}
              </button>
            )}
            {readyBtn('story-room-runback', 'Run it back')}
          </>
        )}
        <button type="button" className="btn ghost" data-testid="story-room-leave" onClick={onExit}>Back to Story Mode</button>
      </div>
    </div>
  );
}
