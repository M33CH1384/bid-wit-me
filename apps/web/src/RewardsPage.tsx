import { useEffect, useRef, useState } from 'react';
import GameOverRewards, { computeRewards, fetchRewardsProfile, type RewardsData } from './GameOverRewards';
import { loadAccount, useAccount } from './account/api';
import { SignInSheet, UsernamePicker } from './account/AccountUI';
import { clearPendingClaim, loadClaimResult, peekPendingClaim, submitPendingClaim } from './pendingClaim';

/**
 * Dedicated /rewards screen (Demetrius 2026-10-19): after the player chooses to
 * leave a finished match, Table computes the rewards breakdown, stashes it here,
 * and routes to this page — a full opaque screen of its own, NOT a modal overlay
 * (the overlay kept rendering blurry on iOS). The stash survives the page load
 * via sessionStorage; a refresh still shows the same breakdown.
 */
export interface RewardsPayload {
  data: RewardsData;
  /** the finished match was an online table game */
  online: boolean;
  /** where the Home button lands ('/' normally, '/online' after Change mode online) */
  homePath: string;
  /** the finished match was a Story Mode stop game: its stop id. A rematch
   *  returns to THAT stop (story-scoped) — never to a generic autostart game
   *  built from the player's saved settings. Absent for non-story matches. */
  storyStopId?: string;
  /** the finished offline match's client game id (localGameId) — ties an
   *  unsigned breakdown to its pending rewards claim. Absent online. */
  gameId?: string;
}

/**
 * Where the rewards screen's Rematch button goes. A story match rematches
 * its own stop: the story route consumes ?rematch=<stopId> and starts that
 * stop again from the story snapshot (venue, twist, house deck, names,
 * attempt context). Every other match keeps the long-standing targets:
 * online back to the lobby, offline to a generic autostart game.
 */
export function rematchPathFor(p: RewardsPayload): string {
  if (p.storyStopId) return `/story?rematch=${encodeURIComponent(p.storyStopId)}`;
  return p.online ? '/online' : '/?autostart=1';
}

const KEY = 'bwm.rewards.v1';

export function stashRewards(p: RewardsPayload): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: page shows its fallback */ }
}

export function loadRewards(): RewardsPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RewardsPayload;
    return p && p.data ? p : null;
  } catch { return null; }
}

function rewardOpts(d: RewardsData): { won: boolean; headline: string; sub: string; kind: 'team' | 'cutthroat' } {
  return { won: d.won, headline: d.headline, sub: d.sub, kind: d.eloKindLabel === 'Partnership' ? 'team' : 'cutthroat' };
}

type ClaimUi = 'none' | 'held' | 'claiming' | 'claimed';

export default function RewardsPage() {
  const [payload, setPayload] = useState<RewardsPayload | null>(loadRewards);
  const [data, setData] = useState<RewardsData | null>(() => payload?.data ?? null);
  const [claimUi, setClaimUi] = useState<ClaimUi>('none');
  const [sheet, setSheet] = useState<null | 'signin' | 'passkey-new' | 'username'>(null);
  const a = useAccount();
  const claimRun = useRef(false);
  const nameAsked = useRef(false);

  // The account store drives the claim: OAuth returns to this page with
  // ?signin=…, which loadAccount folds into the store on mount.
  useEffect(() => { void loadAccount(); }, []);

  // Mount: this unsigned match may already have been claimed elsewhere
  // (sign-in landed on another screen first — the claim result is stored),
  // or its claim may be held here waiting for sign-in.
  useEffect(() => {
    if (!payload || payload.data.signedIn || !payload.gameId) return;
    const result = loadClaimResult(payload.gameId);
    if (result) {
      const d = computeRewards(result.before, result.after, rewardOpts(payload.data));
      d.postgame = payload.data.postgame;
      const p2 = { ...payload, data: d };
      setData(d);
      setPayload(p2);
      stashRewards(p2);
      setClaimUi('claimed');
      return;
    }
    const peek = peekPendingClaim(Date.now());
    if (peek.state === 'held' && peek.claim.item.clientGameId === payload.gameId) setClaimUi('held');
    else if (peek.state === 'expired') clearPendingClaim();
    // mount-only: the stash at first paint is the match this screen is for
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed in with a claim held: submit it and swap the sign-in panel for
  // the credited breakdown. The "before" snapshot is fetched BEFORE the
  // claim post — the same pinning discipline as a live game's rewards
  // (a2c80f7e) — so the delta is this match's real credit.
  useEffect(() => {
    if (claimUi !== 'held' || !a.user || !payload?.gameId || !data) return;
    if (a.user.needsUsername) {
      // the server credits by username-bearing accounts only; ask once,
      // the claim stays held until the name lands
      if (!nameAsked.current) { nameAsked.current = true; setSheet('username'); }
      return;
    }
    if (claimRun.current) return;
    claimRun.current = true;
    setClaimUi('claiming');
    void (async () => {
      const before = await fetchRewardsProfile().catch(() => null);
      const res = await submitPendingClaim({ before });
      const pair = res.after ? { before: res.before, after: res.after } : loadClaimResult(payload.gameId!);
      if ((res.status === 'claimed' || res.status === 'duplicate') && pair?.after) {
        const d = computeRewards(pair.before, pair.after, rewardOpts(data));
        d.postgame = data.postgame;
        const p2 = { ...payload, data: d };
        setData(d);
        setPayload(p2);
        stashRewards(p2);
        setClaimUi('claimed');
      } else if (res.status === 'error' || res.status === 'signed-out' || res.status === 'busy') {
        claimRun.current = false; // still held — a later account change retries
        setClaimUi('held');
      } else {
        setClaimUi('none'); // rejected / claimed by another account / expired: nothing left to claim
      }
    })();
  }, [claimUi, a.user, payload, data]);

  if (!payload || !data) {
    return (
      <div className="rewards-page" aria-label="Match rewards">
        <div className="rw-card">
          <div className="rw-head">
            <div className="rw-trophy">♠</div>
            <h2 className="lose">No match yet</h2>
            <p className="rw-sub0">Finish a match and your rewards will land here.</p>
          </div>
          <div className="rw-actions" style={{ animationDelay: '0ms' }}>
            <button type="button" className="primary big" data-testid="rewards-home" onClick={() => { location.href = '/'; }}>Home</button>
          </div>
        </div>
      </div>
    );
  }
  const { homePath } = payload;
  const onSignIn = () => { setSheet(a.user?.needsUsername ? 'username' : 'signin'); };
  return (
    <>
      <GameOverRewards
        data={data}
        onHome={() => { location.href = homePath; }}
        onRematch={() => { location.href = rematchPathFor(payload); }}
        onProfile={() => { location.href = '/profile'; }}
        onOpenTables={() => { location.href = '/online'; }}
        guestClaim={!data.signedIn ? { held: claimUi === 'held', claiming: claimUi === 'claiming', onSignIn } : undefined}
      />
      {sheet === 'signin' && <SignInSheet returnTo="/rewards" onClose={() => setSheet(null)} onPasskeyNew={() => setSheet('passkey-new')} />}
      {sheet === 'passkey-new' && <UsernamePicker mode="passkey-new" initial="" onDone={() => setSheet(null)} onClose={() => setSheet('signin')} />}
      {sheet === 'username' && a.user && <UsernamePicker mode="first" initial={a.user.suggestion ?? ''} onDone={() => setSheet(null)} onClose={() => setSheet(null)} />}
    </>
  );
}
