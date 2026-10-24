/**
 * Story co-op partner step (spec §1.2): who are you running with?
 *  - "Your runs": every pair track the caller already has — progression is
 *    per-pair, so a run belongs to the two players who built it. Picking a
 *    run opens that pair's map.
 *  - Friends: inviting a friend creates a story room at the pair's current
 *    stop (the Porch for a brand-new pair) and sends the story-coop invite;
 *    the host waits in the room.
 *  - Share code: open a table with no partner named and share the code/link;
 *    whoever joins binds as the partner (and fixes the pair track).
 * Friends' story access is the server's call — the create refuses a partner
 * the lock still covers, and the error says so plainly.
 *
 * The step's presentation (owner, 2026-10-24 — "This screen is still
 * trash but I like the next screen that stages the players"): the gate
 * and the room lobby set the register, and this screen speaks it — Dee
 * herself presents the run (she is the guide; the wall of explainer
 * text became her copy, carrying the same facts), friend rows carry
 * real faces, real presence and the pair's real standing, and the join
 * code is entered on the lobby's ticket. Every fact shown is a payload
 * fact — a friend's presence comes from friendPresenceView (the same
 * helper the Friends tab renders with: live hub row, then fresh
 * persisted activity, then last online), a run's standing from the
 * pair track payload — or it is not shown at all.
 */
import { useEffect, useState } from 'react';
import { STORY_STOPS, storyStopById } from '@spades/bots';
import type { FriendRef } from '@spades/protocol';
import { social, useSocial } from '../social/store';
import { friendPresenceView, type FriendPresenceView } from '../social/presence';
import { AvatarCircle, accountUidOf, useAvatar } from '../avatar';
import StoryFace from './StoryFace';
import { createStoryRoom, fetchStoryTracks, joinStoryRoom, type StoryPairRun, type StoryTracks } from './storyApi';

/** The mode names the Friends tab renders with (Social.tsx's MODE_NAME). */
const modeName = (m: string) => ({ joker: 'Joker Spades', aceDown: 'Ace Down', cutthroat: 'Cutthroat' } as Record<string, string>)[m] ?? m;

/**
 * A pair run's standing, in words. Every clause derives from the track
 * payload: unlock is sequential, so the pair's current stop makes the
 * cleared-together count exact (the stops before it), and a completed
 * route is the payload's own flag.
 */
export function pairRunFacts(run: StoryPairRun): string {
  if (run.completed) return `Route complete together — all ${STORY_STOPS.length} stops cleared`;
  if (run.currentStop == null) return 'Not started — begins together at the Porch';
  const stop = STORY_STOPS.find((x) => x.n === run.currentStop);
  const cleared = run.currentStop - 1;
  return cleared > 0
    ? `At stop ${run.currentStop} — ${stop?.name ?? ''} · ${cleared} of ${STORY_STOPS.length} cleared together`
    : `At stop ${run.currentStop} — ${stop?.name ?? ''} — where the run starts`;
}

/** The short form of the same standing, for a friend row. */
function pairRunStanding(run: StoryPairRun): string {
  if (run.completed) return 'You two made it out together';
  if (run.currentStop == null) return 'A run on the books — not started yet';
  const stop = STORY_STOPS.find((x) => x.n === run.currentStop);
  return `Running together — at ${stop?.name ?? 'the Porch'}`;
}

/** A player's real face for a row: their uploaded picture, else the initial. */
function FriendFace({ pid, name }: { pid: string; name: string }) {
  const pic = useAvatar(accountUidOf(pid));
  return <AvatarCircle pic={pic} name={name} className="story-coop-av" />;
}

function CoopRunRow({ run, onSelect }: { run: StoryPairRun; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="story-coop-run"
      data-testid={`story-coop-run-${run.partnerUid}`}
      onClick={onSelect}
    >
      <FriendFace pid={`u:${run.partnerUid}`} name={run.partnerHandle ?? 'Partner'} />
      <span className="story-coop-run-text">
        <span className="story-coop-run-name">With {run.partnerHandle ?? 'your partner'}</span>
        <span className="story-coop-run-facts">{pairRunFacts(run)}</span>
      </span>
    </button>
  );
}

function CoopFriendRow({ f, run, presence, busyPid, onInvite }: {
  f: FriendRef;
  run: StoryPairRun | null;
  presence: FriendPresenceView;
  busyPid: string | null;
  onInvite: () => void;
}) {
  return (
    <div className="story-coop-friend">
      <FriendFace pid={f.id} name={f.name} />
      <div className="story-coop-friend-main">
        <span className="story-coop-friend-name">
          {presence.online && <i className="story-coop-dot" aria-hidden />}
          {f.name}
        </span>
        <span className="story-coop-friend-sub" data-testid={`story-coop-presence-${f.id}`}>{presence.label}</span>
        {run && <span className="story-coop-friend-run" data-testid={`story-coop-friend-run-${f.id}`}>{pairRunStanding(run)}</span>}
      </div>
      <button
        type="button"
        className="btn primary"
        data-testid={`story-coop-invite-${f.id}`}
        disabled={busyPid !== null}
        onClick={onInvite}
      >{busyPid === f.id ? 'Setting up…' : 'Invite'}</button>
    </div>
  );
}

export default function CoopPartner({ onSelectRun, onEnterRoom, joinError }: {
  /** a pair run was picked: open that pair's co-op map */
  onSelectRun: (track: string, partnerUid: string, partnerHandle: string | null) => void;
  /** a room exists (created or joined): go to it */
  onEnterRoom: (code: string, track: string | null) => void;
  /** a ?coop= link join failed upstream (spoken for / locked stop) — shown once here */
  joinError?: string | null;
}) {
  const s = useSocial();
  const [tracks, setTracks] = useState<StoryTracks | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(joinError ?? null);
  const [code, setCode] = useState('');
  const [shareCode, setShareCode] = useState<string | null>(null);

  useEffect(() => { social.start(); }, []);
  useEffect(() => {
    let live = true;
    void fetchStoryTracks().then((t) => { if (live) setTracks(t); });
    return () => { live = false; };
  }, []);

  const friends = s.friends?.friends ?? [];
  const runFor = (pid: string): StoryPairRun | null => {
    const uid = pid.startsWith('u:') ? pid.slice(2) : null;
    return uid ? tracks?.pairs.find((p) => p.partnerUid === uid) ?? null : null;
  };

  const inviteFriend = async (pid: string, name: string) => {
    const uid = pid.startsWith('u:') ? pid.slice(2) : null;
    if (!uid) { setErr(`${name} is not on an account — story co-op needs two signed-in players.`); return; }
    setBusy(pid); setErr(null);
    // The room opens at the pair's current stop — their run's, or the Porch.
    const run = tracks?.pairs.find((p) => p.partnerUid === uid);
    const stopId = (run?.currentStop != null ? STORY_STOPS.find((x) => x.n === run.currentStop)?.id : undefined) ?? 'porch';
    const r = await createStoryRoom(stopId, uid);
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    social.inviteStory(pid, r.code, stopId);
    onEnterRoom(r.code, r.track);
  };

  const startShareTable = async () => {
    setBusy('share'); setErr(null);
    const r = await createStoryRoom('porch');
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    setShareCode(r.code);
    onEnterRoom(r.code, r.track);
  };

  const joinByCode = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy('join'); setErr(null);
    const r = await joinStoryRoom(c);
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    onEnterRoom(r.code || c, r.track);
  };

  const shareLink = shareCode ? `${location.origin}/story?coop=${shareCode}` : null;

  return (
    <div className="story-coop" data-testid="story-coop-partner">
      <div className="story-coop-dee" data-testid="story-coop-dee">
        <StoryFace characterId="dee" name="Dee" className="dee-face" />
        <div className="story-coop-dee-body">
          <p className="story-coop-dee-name">Dee · your guide</p>
          <p className="story-coop-dee-line">Here’s the run: you and your partner take the seats across from each other, and I ride along as your guide. Everything you earn, you earn as a pair — so run with somebody new and we start together at the Porch, same as everybody.</p>
        </div>
      </div>
      {err && <p className="story-note story-coop-err" data-testid="story-coop-error" role="alert">{err}</p>}

      {tracks && tracks.pairs.length > 0 && (
        <section className="story-coop-runs">
          <h2 className="story-coop-h">Your runs</h2>
          {tracks.pairs.map((p) => (
            <CoopRunRow
              key={p.track}
              run={p}
              onSelect={() => onSelectRun(p.track, p.partnerUid, p.partnerHandle)}
            />
          ))}
        </section>
      )}

      <section className="story-coop-friends">
        <h2 className="story-coop-h">Invite a friend</h2>
        {s.friends === null
          ? <p className="story-coop-dim">Loading your friends…</p>
          : friends.length === 0
            ? <p className="story-coop-dim">No friends yet — add one from the Social panel, or share a table code below.</p>
            : friends.map((f) => (
              <CoopFriendRow
                key={f.id}
                f={f}
                run={runFor(f.id)}
                presence={friendPresenceView(f, s.users[f.id], s.lastAt[f.id] ?? 0, modeName)}
                busyPid={busy}
                onInvite={() => void inviteFriend(f.id, f.name)}
              />
            ))}
      </section>

      <section className="story-coop-share">
        <h2 className="story-coop-h">Or share a table</h2>
        <p className="story-coop-dim">Open a story table and share its code — whoever joins becomes your partner for the run.</p>
        <div className="story-coop-share-row">
          <button type="button" className="btn primary" data-testid="story-coop-share-start" disabled={busy !== null} onClick={() => void startShareTable()}>
            {busy === 'share' ? 'Opening…' : 'Start a table to share'}
          </button>
        </div>
        {shareLink && <p className="story-coop-dim" data-testid="story-coop-share-link">{shareLink}</p>}
        <form className="story-coop-ticket" onSubmit={(e) => { e.preventDefault(); void joinByCode(); }}>
          <span className="story-coop-ticket-label">Table code</span>
          <div className="story-coop-join-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TABLE CODE"
              maxLength={8}
              aria-label="Story table code"
              autoCapitalize="characters"
              data-testid="story-coop-code"
            />
            <button type="submit" className="btn ghost" data-testid="story-coop-join" disabled={busy !== null || !code.trim()}>Join</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** The stop a pair run is currently at (for headers/copy). */
export function pairStopName(run: { currentStop: number | null } | null): string {
  if (!run || run.currentStop == null) return 'the Porch';
  return storyStopById(STORY_STOPS.find((x) => x.n === run.currentStop)?.id ?? '')?.name ?? 'the Porch';
}
