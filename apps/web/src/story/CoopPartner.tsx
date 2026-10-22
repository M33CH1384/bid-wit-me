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
 */
import { useEffect, useState } from 'react';
import { STORY_STOPS, storyStopById } from '@spades/bots';
import { social, useSocial } from '../social/store';
import { createStoryRoom, fetchStoryTracks, joinStoryRoom, type StoryTracks } from './storyApi';

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
      <p className="story-coop-lede">Two players, one run. You and your partner play the seats across from each other — Dee rides along as your guide. Progress belongs to the pair: run with someone new and you start together at the Porch.</p>
      {err && <p className="story-note story-coop-err" data-testid="story-coop-error" role="alert">{err}</p>}

      {tracks && tracks.pairs.length > 0 && (
        <section className="story-coop-runs">
          <h2 className="story-coop-h">Your runs</h2>
          {tracks.pairs.map((p) => (
            <button
              key={p.track}
              type="button"
              className="story-coop-run"
              data-testid={`story-coop-run-${p.partnerUid}`}
              onClick={() => onSelectRun(p.track, p.partnerUid, p.partnerHandle)}
            >
              <span className="story-coop-run-name">With {p.partnerHandle ?? 'your partner'}</span>
              <span className="story-coop-run-facts">
                {p.completed ? 'Route complete together' : p.currentStop != null ? `At stop ${p.currentStop} — ${STORY_STOPS.find((x) => x.n === p.currentStop)?.name ?? ''}` : 'Not started'}
              </span>
            </button>
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
              <div key={f.id} className="story-coop-friend">
                <span className="story-coop-friend-name">{f.name}</span>
                <button
                  type="button"
                  className="btn primary"
                  data-testid={`story-coop-invite-${f.id}`}
                  disabled={busy !== null}
                  onClick={() => void inviteFriend(f.id, f.name)}
                >{busy === f.id ? 'Setting up…' : 'Invite'}</button>
              </div>
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
        <form className="story-coop-join-row" onSubmit={(e) => { e.preventDefault(); void joinByCode(); }}>
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
